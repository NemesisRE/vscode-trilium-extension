import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { EtapiClient, AppInfo } from './etapiClient';
import {
  NoteItem,
  NoteTreeProvider,
  NoteTreeDecorationProvider,
  noteTypeToLabel,
  preferredCodiconForNote,
} from './noteTreeProvider';
import { getServerUrl, getToken, storeToken } from './settings';
import { TempFileManager } from './tempFileManager';
import { AttributesViewProvider } from './attributesViewProvider';
import { TriliumTextEditorProvider } from './triliumTextEditorProvider';
import { VirtualDocumentProvider, createVirtualDocumentUri } from './virtualDocumentProvider';
import { openReorderChildrenPanel } from './reorderChildrenPanel';
import { RecentNotesProvider } from './recentNotesProvider';
import { BacklinksProvider } from './backlinksProvider';
import { DraftNoteManager } from './draftNoteManager';
import { protectedNoteToolError, protectedNoteWarningMessage } from './protectedNoteUtils';
import {
  buildNoteContext,
  formatNoteContextForLm,
  stripHtmlForLm,
} from './triliumChatUtils';
import {
  buildRefreshFailureMessage,
  classifyRefreshFailure,
  shouldUntrackAfterFailure,
  shouldWarnAfterFailure,
} from './refreshPolicy';

type Note = import('./etapiClient').Note;
type Revision = import('./etapiClient').Revision;

const MIME_EXT_MAP: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'application/javascript': '.js',
  'text/javascript': '.js',
  'application/typescript': '.ts',
  'text/typescript': '.ts',
  'text/x-python': '.py',
  'text/markdown': '.md',
  'application/json': '.json',
  'text/xml': '.xml',
  'application/xml': '.xml',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'text/plain': '.txt',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'video/mp4': '.mp4',
};

function mimeToExt(mime: string): string | undefined {
  return MIME_EXT_MAP[mime.split(';', 1)[0].trim().toLowerCase()];
}

function findWebViewUrl(note: Note): string | undefined {
  const attrs = note.attributes ?? [];
  const preferredKeys = new Set(['url', 'src', 'href', 'link']);
  for (const attr of attrs) {
    if (attr.type !== 'label') {
      continue;
    }
    const key = attr.name.trim().toLowerCase();
    if (!preferredKeys.has(key)) {
      continue;
    }
    const raw = attr.value.trim();
    if (!raw) {
      continue;
    }
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString();
      }
    } catch {
      // Ignore invalid URL-like values.
    }
  }
  return undefined;
}

function resolveNoteBrowserUrl(note: Note, notePathOrId?: string): string {
  const serverUrl = getServerUrl().replace(/\/$/, '');
  const webViewUrl = note.type === 'webView' ? findWebViewUrl(note) : undefined;
  return webViewUrl ?? `${serverUrl}/#${notePathOrId ?? note.noteId}`;
}

async function openNoteInBrowser(
  note: Note,
  notePathOrId?: string,
  external = false,
): Promise<void> {
  const noteUrl = resolveNoteBrowserUrl(note, notePathOrId);
  if (external) {
    await vscode.env.openExternal(vscode.Uri.parse(noteUrl));
    return;
  }

  try {
    await vscode.commands.executeCommand('simpleBrowser.show', noteUrl);
  } catch {
    await vscode.env.openExternal(vscode.Uri.parse(noteUrl));
  }
}

async function showProtectedNoteRecoveryActions(
  note: Note,
  notePathOrId?: string,
): Promise<void> {
  const action = await vscode.window.showWarningMessage(
    protectedNoteWarningMessage(note.title),
    'Open in Browser',
    'Open in External Browser',
    'Reconnect',
  );

  if (action === 'Open in Browser') {
    await openNoteInBrowser(note, notePathOrId, false);
    return;
  }

  if (action === 'Open in External Browser') {
    await openNoteInBrowser(note, notePathOrId, true);
    return;
  }

  if (action === 'Reconnect') {
    await vscode.commands.executeCommand('trilium.reconnect');
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  if (vscode.env.uiKind !== vscode.UIKind.Desktop) {
    void vscode.window.showWarningMessage(
      'Trilium Notes: This extension requires the VS Code desktop application.',
    );
    return;
  }

  const tempFileManager = new TempFileManager();
  const draftNoteManager = new DraftNoteManager();
  const treeProvider = new NoteTreeProvider(undefined, context.extensionPath);
  const attributesProvider = new AttributesViewProvider();
  const recentNotesProvider = new RecentNotesProvider(context, context.extensionPath);
    let backlinksProvider: BacklinksProvider | undefined;
    let backlinksView: vscode.TreeView<any> | undefined;

  function ensureBacklinksView(): void {
    const client = treeProvider.getClient();
    if (!client) {
      backlinksProvider = undefined;
      if (backlinksView) {
        backlinksView.dispose();
        backlinksView = undefined;
      }
      return;
    }

    if (!backlinksProvider) {
      backlinksProvider = new BacklinksProvider(() => treeProvider.getClient());
    }
    if (!backlinksView) {
      backlinksView = vscode.window.createTreeView('triliumBacklinks', {
        treeDataProvider: backlinksProvider,
        showCollapseAll: false,
      });
      context.subscriptions.push(backlinksView);
    }
  }

  interface RefreshEntry {
    noteId: string;
    title: string;
    type: Note['type'];
    utcDateModified: string;
    tempFilePath: string;
    consecutiveFailures: number;
    lastWarnedFailureCount?: number;
  }
  const refreshRegistry = new Map<string, RefreshEntry>(); // noteId → entry

  function trackNoteForRefresh(note: Note, tempFilePath: string): void {
    refreshRegistry.set(note.noteId, {
      noteId: note.noteId,
      title: note.title,
      type: note.type,
      utcDateModified: note.utcDateModified,
      tempFilePath,
      consecutiveFailures: 0,
      lastWarnedFailureCount: undefined,
    });
  }

  async function refreshTrackedEntry(
    noteId: string,
    entry: RefreshEntry,
    client: EtapiClient,
  ): Promise<void> {
    const fresh = await client.getNote(noteId);
    if (fresh.utcDateModified > entry.utcDateModified) {
      entry.utcDateModified = fresh.utcDateModified;
      const openDoc = vscode.workspace.textDocuments.find(
        (d) => d.uri.scheme === 'file' && d.fileName === entry.tempFilePath,
      );
      if (openDoc && !openDoc.isDirty) {
        const newContent = await client.getNoteContent(noteId);
        const fileContent =
          entry.type === 'mindMap'
            ? tempFileManager.mindMapJsonToMarkdown(newContent)
            : newContent;
        fs.writeFileSync(entry.tempFilePath, fileContent, 'utf8');
      }
    }

    entry.consecutiveFailures = 0;
    entry.lastWarnedFailureCount = undefined;
  }

  // Register virtual document provider for trilium-text:// URIs
  const virtualDocProvider = new VirtualDocumentProvider(() => treeProvider.getClient());
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('trilium-text', virtualDocProvider),
  );

  // Register in-memory read-only document provider for revision content (trilium-revision://)
  const revisionContentMap = new Map<string, string>();
  const revisionDocProvider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri): string {
      return revisionContentMap.get(uri.path) ?? '';
    }
  })();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('trilium-revision', revisionDocProvider),
  );

  // Register custom text editor provider for CKEditor webview
  const textEditorProvider = new TriliumTextEditorProvider(
    context,
    () => treeProvider.getClient(),
    draftNoteManager,
  );
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      TriliumTextEditorProvider.viewType,
      textEditorProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      },
    ),
  );

  const output = vscode.window.createOutputChannel('Trilium Notes');
  output.appendLine('Extension activated (v1.0.0)');
  treeProvider.setLogger((msg) => output.appendLine(`[tree] ${msg}`));

  // Status bar item — shows connection state, click to (re)connect.
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'trilium.connect';
  statusBarItem.tooltip = 'Trilium Notes — click to connect';
  statusBarItem.text = '$(debug-disconnect) Trilium';
  statusBarItem.show();

  function updateStatusBar(info: AppInfo | undefined): void {
    if (info) {
      statusBarItem.text = `$(database) Trilium v${info.appVersion}`;
      statusBarItem.tooltip = `Connected to ${getServerUrl()} (v${info.appVersion}) — click to reconnect`;
    } else {
      statusBarItem.text = '$(debug-disconnect) Trilium';
      statusBarItem.tooltip = 'Trilium Notes — not connected, click to connect';
    }
  }

  function updateTreeDescription(info: AppInfo | undefined): void {
    treeView.description = info ? `Trilium v${info.appVersion}` : 'Not connected';
  }

  async function refreshOpenVirtualEditorsAfterReconnect(): Promise<void> {
    const client = treeProvider.getClient();
    if (!client) {
      return;
    }

    const openVirtualDocs = vscode.workspace.textDocuments
      .filter((doc) => doc.uri.scheme === 'trilium-text')
      .flatMap((doc) => {
        const noteId = noteIdFromTriliumTextUri(doc.uri);
        return noteId ? [{ uri: doc.uri, noteId }] : [];
      });
    const openEditorDocs = textEditorProvider.getOpenEditorMetadata()
      .filter((entry) => entry.uri.scheme === 'trilium-text');

    const refreshEntries = new Map<string, { uri: vscode.Uri; noteId: string }>();
    for (const entry of [...openVirtualDocs, ...openEditorDocs]) {
      refreshEntries.set(entry.uri.toString(), entry);
    }

    await Promise.all(Array.from(refreshEntries.values()).map(async (entry) => {
      const { uri, noteId } = entry;
      if (!noteId) {
        return;
      }
      try {
        const note = await client.getNote(noteId);
        const content = await client.getNoteContent(noteId);
        const targetUri = await migrateLegacyTriliumTextTabs(uri, noteId, note.title)
          ?? uri;

        textEditorProvider.setTitleForOpenEditor(targetUri, note.title);
        virtualDocProvider.updateContent(targetUri, content);
        textEditorProvider.pushContentToOpenEditor(targetUri, content);
      } catch {
        // Keep existing content for docs that still cannot be fetched.
      }
    }));
  }

  const treeView = vscode.window.createTreeView('triliumNoteTree', {
    treeDataProvider: treeProvider,
    dragAndDropController: treeProvider,
    showCollapseAll: true,
  });

  const recentNotesView = vscode.window.createTreeView('triliumRecentNotes', {
    treeDataProvider: recentNotesProvider,
    showCollapseAll: false,
  });

  const triliumChatParticipant = vscode.chat.createChatParticipant(
    'trilium-notes.trilium',
    async (request, _chatContext, response, token) => {
      const client = treeProvider.getClient();
      if (!client) {
        const message = 'Trilium is not connected. Run "Trilium: Connect to Trilium Server" first.';
        response.markdown(message);
        return {
          errorDetails: { message },
        };
      }

      const defaultContextNoteId = getPreferredParticipantContextNoteId(treeView, tempFileManager);
      let defaultContextText: string | undefined;
      if (defaultContextNoteId) {
        response.progress('Inspecting current Trilium context…');
        try {
          const contextResult = await vscode.lm.invokeTool('trilium_getNoteContext', {
            toolInvocationToken: request.toolInvocationToken,
            input: {
              noteId: defaultContextNoteId,
              childLimit: 10,
            },
          }, token);
          defaultContextText = toolResultToText(contextResult);
        } catch {
          defaultContextText = undefined;
        }
      }

      const tools = getRegisteredLmTools([
        'trilium_searchNotes',
        'trilium_getNoteContext',
        'trilium_readNote',
        'trilium_listChildren',
        'trilium_stageDraftNotes',
      ]);

      try {
        const result = await runParticipantToolLoop(
          request,
          tools,
          buildParticipantPrompt(request.prompt, request.command, defaultContextNoteId, defaultContextText),
          token,
        );
        response.markdown(result.text || 'No response was produced.');
        for (const sessionId of result.stagedSessionIds) {
          response.button({
            command: 'trilium.confirmDraftSession',
            title: 'Confirm Draft Notes',
            arguments: [sessionId],
          });
          response.button({
            command: 'trilium.discardDraftSession',
            title: 'Discard Draft Notes',
            arguments: [sessionId],
          });
        }
        return {
          metadata: {
            defaultContextNoteId: defaultContextNoteId ?? null,
            command: request.command ?? null,
            stagedSessionIds: result.stagedSessionIds,
          },
        };
      } catch (err) {
        const message = `Trilium participant failed: ${err}`;
        response.markdown(message);
        return {
          errorDetails: { message },
        };
      }
    },
  );
  triliumChatParticipant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'trilium.svg');

  treeView.onDidChangeSelection((e) => {
      const selectedNote = e.selection[0]?.note;
    attributesProvider.showNote(e.selection[0]?.note);
      if (backlinksProvider && selectedNote) {
        backlinksProvider.updateBacklinks(selectedNote.noteId);
      }
  });

  const themeChangeDisposable = vscode.window.onDidChangeActiveColorTheme(() => {
    treeProvider.refreshRoot();
  });

  // Attempt to restore a previously stored connection on activation.
  const initialInfo = await tryConnect(context.secrets, treeProvider);
  updateStatusBar(initialInfo);
  updateTreeDescription(initialInfo);
  void vscode.commands.executeCommand('setContext', 'trilium.connected', !!initialInfo);
  attributesProvider.setClient(treeProvider.getClient());
  ensureBacklinksView();
  if (initialInfo) {
    await refreshOpenVirtualEditorsAfterReconnect();
  }

  context.subscriptions.push(
    triliumChatParticipant,
    treeView,
    recentNotesView,
    themeChangeDisposable,
    output,
    statusBarItem,
    vscode.window.registerWebviewViewProvider(AttributesViewProvider.viewId, attributesProvider),

    vscode.commands.registerCommand('trilium.clearRecentNotes', () => {
      recentNotesProvider.clear();
    }),

    vscode.commands.registerCommand('trilium.confirmDraftSession', async (sessionId: string) => {
      const client = treeProvider.getClient();
      const session = draftNoteManager.getSession(sessionId);
      if (!client || !session) {
        void vscode.window.showWarningMessage('Trilium: No staged draft session found.');
        return;
      }

      const drafts = draftNoteManager.listSessionDrafts(sessionId);
      for (const entry of drafts) {
        await textEditorProvider.confirmDraftSave(entry.noteId);
      }
      await treeProvider.refreshNoteById(session.parentNoteId);
      void vscode.window.showInformationMessage(
        `Trilium: Saved ${drafts.length} draft note(s) under "${session.parentTitle}".`,
      );
    }),

    vscode.commands.registerCommand('trilium.discardDraftSession', async (sessionId: string) => {
      const client = treeProvider.getClient();
      const session = draftNoteManager.getSession(sessionId);
      if (!client || !session) {
        void vscode.window.showWarningMessage('Trilium: No staged draft session found.');
        return;
      }

      const drafts = draftNoteManager.listSessionDrafts(sessionId);
      for (const draft of drafts) {
        await revertAndCloseTabForUri(draft.uri, TriliumTextEditorProvider.viewType);
      }
      for (const draft of drafts.slice().reverse()) {
        try {
          await client.deleteNote(draft.noteId);
        } finally {
          draftNoteManager.removeDraft(draft.noteId);
        }
      }
      draftNoteManager.removeSession(sessionId);
      await treeProvider.refreshNoteById(session.parentNoteId);
      void vscode.window.showInformationMessage(
        `Trilium: Discarded ${drafts.length} staged draft note(s).`,
      );
    }),

    vscode.commands.registerCommand('trilium._openBreadcrumbNote', async (noteId: string) => {
      const client = treeProvider.getClient();
      if (!client || !noteId) {
        return;
      }

      try {
        const note = await client.getNote(noteId);
        await openNoteInEditor(note, client, tempFileManager, virtualDocProvider);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open breadcrumb note: ${err}`);
      }
    }),

      vscode.commands.registerCommand('trilium.openNoteById', async (noteId: string) => {
        const client = treeProvider.getClient();
        if (!client || !noteId) {
          return;
        }

        try {
          const note = await client.getNote(noteId);
          await openNoteInEditor(note, client, tempFileManager, virtualDocProvider);
          if (backlinksProvider) {
            backlinksProvider.updateBacklinks(noteId);
          }
        } catch (err) {
          void vscode.window.showErrorMessage(`Trilium: Failed to open note: ${err}`);
        }
      }),

    vscode.commands.registerCommand('trilium.revealInTree', async (item?: NoteItem) => {
      const noteId = item?.note?.noteId ?? getActiveNoteId(tempFileManager);
      if (!noteId) {
        void vscode.window.showWarningMessage(
          'Trilium: No active Trilium note found to reveal.',
        );
        return;
      }

      try {
        const revealed = await revealNoteInTree(noteId, treeProvider, treeView);
        if (!revealed) {
          void vscode.window.showWarningMessage(
            'Trilium: Could not reveal note in tree (note may be outside current root/filter).',
          );
        }
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to reveal note in tree: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.openParent', async (item?: NoteItem) => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage('Trilium: Not connected.');
        return;
      }

      const noteId = item?.note?.noteId ?? getActiveNoteId(tempFileManager);
      if (!noteId) {
        void vscode.window.showWarningMessage(
          'Trilium: No active Trilium note found to open its parent.',
        );
        return;
      }

      try {
        const source = item?.note ?? await client.getNote(noteId);
        const parentId = source.parentNoteIds[0];
        if (!parentId) {
          void vscode.window.showInformationMessage('Trilium: This note has no parent.');
          return;
        }

        const parent = await client.getNote(parentId);
        await openNoteInEditor(parent, client, tempFileManager, virtualDocProvider);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open parent note: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.refresh', () => {
      virtualDocProvider.clearAllCache();
      treeProvider.refreshRoot();
    }),

    vscode.commands.registerCommand('trilium.connect', async () => {
      const info = await runConnectWizard(context.secrets, treeProvider);
      updateStatusBar(info);
      updateTreeDescription(info);
      void vscode.commands.executeCommand('setContext', 'trilium.connected', !!info);
      attributesProvider.setClient(treeProvider.getClient());
      ensureBacklinksView();
      virtualDocProvider.clearAllCache();
      if (info) {
        await refreshOpenVirtualEditorsAfterReconnect();
      }
    }),

    vscode.commands.registerCommand('trilium.reconnect', async () => {
      const info = await runConnectWizard(context.secrets, treeProvider);
      updateStatusBar(info);
      updateTreeDescription(info);
      void vscode.commands.executeCommand('setContext', 'trilium.connected', !!info);
      attributesProvider.setClient(treeProvider.getClient());
      ensureBacklinksView();
      virtualDocProvider.clearAllCache();
      if (info) {
        await refreshOpenVirtualEditorsAfterReconnect();
      }
    }),

    vscode.commands.registerCommand('trilium.createNote', async (item?: NoteItem) => {
      interface NoteTypeOption extends vscode.QuickPickItem {
        type: 'text' | 'code' | 'mermaid' | 'canvas' | 'mindMap';
      }
      const NOTE_TYPE_OPTIONS: NoteTypeOption[] = [
        { label: '$(edit) Text Note', type: 'text' },
        { label: '$(code) Code Note', type: 'code' },
        { label: '$(type-hierarchy) Mermaid Diagram', type: 'mermaid' },
        { label: '$(symbol-misc) Canvas (Excalidraw)', type: 'canvas' },
        { label: '$(type-hierarchy-sub) Mind Map', type: 'mindMap' },
      ];
      const typePick = await vscode.window.showQuickPick(NOTE_TYPE_OPTIONS, {
        title: 'New Note — select type',
        ignoreFocusOut: true,
      });
      if (!typePick) { return; }

      if (typePick.type === 'code') {
        const langPick = await vscode.window.showQuickPick(CODE_LANGUAGE_OPTIONS, {
          title: 'Select code language',
          placeHolder: 'Language',
          ignoreFocusOut: true,
        });
        if (!langPick) { return; }
        await createNoteOfType('code', langPick.mime, item, treeProvider, tempFileManager);
        return;
      }

      const defaults: Partial<Record<NoteTypeOption['type'], string>> = {
        mermaid: 'graph TD\n    A[Start] --> B[End]',
        canvas: JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {} }),
        mindMap: JSON.stringify({ nodeData: { id: 'root', topic: 'Mind Map', children: [] } }),
      };
      await createNoteOfType(typePick.type, undefined, item, treeProvider, tempFileManager,
        defaults[typePick.type] ?? '');
    }),

    vscode.commands.registerCommand('trilium.createNoteText', async (item?: NoteItem) => {
      await createNoteOfType('text', undefined, item, treeProvider, tempFileManager);
    }),

    vscode.commands.registerCommand('trilium.createNoteCode', async (item?: NoteItem) => {
      const langPick = await vscode.window.showQuickPick(CODE_LANGUAGE_OPTIONS, {
        title: 'Select code language',
        placeHolder: 'Language',
        ignoreFocusOut: true,
      });
      if (!langPick) { return; }
      await createNoteOfType('code', langPick.mime, item, treeProvider, tempFileManager);
    }),

    vscode.commands.registerCommand('trilium.createNoteMermaid', async (item?: NoteItem) => {
      await createNoteOfType('mermaid', undefined, item, treeProvider, tempFileManager,
        'graph TD\n    A[Start] --> B[End]');
    }),

    vscode.commands.registerCommand('trilium.createNoteCanvas', async (item?: NoteItem) => {
      await createNoteOfType('canvas', undefined, item, treeProvider, tempFileManager,
        JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {} }));
    }),

    vscode.commands.registerCommand('trilium.createNoteMindMap', async (item?: NoteItem) => {
      await createNoteOfType('mindMap', undefined, item, treeProvider, tempFileManager,
        JSON.stringify({ nodeData: { id: 'root', topic: 'Mind Map', children: [] } }));
    }),

    vscode.commands.registerCommand('trilium.openTodayNote', async () => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage(
          'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
        );
        return;
      }

      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const date = `${year}-${month}-${day}`;

      try {
        const note = await client.getDayNote(date);
        if (note.isProtected) {
          await showProtectedNoteRecoveryActions(note, note.noteId);
          return;
        }

        // Text notes: open with CKEditor custom editor on file-backed temp
        // docs to get native dirty/close behavior.
        if (note.type === 'text') {
          const rawContent = await client.getNoteContent(note.noteId);
          const filePath = tempFileManager.getTextEditorTempPath(note);
          fs.writeFileSync(filePath, rawContent, 'utf8');
          const uri = vscode.Uri.file(filePath);
          TriliumTextEditorProvider.setDocumentMetadata(uri, {
            noteId: note.noteId,
            title: note.title,
          });
          await vscode.commands.executeCommand(
            'vscode.openWith',
            uri,
            TriliumTextEditorProvider.viewType,
          );
          return;
        }

        // Other note types: use temp file approach
        const rawContent = await client.getNoteContent(note.noteId);
        const filePath = tempFileManager.getTempPath(note);
        const fileContent =
          note.type === 'mindMap' ? tempFileManager.mindMapJsonToMarkdown(rawContent) :
          rawContent;
        fs.writeFileSync(filePath, fileContent, 'utf8');
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.languages.setTextDocumentLanguage(doc, tempFileManager.getLanguageId(note));
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open today's note: ${err}`);
      }
    }),

    /**
     * Programmatic single-note creation — designed to be called by AI agents via
     * `vscode.commands.executeCommand('trilium.createNoteWithContent', ...)`.
     *
     * Arguments: (parentNoteId: string, title: string, type: string, content: string, mime?: string)
     * Returns: Promise<{ noteId: string }> — throws on error so callers can detect failure.
     */
    vscode.commands.registerCommand(
      'trilium.createNoteWithContent',
      async (parentNoteId: string, title: string, type: string, content: string, mime?: string) => {
        const client = treeProvider.getClient();
        if (!client) {
          throw new Error('Trilium: Not connected.');
        }
        const validTypes = ['text', 'code', 'mermaid', 'canvas'] as const;
        const noteType = (validTypes as readonly string[]).includes(type)
          ? (type as typeof validTypes[number])
          : 'text';
        const normalizedParentId = parentNoteId ?? 'root';
        const result = await client.createNote(normalizedParentId, title, noteType, content, mime);
        await treeProvider.refreshNoteById(normalizedParentId);
        return { noteId: result.note.noteId };
      },
    ),

    /**
     * Bulk recursive note import — designed for AI agents to create entire documentation
     * hierarchies in a single call.
     *
     * Arguments: (parentNoteId?: string, notesJson?: string)
     *
     * `notesJson` must be a JSON array of NoteImportSpec:
     *   [{ title, type?, mime?, content?, children?: [...] }]
     *
     * Returns: Promise<{ created: number }> — total notes created.
     *
     * Example notesJson:
     * [{"title":"Overview","type":"text","content":"<p>Hello</p>","children":[
     *   {"title":"Diagram","type":"mermaid","content":"graph TD\n  A-->B"}
     * ]}]
     */
    vscode.commands.registerCommand(
      'trilium.importNotes',
      async (parentNoteId?: string, notesJson?: string) => {
        const client = treeProvider.getClient();
        if (!client) {
          void vscode.window.showErrorMessage('Trilium: Not connected.');
          return { created: 0 };
        }

        let json = notesJson;
        if (!json) {
          json = await vscode.window.showInputBox({
            title: 'Import Notes — paste JSON array',
            placeHolder: '[{"title":"My Note","type":"text","content":"<p>Hello</p>"}]',
            ignoreFocusOut: true,
          });
          if (!json) { return { created: 0 }; }
        }

        let specs: NoteImportSpec[];
        try {
          specs = JSON.parse(json) as NoteImportSpec[];
          if (!Array.isArray(specs)) { throw new Error('Expected a JSON array'); }
        } catch (err) {
          void vscode.window.showErrorMessage(`Trilium: Invalid JSON — ${err}`);
          return { created: 0 };
        }

        const rootId = parentNoteId ?? 'root';
        try {
          const count = await importNotesRecursive(client, rootId, specs);
          await treeProvider.refreshNoteById(rootId);
          void vscode.window.showInformationMessage(`Trilium: Imported ${count} note(s).`);
          return { created: count };
        } catch (err) {
          void vscode.window.showErrorMessage(`Trilium: Import failed — ${err}`);
          return { created: 0 };
        }
      },
    ),

    // Language Model Tools — discovered automatically by Copilot Chat for all
    // users who install the extension. No copilot-instructions.md required.

    vscode.lm.registerTool<{
      parentNoteId?: string;
      title: string;
      type: string;
      content: string;
      mime?: string;
    }>('trilium_createNote', {
      prepareInvocation(_options) {
        return { invocationMessage: 'Creating Trilium note…' };
      },
      async invoke(options, _token) {
        const { parentNoteId, title, type, content, mime } = options.input;
        const client = treeProvider.getClient();
        if (!client) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: Trilium is not connected. Ask the user to run "Trilium: Connect to Trilium Server" first.'),
          ]);
        }
        const validTypes = ['text', 'code', 'mermaid', 'canvas'] as const;
        const noteType = (validTypes as readonly string[]).includes(type)
          ? (type as typeof validTypes[number])
          : 'text';
        try {
          const normalizedParentId = parentNoteId ?? 'root';
          const result = await client.createNote(normalizedParentId, title, noteType, content, mime);
          await treeProvider.refreshNoteById(normalizedParentId);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Created note "${title}" with id "${result.note.noteId}" under parent "${parentNoteId ?? 'root'}".`,
            ),
          ]);
        } catch (err) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Error creating note: ${err}`),
          ]);
        }
      },
    }),

    vscode.lm.registerTool<{
      parentNoteId?: string;
      notes: NoteImportSpec[];
    }>('trilium_importNotes', {
      prepareInvocation(options) {
        const count = options.input.notes?.length ?? 0;
        return { invocationMessage: `Importing ${count} top-level note(s) into Trilium…` };
      },
      async invoke(options, _token) {
        const { parentNoteId, notes } = options.input;
        const client = treeProvider.getClient();
        if (!client) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: Trilium is not connected. Ask the user to run "Trilium: Connect to Trilium Server" first.'),
          ]);
        }
        if (!Array.isArray(notes) || notes.length === 0) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: "notes" must be a non-empty array.'),
          ]);
        }
        try {
          const normalizedParentId = parentNoteId ?? 'root';
          const count = await importNotesRecursive(client, normalizedParentId, notes);
          await treeProvider.refreshNoteById(normalizedParentId);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Successfully created ${count} note(s) under parent "${parentNoteId ?? 'root'}".`,
            ),
          ]);
        } catch (err) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Error importing notes: ${err}`),
          ]);
        }
      },
    }),

    vscode.lm.registerTool<{
      parentNoteId: string;
      notes: DraftNoteSpec[];
    }>('trilium_stageDraftNotes', {
      prepareInvocation(options) {
        const count = options.input.notes?.length ?? 0;
        return { invocationMessage: `Staging ${count} Trilium draft note(s)…` };
      },
      async invoke(options, _token) {
        const { parentNoteId, notes } = options.input;
        const client = treeProvider.getClient();
        if (!client) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: Trilium is not connected. Ask the user to run "Trilium: Connect to Trilium Server" first.'),
          ]);
        }
        if (!parentNoteId) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: "parentNoteId" is required when staging draft notes.'),
          ]);
        }
        if (!Array.isArray(notes) || notes.length === 0) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: "notes" must be a non-empty array.'),
          ]);
        }

        try {
          const parent = await client.getNote(parentNoteId);
          const session = draftNoteManager.createSession(parentNoteId, parent.title);
          const createdEntries = await stageDraftNotesRecursive(
            client,
            parentNoteId,
            notes,
            session.sessionId,
            tempFileManager,
            textEditorProvider,
            draftNoteManager,
          );
          await treeProvider.refreshNoteById(parentNoteId);
          const summary = createdEntries
            .map((entry) => `- ${entry.title} (${entry.noteId})`)
            .join('\n');
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Staged ${createdEntries.length} Trilium draft child note(s) under "${parent.title}". Draft session id: ${session.sessionId}\n${summary}`,
            ),
          ]);
        } catch (err) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Error staging draft notes: ${err}`),
          ]);
        }
      },
    }),

    vscode.lm.registerTool<{
      query: string;
      ancestorNoteId?: string;
      limit?: number;
    }>('trilium_searchNotes', {
      prepareInvocation(options) {
        return { invocationMessage: `Searching Trilium for "${options.input.query}"…` };
      },
      async invoke(options, _token) {
        const { query, ancestorNoteId, limit } = options.input;
        const client = treeProvider.getClient();
        if (!client) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: Trilium is not connected. Ask the user to run "Trilium: Connect to Trilium Server" first.'),
          ]);
        }
        try {
          const { results } = await client.searchNotes(query, {
            ancestorNoteId,
            limit: limit ?? 20,
          });
          const items = await Promise.all(
            results.map(async (n) => {
              const context = await buildNoteContext(client, n.noteId, 0);
              return {
                noteId: n.noteId,
                title: n.title,
                type: n.type,
                path: context.pathTitles.join(' / '),
                parentNoteId: n.parentNoteIds[0] ?? '',
              };
            }),
          );
          if (items.length === 0) {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(`No notes found matching "${query}".`),
            ]);
          }
          const text = items.map(i =>
            `- noteId: ${i.noteId} | title: "${i.title}" | type: ${noteTypeToLabel(i.type)} | path: "${i.path}" | parentNoteId: ${i.parentNoteId || 'none'}`,
          ).join('\n');
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Found ${items.length} note(s):\n${text}`),
          ]);
        } catch (err) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Error searching notes: ${err}`),
          ]);
        }
      },
    }),

    vscode.lm.registerTool<{
      noteId: string;
      childLimit?: number;
    }>('trilium_getNoteContext', {
      prepareInvocation(options) {
        return { invocationMessage: `Gathering Trilium context for "${options.input.noteId}"…` };
      },
      async invoke(options, _token) {
        const { noteId, childLimit } = options.input;
        const client = treeProvider.getClient();
        if (!client) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: Trilium is not connected. Ask the user to run "Trilium: Connect to Trilium Server" first.'),
          ]);
        }

        try {
          const context = await buildNoteContext(client, noteId, childLimit ?? 12);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(formatNoteContextForLm(context)),
          ]);
        } catch (err) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Error getting note context: ${err}`),
          ]);
        }
      },
    }),

    vscode.lm.registerTool<{
      noteId: string;
    }>('trilium_readNote', {
      prepareInvocation(options) {
        return { invocationMessage: `Reading Trilium note "${options.input.noteId}"…` };
      },
      async invoke(options, _token) {
        const { noteId } = options.input;
        const client = treeProvider.getClient();
        if (!client) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: Trilium is not connected. Ask the user to run "Trilium: Connect to Trilium Server" first.'),
          ]);
        }
        try {
          const note = await client.getNote(noteId);
          if (note.isProtected) {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(protectedNoteToolError(noteId, 'read')),
            ]);
          }
          const raw = await client.getNoteContent(noteId);
          const context = await buildNoteContext(client, noteId, 0);
          const plain = stripHtmlForLm(raw);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Title: ${note.title}\nType: ${note.type}\nPath: ${context.pathTitles.join(' / ')}\n\nContent:\n${plain}`,
            ),
          ]);
        } catch (err) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Error reading note: ${err}`),
          ]);
        }
      },
    }),

    vscode.lm.registerTool<{
      noteId: string;
    }>('trilium_listChildren', {
      prepareInvocation(options) {
        return { invocationMessage: `Listing children of Trilium note "${options.input.noteId}"…` };
      },
      async invoke(options, _token) {
        const { noteId } = options.input;
        const client = treeProvider.getClient();
        if (!client) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: Trilium is not connected. Ask the user to run "Trilium: Connect to Trilium Server" first.'),
          ]);
        }
        try {
          const note = await client.getNote(noteId);
          if (note.childNoteIds.length === 0) {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(`Note "${noteId}" ("${note.title}") has no children.`),
            ]);
          }
          const children = await Promise.all(note.childNoteIds.map(id => client.getNote(id)));
          const text = children.map(c =>
            `- noteId: ${c.noteId} | title: "${c.title}" | type: ${c.type}`,
          ).join('\n');
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Children of "${note.title}" (${children.length}):\n${text}`,
            ),
          ]);
        } catch (err) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Error listing children: ${err}`),
          ]);
        }
      },
    }),

    vscode.lm.registerTool<{
      noteId: string;
      content: string;
    }>('trilium_updateNoteContent', {
      prepareInvocation(options) {
        return { invocationMessage: `Updating Trilium note "${options.input.noteId}"…` };
      },
      async invoke(options, _token) {
        const { noteId, content } = options.input;
        const client = treeProvider.getClient();
        if (!client) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: Trilium is not connected. Ask the user to run "Trilium: Connect to Trilium Server" first.'),
          ]);
        }

        try {
          const note = await client.getNote(noteId);
          if (note.isProtected) {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(protectedNoteToolError(noteId, 'modified')),
            ]);
          }

          await client.putNoteContent(noteId, content);
          await treeProvider.refreshNoteById(noteId);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Updated note "${note.title}" (${noteId}) with ${content.length} characters of content.`,
            ),
          ]);
        } catch (err) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Error updating note content: ${err}`),
          ]);
        }
      },
    }),

    vscode.lm.registerTool<{
      noteId: string;
      content: string;
      separator?: string;
    }>('trilium_appendToNote', {
      prepareInvocation(options) {
        return { invocationMessage: `Appending to Trilium note "${options.input.noteId}"…` };
      },
      async invoke(options, _token) {
        const { noteId, content, separator } = options.input;
        const client = treeProvider.getClient();
        if (!client) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: Trilium is not connected. Ask the user to run "Trilium: Connect to Trilium Server" first.'),
          ]);
        }

        try {
          const note = await client.getNote(noteId);
          if (note.isProtected) {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(protectedNoteToolError(noteId, 'modified')),
            ]);
          }

          const existing = await client.getNoteContent(noteId);
          const defaultSeparator = note.type === 'text' ? '' : '\n';
          const joiner = separator ?? defaultSeparator;
          const merged = existing.length === 0 ? content : `${existing}${joiner}${content}`;

          await client.putNoteContent(noteId, merged);
          await treeProvider.refreshNoteById(noteId);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Appended content to note "${note.title}" (${noteId}). New content length: ${merged.length} characters.`,
            ),
          ]);
        } catch (err) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Error appending to note: ${err}`),
          ]);
        }
      },
    }),

    vscode.commands.registerCommand('trilium.openInBrowser', async (item: NoteItem) => {
      await openNoteInBrowser(item.note, item.path, false);
    }),

    vscode.commands.registerCommand('trilium.openInBrowserExternal', async (item: NoteItem) => {
      await openNoteInBrowser(item.note, item.path, true);
    }),

    vscode.commands.registerCommand('trilium.openFile', async (item: NoteItem) => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage(
          'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
        );
        return;
      }

      try {
        const content = await client.getNoteContentBuffer(item.note.noteId);
        const fallbackExt = mimeToExt(item.note.mime) ?? '.bin';
        const titleHasExt = /\.[a-z0-9]+$/i.test(item.note.title);
        const filename = titleHasExt
          ? item.note.title
          : `${item.note.title}${fallbackExt}`;
        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const dir = vscode.Uri.file(path.join(os.tmpdir(), 'vscode-trilium-files'));
        await vscode.workspace.fs.createDirectory(dir);
        const target = vscode.Uri.joinPath(dir, `${item.note.noteId}-${safeName}`);
        await vscode.workspace.fs.writeFile(target, new Uint8Array(content));
        await vscode.commands.executeCommand('vscode.open', target);
        recentNotesProvider.trackNote(item.note);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open file note: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.downloadFile', async (item: NoteItem) => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage(
          'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
        );
        return;
      }

      const { note } = item;
      const defaultFileName = note.title.includes('.') ? note.title : note.title + (mimeToExt(note.mime) ?? '');
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultFileName),
        saveLabel: 'Download',
      });
      if (!saveUri) { return; }

      try {
        const buffer = await client.getNoteContentBuffer(note.noteId);
        fs.writeFileSync(saveUri.fsPath, Buffer.from(buffer));
        void vscode.window.showInformationMessage(`Trilium: Downloaded "${note.title}" to ${saveUri.fsPath}`);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to download file: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.renameNote', async (item?: NoteItem) => {
      const target = item ?? treeView.selection[0];
      if (!target) {
        return;
      }

      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage(
          'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
        );
        return;
      }

      const newTitle = await vscode.window.showInputBox({
        prompt: 'Rename note',
        value: target.note.title,
        ignoreFocusOut: true,
      });
      if (!newTitle || newTitle === target.note.title) {
        return;
      }

      try {
        await client.patchNote(target.note.noteId, { title: newTitle });
        await treeProvider.refreshNoteById(target.note.noteId);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to rename note: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.deleteNote', async (item?: NoteItem) => {
      const target = item ?? treeView.selection[0];
      if (!target) {
        return;
      }

      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage(
          'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
        );
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Delete "${target.note.title}"? This cannot be undone.`,
        { modal: true },
        'Delete',
      );
      if (confirm !== 'Delete') {
        return;
      }

      try {
        await client.deleteNote(target.note.noteId);
        // Close any editor that has this note's temp file open.
        const removedPath = tempFileManager.removeTempFile(target.note.noteId);
        tempFileManager.removeTextEditorTempFile(target.note.noteId);
        if (removedPath) {
          const fileUri = vscode.Uri.file(removedPath);
          for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
              if (tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === fileUri.fsPath) {
                await vscode.window.tabGroups.close(tab);
              }
            }
          }
        }
        const pathParts = target.path.split('/').filter(Boolean);
        const parentNoteId = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : 'root';
        await treeProvider.refreshNoteById(parentNoteId);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to delete note: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.openNote', async (item: NoteItem) => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage(
          'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
        );
        return;
      }

      const { note } = item;
      const editableTypes: Note['type'][] = ['text', 'code', 'mermaid', 'canvas', 'mindMap'];
      if (!(editableTypes as string[]).includes(note.type)) {
        const action = await vscode.window.showWarningMessage(
          `Trilium: "${note.title}" (${note.type}) cannot be rendered natively.`,
          'Open in Browser',
          'Open in External Browser',
        );
        if (action === 'Open in Browser') {
          await vscode.commands.executeCommand('trilium.openInBrowser', item);
        } else if (action === 'Open in External Browser') {
          await vscode.commands.executeCommand('trilium.openInBrowserExternal', item);
        }
        return;
      }

      if (note.isProtected) {
        await showProtectedNoteRecoveryActions(note, item.path);
        return;
      }

      try {
        // Text notes: open with CKEditor custom editor on a file-backed temp
        // document so VS Code provides native dirty/close warning behavior.
        if (note.type === 'text') {
          const rawContent = await client.getNoteContent(note.noteId);
          const uri = createVirtualDocumentUri(note.noteId, note.title);
          virtualDocProvider.updateContent(uri, rawContent);
          TriliumTextEditorProvider.setDocumentMetadata(uri, {
            noteId: note.noteId,
            title: note.title,
          });
          await vscode.commands.executeCommand(
            'vscode.openWith',
            uri,
            TriliumTextEditorProvider.viewType,
          );
          recentNotesProvider.trackNote(note);
            if (backlinksProvider) {
              backlinksProvider.updateBacklinks(note.noteId);
            }
          return;
        }

        // Other note types: use temp file approach (code, mermaid, canvas, mindMap)
        const rawContent = await client.getNoteContent(note.noteId);
        const filePath = tempFileManager.getTempPath(note);

        // Mind map notes: convert MindElixir JSON → Markdown for editing.
        const fileContent =
          note.type === 'mindMap' ? tempFileManager.mindMapJsonToMarkdown(rawContent) :
          rawContent;

        fs.writeFileSync(filePath, fileContent, 'utf8');

        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.languages.setTextDocumentLanguage(
          doc,
          tempFileManager.getLanguageId(note),
        );
        await vscode.window.showTextDocument(doc, { preview: false });
        recentNotesProvider.trackNote(note);
          if (backlinksProvider) {
            backlinksProvider.updateBacklinks(note.noteId);
          }
        trackNoteForRefresh(note, filePath);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open note: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.openNoteAsMarkdown', async (item: NoteItem) => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage(
          'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
        );
        return;
      }

      const { note } = item;
      if (note.type !== 'text') {
        void vscode.window.showWarningMessage(
          `Trilium: "Open as Markdown" is only available for text notes.`,
        );
        return;
      }

      if (note.isProtected) {
        await showProtectedNoteRecoveryActions(note, item.path);
        return;
      }

      try {
        // Use old Markdown conversion approach for fallback editing
        const rawContent = await client.getNoteContent(note.noteId);
        const filePath = tempFileManager.getTempPath(note);
        const fileContent = tempFileManager.htmlToMarkdown(rawContent);

        fs.writeFileSync(filePath, fileContent, 'utf8');

        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.languages.setTextDocumentLanguage(doc, 'markdown');
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open note as Markdown: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.openNoteAsHtml', async (item: NoteItem) => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage(
          'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
        );
        return;
      }

      try {
        const rawContent = await client.getNoteContent(item.note.noteId);
        const filePath = tempFileManager.getHtmlTempPath(item.note);
        fs.writeFileSync(filePath, rawContent, 'utf8');
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.languages.setTextDocumentLanguage(doc, 'html');
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open note as HTML: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.searchNotes', async () => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage(
          'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
        );
        return;
      }

      interface SearchItem extends vscode.QuickPickItem { note: Note; }

      const qp = vscode.window.createQuickPick<SearchItem>();
      qp.title = 'Search Trilium Notes';
      qp.placeholder = 'Type to search…';
      qp.matchOnDescription = true;

      let debounceTimer: ReturnType<typeof setTimeout> | undefined;

      qp.onDidChangeValue((query) => {
        if (debounceTimer) { clearTimeout(debounceTimer); }
        if (!query.trim()) { qp.items = []; return; }
        qp.busy = true;
        debounceTimer = setTimeout(async () => {
          try {
            const { results } = await client.searchNotes(query, { limit: 50 });
            qp.items = results.map((note) => ({
              label: `$(${preferredCodiconForNote(note)}) ${note.title}`,
              description: noteTypeToLabel(note.type),
              detail: note.parentNoteIds[0],
              note,
            }));
          } catch {
            qp.items = [];
          } finally {
            qp.busy = false;
          }
        }, 300);
      });

      qp.onDidAccept(async () => {
        const [item] = qp.selectedItems;
        if (!item) { return; }
        qp.hide();
        try {
          await openNoteInEditor(item.note, client, tempFileManager, virtualDocProvider);
        } catch (err) {
          void vscode.window.showErrorMessage(`Trilium: Failed to open note: ${err}`);
        }
      });

      qp.onDidHide(() => {
        if (debounceTimer) { clearTimeout(debounceTimer); }
        qp.dispose();
      });

      qp.show();
    }),

    vscode.commands.registerCommand('trilium.filterTree', async () => {
      const current = treeProvider.getFilter();
      const query = await vscode.window.showInputBox({
        title: 'Filter Notes Tree',
        prompt: 'Show only notes whose title contains this text (server search)',
        placeHolder: 'Filter by title…',
        value: current,
        ignoreFocusOut: true,
      });
      if (query === undefined) { return; } // user cancelled
      treeProvider.setFilter(query);
      await vscode.commands.executeCommand('setContext', 'trilium.treeFiltered', query.length > 0);
    }),

    vscode.commands.registerCommand('trilium.clearTreeFilter', async () => {
      treeProvider.clearFilter();
      await vscode.commands.executeCommand('setContext', 'trilium.treeFiltered', false);
    }),

    vscode.commands.registerCommand('trilium.copyNoteId', async (item: NoteItem) => {
      await vscode.env.clipboard.writeText(item.note.noteId);
      vscode.window.setStatusBarMessage(`Trilium: Copied note ID "${item.note.noteId}"`, 3000);
    }),

    vscode.commands.registerCommand('trilium.copyNoteUrl', async (item: NoteItem) => {
      const serverUrl = getServerUrl().replace(/\/$/, '');
      const url = `${serverUrl}/#${item.path}`;
      await vscode.env.clipboard.writeText(url);
      vscode.window.setStatusBarMessage(`Trilium: Copied URL for "${item.note.title}"`, 3000);
    }),

    vscode.commands.registerCommand('trilium.viewAttributes', async (item?: NoteItem) => {
      const target = item ?? treeView.selection[0];
      if (!target) {
        return;
      }
      attributesProvider.showNote(target.note);
      await vscode.commands.executeCommand('triliumNoteAttributes.focus');
    }),

    vscode.commands.registerCommand('trilium.openCalendarNote', async () => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage(
          'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
        );
        return;
      }

      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      // ISO 8601 week number
      const startOfYear = new Date(year, 0, 1);
      const weekNum = Math.ceil(
        ((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7,
      );
      const weekStr = `${year}-W${String(weekNum).padStart(2, '0')}`;

      interface CalendarOption extends vscode.QuickPickItem { key: string; }
      const options: CalendarOption[] = [
        { label: '$(calendar) Today\'s Note', description: `${year}-${month}-${day}`, key: 'day' },
        { label: '$(calendar-clock) Inbox Note', description: `Respects #inbox label`, key: 'inbox' },
        { label: '$(list-unordered) This Week\'s Note', description: weekStr, key: 'week' },
        { label: '$(list-ordered) This Month\'s Note', description: `${year}-${month}`, key: 'month' },
        { label: '$(calendar-alt) This Year\'s Note', description: String(year), key: 'year' },
      ];

      const pick = await vscode.window.showQuickPick(options, {
        title: 'Open Calendar Note',
        placeHolder: 'Select time period',
      });
      if (!pick) { return; }

      try {
        let note: import('./etapiClient').Note;
        switch (pick.key) {
          case 'day':   note = await client.getDayNote(`${year}-${month}-${day}`); break;
          case 'inbox': note = await client.getInboxNote(`${year}-${month}-${day}`); break;
          case 'week':  note = await client.getWeekNote(weekStr); break;
          case 'month': note = await client.getMonthNote(`${year}-${month}`); break;
          case 'year':  note = await client.getYearNote(String(year)); break;
          default: return;
        }
        await openNoteInEditor(note, client, tempFileManager, virtualDocProvider);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open calendar note: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.openInboxNote', async () => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage('Trilium: Not connected.');
        return;
      }
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      try {
        const note = await client.getInboxNote(date);
        await openNoteInEditor(note, client, tempFileManager, virtualDocProvider);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open inbox note: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.openWeekNote', async () => {
      const client = treeProvider.getClient();
      if (!client) { void vscode.window.showErrorMessage('Trilium: Not connected.'); return; }
      const now = new Date();
      const year = now.getFullYear();
      const startOfYear = new Date(year, 0, 1);
      const weekNum = Math.ceil(
        ((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7,
      );
      const week = `${year}-W${String(weekNum).padStart(2, '0')}`;
      try {
        const note = await client.getWeekNote(week);
        await openNoteInEditor(note, client, tempFileManager, virtualDocProvider);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open week note: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.openMonthNote', async () => {
      const client = treeProvider.getClient();
      if (!client) { void vscode.window.showErrorMessage('Trilium: Not connected.'); return; }
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      try {
        const note = await client.getMonthNote(month);
        await openNoteInEditor(note, client, tempFileManager, virtualDocProvider);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open month note: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.openYearNote', async () => {
      const client = treeProvider.getClient();
      if (!client) { void vscode.window.showErrorMessage('Trilium: Not connected.'); return; }
      try {
        const note = await client.getYearNote(String(new Date().getFullYear()));
        await openNoteInEditor(note, client, tempFileManager, virtualDocProvider);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open year note: ${err}`);
      }
    }),

    // -----------------------------------------------------------------------
    // Revision history
    // -----------------------------------------------------------------------

    vscode.commands.registerCommand('trilium.showRevisions', async (item?: NoteItem) => {
      const target = item ?? treeView.selection[0];
      if (!target) { return; }
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage('Trilium: Not connected.');
        return;
      }

      let revisions: Revision[];
      try {
        revisions = await client.getNoteRevisions(target.note.noteId);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to load revisions: ${err}`);
        return;
      }

      if (revisions.length === 0) {
        void vscode.window.showInformationMessage(
          `"${target.note.title}" has no saved revisions.`,
        );
        return;
      }

      // Most recent first
      revisions.sort((a, b) => b.utcDateLastEdited.localeCompare(a.utcDateLastEdited));

      interface RevisionItem extends vscode.QuickPickItem { revision: Revision; }
      const OPEN_BTN: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon('go-to-file'),
        tooltip: 'Open in tab',
      };
      const DIFF_BTN: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon('diff'),
        tooltip: 'Diff against current',
      };

      const items: RevisionItem[] = revisions.map((r) => ({
        label: r.title,
        description: r.dateLastEdited,
        detail: r.contentLength > 0 ? `${r.contentLength} bytes` : undefined,
        revision: r,
        buttons: [OPEN_BTN, DIFF_BTN],
      }));

      const qp = vscode.window.createQuickPick<RevisionItem>();
      qp.title = `Revisions — ${target.note.title}`;
      qp.items = items;
      qp.placeholder = 'Select revision · $(go-to-file) open · $(diff) diff against current';

      const openRevision = async (r: Revision, diff: boolean) => {
        qp.busy = true;
        try {
          const content = await client.getRevisionContent(r.revisionId);
          revisionContentMap.set(`/${r.revisionId}`, content);
          const revUri = vscode.Uri.parse(`trilium-revision:/${r.revisionId}`);
          if (!diff) {
            await vscode.window.showTextDocument(revUri, { preview: true });
          } else {
            const currentContent = await client.getNoteContent(target.note.noteId);
            revisionContentMap.set(`/current-${target.note.noteId}`, currentContent);
            const curUri = vscode.Uri.parse(`trilium-revision:/current-${target.note.noteId}`);
            await vscode.commands.executeCommand(
              'vscode.diff', revUri, curUri,
              `${r.title} (${r.dateLastEdited}) ↔ Current`,
            );
          }
        } catch (err) {
          void vscode.window.showErrorMessage(`Trilium: Failed to load revision: ${err}`);
        } finally {
          qp.busy = false;
        }
      };

      qp.onDidTriggerItemButton(async ({ item: picked, button }) => {
        qp.hide();
        await openRevision(picked.revision, button === DIFF_BTN);
      });

      qp.onDidAccept(async () => {
        const [picked] = qp.selectedItems;
        if (!picked) { return; }
        qp.hide();
        await openRevision(picked.revision, false);
      });

      qp.onDidHide(() => qp.dispose());
      qp.show();
    }),

    // -----------------------------------------------------------------------
    // Clone & move notes
    // -----------------------------------------------------------------------

    vscode.commands.registerCommand('trilium.cloneNote', async (item?: NoteItem) => {
      const target = item ?? treeView.selection[0];
      if (!target) { return; }
      const client = treeProvider.getClient();
      if (!client) { void vscode.window.showErrorMessage('Trilium: Not connected.'); return; }

      const destination = await pickDestinationNote(client, `Clone "${target.note.title}" to…`);
      if (!destination) { return; }

      try {
        await client.createBranch(target.note.noteId, destination.noteId);
        await client.refreshNoteOrdering(destination.noteId);
        await treeProvider.refreshNoteById(destination.noteId);
        void vscode.window.showInformationMessage(
          `Cloned "${target.note.title}" into "${destination.title}".`,
        );
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Clone failed: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.moveNote', async (item?: NoteItem) => {
      const target = item ?? treeView.selection[0];
      if (!target) { return; }
      const client = treeProvider.getClient();
      if (!client) { void vscode.window.showErrorMessage('Trilium: Not connected.'); return; }

      if (!target.branchId) {
        void vscode.window.showErrorMessage(
          `Trilium: Cannot determine the branch for this tree item. Right-click the note in the tree.`,
        );
        return;
      }

      const destination = await pickDestinationNote(client, `Move "${target.note.title}" to…`);
      if (!destination) { return; }

      // Determine the old parent noteId from the tree path
      const pathParts = target.path.split('/');
      const oldParentNoteId = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : undefined;

      if (oldParentNoteId && oldParentNoteId === destination.noteId) {
        void vscode.window.showInformationMessage('Trilium: Note is already under that parent.');
        return;
      }

      try {
        await client.createBranch(target.note.noteId, destination.noteId);
        await client.deleteBranch(target.branchId);
        await client.refreshNoteOrdering(destination.noteId);
        if (oldParentNoteId) {
          await client.refreshNoteOrdering(oldParentNoteId);
          await treeProvider.refreshNoteById(oldParentNoteId);
        }
        await treeProvider.refreshNoteById(destination.noteId);
        void vscode.window.showInformationMessage(
          `Moved "${target.note.title}" to "${destination.title}".`,
        );
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Move failed: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.reorderChildren', async (item?: NoteItem) => {
      const target = item ?? treeView.selection[0];
      if (!target) { return; }
      const client = treeProvider.getClient();
      if (!client) { void vscode.window.showErrorMessage('Trilium: Not connected.'); return; }

      try {
        await openReorderChildrenPanel(context, client, target, () => {
          void treeProvider.refreshNoteById(target.note.noteId);
        });
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Reorder window failed: ${err}`);
      }
    }),

    // -----------------------------------------------------------------------
    // Export subtree
    // -----------------------------------------------------------------------

    vscode.commands.registerCommand('trilium.exportSubtree', async (item?: NoteItem) => {
      const target = item ?? treeView.selection[0];
      if (!target) { return; }
      const client = treeProvider.getClient();
      if (!client) { void vscode.window.showErrorMessage('Trilium: Not connected.'); return; }

      interface FormatOption extends vscode.QuickPickItem { format: 'html' | 'markdown'; }
      const formatPick = await vscode.window.showQuickPick<FormatOption>([
        { label: '$(file-zip) HTML ZIP', description: 'Full HTML export with assets', format: 'html' },
        { label: '$(markdown) Markdown ZIP', description: 'Markdown text export', format: 'markdown' },
      ], { title: `Export Subtree — ${target.note.title}` });
      if (!formatPick) { return; }

      const defaultName = `${target.note.title.replace(/[\\/:*?"<>|]/g, '_')}.zip`;
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultName),
        filters: { 'ZIP Archive': ['zip'] },
        saveLabel: 'Export',
      });
      if (!saveUri) { return; }

      try {
        const buffer = await client.exportNoteSubtree(target.note.noteId, formatPick.format);
        await vscode.workspace.fs.writeFile(saveUri, new Uint8Array(buffer));
        void vscode.window.showInformationMessage(
          `Trilium: Exported "${target.note.title}" to ${saveUri.fsPath}`,
        );
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Export failed: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.debugListLmTools', async () => {
      const allTools = vscode.lm.tools;
      const triliumTools = allTools.filter((tool) => tool.name.startsWith('trilium_'));

      output.appendLine(`[lm] total tools visible in vscode.lm.tools: ${allTools.length}`);
      output.appendLine(`[lm] trilium tools visible: ${triliumTools.length}`);
      for (const tool of triliumTools) {
        output.appendLine(`[lm] tool ${tool.name} tags=[${tool.tags.join(', ')}]`);
      }

      if (triliumTools.length === 0) {
        void vscode.window.showWarningMessage(
          'Trilium: No Trilium language model tools are visible at runtime. Open "Trilium Notes" output for diagnostics.',
        );
      } else {
        void vscode.window.showInformationMessage(
          `Trilium: ${triliumTools.length} language model tools are visible. See "Trilium Notes" output.`,
        );
      }
    }),

    // Sync note content back to Trilium whenever a tracked temp file is saved.
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (tempFileManager.isTextEditorTempPath(doc.fileName)) {
        return;
      }
      const noteId = tempFileManager.getNoteIdForPath(doc.fileName);
      if (!noteId) {
        return;
      }

      const client = treeProvider.getClient();
      if (!client) {
        return;
      }

      try {
        // Text notes are stored as Markdown locally; convert back to HTML for Trilium.
        // Raw HTML temp files are already HTML and must be uploaded as-is.
        // Mind map notes are stored as Markdown locally; convert back to MindElixir JSON.
        let payload: string;
        if (tempFileManager.isHtmlTempPath(doc.fileName)) {
          payload = doc.getText();
        } else if (tempFileManager.isTextNote(noteId)) {
          payload = tempFileManager.markdownToHtml(doc.getText());
        } else if (tempFileManager.isMindMapNote(noteId)) {
          payload = tempFileManager.markdownToMindMapJson(doc.getText());
        } else {
          payload = doc.getText();
        }

        await client.putNoteContent(noteId, payload);
        vscode.window.setStatusBarMessage('Trilium: Note saved.', 3000);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to save note: ${err}`);
      }
    }),

    // Cleanup temporary and virtual documents when their tabs are closed.
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme === 'trilium-text') {
        virtualDocProvider.clearCache(doc.uri);
        return;
      }

      if (doc.uri.scheme !== 'file') {
        return;
      }

      // VS Code can close/reopen a file-backed document during language-mode
      // transitions. Avoid deleting temp files while another document instance
      // for the same file is still open.
      const isStillOpen = vscode.workspace.textDocuments.some((openDoc) =>
        openDoc.uri.scheme === 'file' && openDoc.fileName === doc.fileName,
      );
      if (isStillOpen) {
        return;
      }

      if (tempFileManager.isManagedTempPath(doc.fileName)) {
        tempFileManager.removeTempFileByPath(doc.fileName);
      }
      TriliumTextEditorProvider.clearDocumentMetadata(doc.uri);
    }),

    vscode.window.registerFileDecorationProvider(new NoteTreeDecorationProvider()),
    { dispose: () => tempFileManager.cleanup() },

    vscode.workspace.onDidCloseTextDocument((doc) => {
      for (const [noteId, entry] of refreshRegistry) {
        if (entry.tempFilePath === doc.fileName) {
          refreshRegistry.delete(noteId);
          break;
        }
      }
    }),

    (() => {
      const POLL_MS = 30_000;
      const handle = setInterval(async () => {
        const intervalSecs = vscode.workspace
          .getConfiguration('trilium')
          .get<number>('autoRefreshIntervalSeconds', 30);
        const maxConsecutiveFailures = vscode.workspace
          .getConfiguration('trilium')
          .get<number>('autoRefreshMaxConsecutiveFailures', 8);
        const warnAfterFailures = vscode.workspace
          .getConfiguration('trilium')
          .get<number>('autoRefreshWarnAfterFailures', 3);
        if (intervalSecs <= 0 || refreshRegistry.size === 0) {
          return;
        }
        const client = treeProvider.getClient();
        if (!client) {
          return;
        }
        for (const [noteId, entry] of Array.from(refreshRegistry)) {
          try {
            await refreshTrackedEntry(noteId, entry, client);
          } catch (err) {
            const kind = classifyRefreshFailure(err);
            entry.consecutiveFailures += 1;

            if (shouldUntrackAfterFailure(kind, entry.consecutiveFailures, maxConsecutiveFailures)) {
              refreshRegistry.delete(noteId);
              continue;
            }

            if (!shouldWarnAfterFailure(entry.consecutiveFailures, warnAfterFailures)) {
              continue;
            }

            if (entry.lastWarnedFailureCount === entry.consecutiveFailures) {
              continue;
            }
            entry.lastWarnedFailureCount = entry.consecutiveFailures;

            const action = await vscode.window.showWarningMessage(
              buildRefreshFailureMessage(
                entry.title,
                kind,
                entry.consecutiveFailures,
                maxConsecutiveFailures,
              ),
              'Retry Now',
              'Reconnect',
              'Disable Auto-Refresh',
            );

            if (action === 'Retry Now') {
              try {
                await refreshTrackedEntry(noteId, entry, client);
              } catch {
                // Leave the note tracked; normal polling/backoff will continue.
              }
            } else if (action === 'Reconnect') {
              await vscode.commands.executeCommand('trilium.reconnect');
            } else if (action === 'Disable Auto-Refresh') {
              await vscode.workspace
                .getConfiguration('trilium')
                .update('autoRefreshIntervalSeconds', 0, vscode.ConfigurationTarget.Global);
            }
          }
        }
      }, POLL_MS);
      return { dispose: () => clearInterval(handle) };
    })(),
  );
}

async function tryConnect(
  secrets: vscode.SecretStorage,
  treeProvider: NoteTreeProvider,
): Promise<AppInfo | undefined> {
  const token = await getToken(secrets);
  if (!token) {
    return undefined;
  }

  const serverUrl = getServerUrl();
  const client = new EtapiClient(serverUrl, token);

  try {
    const info = await client.getAppInfo();
    treeProvider.setClient(client);
    return info;
  } catch {
    // Credentials stored but server unreachable — user can reconnect manually.
    return undefined;
  }
}

async function runConnectWizard(
  secrets: vscode.SecretStorage,
  treeProvider: NoteTreeProvider,
): Promise<AppInfo | undefined> {
  const currentUrl = getServerUrl();

  const serverUrl = await vscode.window.showInputBox({
    prompt: 'Trilium server URL',
    value: currentUrl,
    ignoreFocusOut: true,
    validateInput: (v) => {
      try {
        new globalThis.URL(v);
        return null;
      } catch {
        return 'Enter a valid URL (e.g. http://localhost:8080)';
      }
    },
  });
  if (!serverUrl) {
    return;
  }

  const token = await vscode.window.showInputBox({
    prompt: 'ETAPI token — obtain from Trilium: Options → ETAPI',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'Paste your ETAPI token here',
  });
  if (!token) {
    return;
  }

  // Validate the credentials before storing them.
  const client = new EtapiClient(serverUrl, token);
  try {
    const info = await client.getAppInfo();
    await vscode.workspace
      .getConfiguration('trilium')
      .update('serverUrl', serverUrl, vscode.ConfigurationTarget.Global);
    await storeToken(secrets, token);
    treeProvider.setClient(client);
    void vscode.window.showInformationMessage(
      `Trilium: Connected to ${serverUrl} (v${info.appVersion}).`,
    );
    return info;
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Trilium: Could not connect — check URL and token. ${err}`,
    );
    return undefined;
  }
}

export function deactivate(): void {
  // Cleanup is handled via context.subscriptions.
}

// ---------------------------------------------------------------------------
// Destination note picker (for clone / move)
// ---------------------------------------------------------------------------

async function pickDestinationNote(
  client: EtapiClient,
  title: string,
): Promise<Note | undefined> {
  interface DestItem extends vscode.QuickPickItem { note: Note; }
  const qp = vscode.window.createQuickPick<DestItem>();
  qp.title = title;
  qp.placeholder = 'Type to search for destination note…';
  qp.matchOnDescription = true;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  qp.onDidChangeValue((query) => {
    if (debounce) { clearTimeout(debounce); }
    if (!query.trim()) { qp.items = []; return; }
    qp.busy = true;
    debounce = setTimeout(async () => {
      try {
        const { results } = await client.searchNotes(query, { limit: 30 });
        qp.items = results.map((n) => ({
          label: `$(${preferredCodiconForNote(n)}) ${n.title}`,
          description: noteTypeToLabel(n.type),
          note: n,
        }));
      } catch {
        qp.items = [];
      } finally {
        qp.busy = false;
      }
    }, 300);
  });

  return new Promise((resolve) => {
    qp.onDidAccept(() => {
      const [picked] = qp.selectedItems;
      settled = true;
      qp.hide();
      resolve(picked?.note);
    });
    qp.onDidHide(() => {
      if (debounce) { clearTimeout(debounce); }
      qp.dispose();
      if (!settled) {
        resolve(undefined);
      }
    });
    qp.show();
  });
}

// ---------------------------------------------------------------------------
// Note editor helper
// ---------------------------------------------------------------------------

async function openNoteInEditor(
  note: Note,
  client: EtapiClient,
  tempFileManager: TempFileManager,
  virtualDocProvider: VirtualDocumentProvider,
  notePathOrId?: string,
): Promise<void> {
  const editableTypes: Note['type'][] = ['text', 'code', 'mermaid', 'canvas', 'mindMap'];
  if (!(editableTypes as string[]).includes(note.type)) {
    const action = await vscode.window.showWarningMessage(
      `Trilium: "${note.title}" (${note.type}) cannot be rendered natively.`,
      'Open in Browser',
      'Open in External Browser',
    );
    if (action === 'Open in Browser') {
      await openNoteInBrowser(note, notePathOrId, false);
    } else if (action === 'Open in External Browser') {
      await openNoteInBrowser(note, notePathOrId, true);
    }
    return;
  }

  if (note.isProtected) {
    await showProtectedNoteRecoveryActions(note, notePathOrId);
    return;
  }
  if (note.type === 'text') {
    const rawContent = await client.getNoteContent(note.noteId);
    const uri = createVirtualDocumentUri(note.noteId, note.title);
    virtualDocProvider.updateContent(uri, rawContent);
    TriliumTextEditorProvider.setDocumentMetadata(uri, {
      noteId: note.noteId,
      title: note.title,
    });
    await vscode.commands.executeCommand('vscode.openWith', uri, TriliumTextEditorProvider.viewType);
    return;
  }
  const rawContent = await client.getNoteContent(note.noteId);
  const filePath = tempFileManager.getTempPath(note);
  const fileContent = note.type === 'mindMap'
    ? tempFileManager.mindMapJsonToMarkdown(rawContent)
    : rawContent;
  fs.writeFileSync(filePath, fileContent, 'utf8');
  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.languages.setTextDocumentLanguage(doc, tempFileManager.getLanguageId(note));
  await vscode.window.showTextDocument(doc, { preview: false });
}

function noteIdFromUri(uri: vscode.Uri, tempFileManager: TempFileManager): string | undefined {
  if (uri.scheme === 'trilium-text') {
    return noteIdFromTriliumTextUri(uri);
  }

  if (uri.scheme === 'file') {
    return tempFileManager.getNoteIdForPath(uri.fsPath);
  }

  return undefined;
}

function getPreferredParticipantContextNoteId(
  treeView: vscode.TreeView<NoteItem>,
  tempFileManager: TempFileManager,
): string | undefined {
  return treeView.selection[0]?.note.noteId ?? getActiveNoteId(tempFileManager);
}

function getRegisteredLmTools(names: string[]): vscode.LanguageModelChatTool[] {
  const byName = new Map(vscode.lm.tools.map((tool) => [tool.name, tool]));
  return names.flatMap((name) => {
    const tool = byName.get(name);
    if (!tool) {
      return [];
    }

    return [{
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    } satisfies vscode.LanguageModelChatTool];
  });
}

function toolResultToText(result: vscode.LanguageModelToolResult): string {
  return result.content
    .map((part) => part instanceof vscode.LanguageModelTextPart ? part.value : '')
    .join('')
    .trim();
}

function buildParticipantPrompt(
  prompt: string,
  command: string | undefined,
  defaultContextNoteId: string | undefined,
  defaultContextText: string | undefined,
): string {
  const commandInstruction = command === 'document'
    ? 'The selected /document command means the user explicitly wants documentation content, potentially as multiple nested notes when that structure is clearer.'
    : 'If the user is asking for documentation or a structured knowledge-base section, prefer creating a nested note tree with trilium_stageDraftNotes.';

  return [
    'You are the Trilium Notes chat participant running inside VS Code.',
    'Use the available Trilium tools to inspect the existing knowledge base, resolve the correct destination note, and stage new Trilium child notes when appropriate.',
    'Rules:',
    '- Prefer the supplied current Trilium context as the default destination scope unless the user clearly names a different target.',
    '- Use Trilium notes as primary grounding. Read relevant destination or sibling notes before writing so new content matches the local structure and naming.',
    '- If the request says to use online information, use grounded/web information when this Copilot environment provides it. If it does not, say so briefly and continue using Trilium context plus model knowledge.',
    '- Do not guess the destination when multiple Trilium notes are plausible. Ask a short clarifying question instead.',
    '- For documentation requests, treat the target section as the subtree boundary. Do not append to or overwrite the existing section note unless the user explicitly asks for that.',
    '- New notes may be placed directly under the target section or inside deeper subsections within that subtree when that creates a clearer structure.',
    '- Nested child notes are encouraged when the documentation naturally breaks into overview, setup, operations, troubleshooting, or similar subtopics.',
    '- Use trilium_stageDraftNotes to create staged draft child notes. These drafts are opened locally and are not saved to Trilium content until the user confirms them.',
    '- Draft note content must be valid HTML for each text note.',
    '- After staging drafts, summarize exactly what notes were created and under which Trilium paths.',
    commandInstruction,
    defaultContextNoteId
      ? `Current Trilium context noteId: ${defaultContextNoteId}`
      : 'Current Trilium context noteId: none',
    defaultContextText
      ? `Current Trilium context:\n${defaultContextText}`
      : 'Current Trilium context: none',
    `User request:\n${prompt}`,
  ].join('\n\n');
}

interface ParticipantRunResult {
  text: string;
  stagedSessionIds: string[];
}

async function runParticipantToolLoop(
  request: vscode.ChatRequest,
  tools: vscode.LanguageModelChatTool[],
  prompt: string,
  token: vscode.CancellationToken,
): Promise<ParticipantRunResult> {
  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(prompt),
  ];
  const stagedSessionIds = new Set<string>();

  for (let round = 0; round < 8; round += 1) {
    const modelResponse = await request.model.sendRequest(messages, {
      justification: 'Research existing Trilium notes, synthesize the answer, and optionally write results back into the user\'s Trilium tree.',
      tools,
      toolMode: vscode.LanguageModelChatToolMode.Auto,
    }, token);

    const assistantParts: Array<
      vscode.LanguageModelTextPart
      | vscode.LanguageModelToolCallPart
      | vscode.LanguageModelDataPart
    > = [];
    const toolCalls: vscode.LanguageModelToolCallPart[] = [];

    for await (const part of modelResponse.stream) {
      if (part instanceof vscode.LanguageModelTextPart) {
        assistantParts.push(part);
        continue;
      }

      if (part instanceof vscode.LanguageModelToolCallPart) {
        assistantParts.push(part);
        toolCalls.push(part);
        continue;
      }

      if (part instanceof vscode.LanguageModelDataPart) {
        assistantParts.push(part);
      }
    }

    if (toolCalls.length === 0) {
      return {
        text: assistantParts
          .map((part) => part instanceof vscode.LanguageModelTextPart ? part.value : '')
          .join('')
          .trim(),
        stagedSessionIds: Array.from(stagedSessionIds),
      };
    }

    messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));
    for (const toolCall of toolCalls) {
      const toolResult = await vscode.lm.invokeTool(toolCall.name, {
        toolInvocationToken: request.toolInvocationToken,
        input: toolCall.input,
      }, token);
      if (toolCall.name === 'trilium_stageDraftNotes') {
        const resultText = toolResultToText(toolResult);
        const match = resultText.match(/Draft session id: ([^\s]+)/);
        if (match) {
          stagedSessionIds.add(match[1]);
        }
      }
      messages.push(vscode.LanguageModelChatMessage.User([
        new vscode.LanguageModelToolResultPart(toolCall.callId, toolResult.content),
      ]));
    }
  }

  throw new Error('Exceeded maximum tool-calling rounds while handling the Trilium chat request.');
}

function noteIdFromTriliumTextUri(uri: vscode.Uri): string | undefined {
  const query = new URLSearchParams(uri.query);
  const fromQuery = query.get('noteId');
  if (fromQuery) {
    return fromQuery;
  }

  if (uri.query.includes('%3D') || uri.query.includes('%26')) {
    try {
      const decodedQuery = decodeURIComponent(uri.query);
      const decoded = new URLSearchParams(decodedQuery);
      const decodedNoteId = decoded.get('noteId');
      if (decodedNoteId) {
        return decodedNoteId;
      }
    } catch {
      // Fall through to path fallback.
    }
  }

  const fromPath = uri.path.substring(1);
  return fromPath || undefined;
}

async function migrateLegacyTriliumTextTabs(
  oldUri: vscode.Uri,
  noteId: string,
  noteTitle: string,
): Promise<vscode.Uri | undefined> {
  if (oldUri.scheme !== 'trilium-text') {
    return undefined;
  }

  const pathSegment = oldUri.path.substring(1);
  if (!pathSegment || pathSegment !== noteId) {
    return undefined;
  }

  const newUri = createVirtualDocumentUri(noteId, noteTitle);
  if (newUri.toString() === oldUri.toString()) {
    return undefined;
  }

  let migrated = false;
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (!(tab.input instanceof vscode.TabInputCustom)) {
        continue;
      }
      if (tab.input.uri.toString() !== oldUri.toString()) {
        continue;
      }

      TriliumTextEditorProvider.setDocumentMetadata(newUri, {
        noteId,
        title: noteTitle,
      });
      await vscode.commands.executeCommand(
        'vscode.openWith',
        newUri,
        TriliumTextEditorProvider.viewType,
        { preview: tab.isPreview, preserveFocus: true, viewColumn: group.viewColumn },
      );

      try {
        await vscode.window.tabGroups.close(tab);
      } catch {
        // Tab handle can become stale after openWith; close by URI lookup instead.
        for (const fallbackGroup of vscode.window.tabGroups.all) {
          for (const fallbackTab of fallbackGroup.tabs) {
            if (
              fallbackTab.input instanceof vscode.TabInputCustom
              && fallbackTab.input.uri.toString() === oldUri.toString()
            ) {
              await vscode.window.tabGroups.close(fallbackTab);
            }
          }
        }
      }
      migrated = true;
    }
  }

  return migrated ? newUri : undefined;
}

function getActiveNoteId(tempFileManager: TempFileManager): string | undefined {
  const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
  if (activeEditorUri) {
    const fromEditor = noteIdFromUri(activeEditorUri, tempFileManager);
    if (fromEditor) {
      return fromEditor;
    }
  }

  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (!activeTab) {
    return undefined;
  }

  if (activeTab.input instanceof vscode.TabInputText) {
    return noteIdFromUri(activeTab.input.uri, tempFileManager);
  }

  if (activeTab.input instanceof vscode.TabInputCustom) {
    return noteIdFromUri(activeTab.input.uri, tempFileManager);
  }

  return undefined;
}

async function revealNoteInTree(
  noteId: string,
  treeProvider: NoteTreeProvider,
  treeView: vscode.TreeView<NoteItem>,
): Promise<boolean> {
  const item = await treeProvider.findItemByNoteId(noteId);
  if (!item) {
    return false;
  }

  await vscode.commands.executeCommand('triliumNoteTree.focus');
  await treeView.reveal(item, {
    select: true,
    focus: true,
    expand: 3,
  });
  return true;
}

// ---------------------------------------------------------------------------
// Note creation helpers
// ---------------------------------------------------------------------------

interface CodeLanguageOption extends vscode.QuickPickItem {
  mime: string;
}

const CODE_LANGUAGE_OPTIONS: CodeLanguageOption[] = [
  { label: 'JavaScript', mime: 'text/javascript' },
  { label: 'TypeScript', mime: 'application/typescript' },
  { label: 'Python', mime: 'text/x-python' },
  { label: 'HTML', mime: 'text/html' },
  { label: 'CSS', mime: 'text/css' },
  { label: 'JSON', mime: 'application/json' },
  { label: 'XML', mime: 'text/xml' },
  { label: 'SQL', mime: 'text/x-sql' },
  { label: 'Shell', mime: 'text/x-sh' },
  { label: 'Java', mime: 'text/x-java' },
  { label: 'C', mime: 'text/x-c' },
  { label: 'C++', mime: 'text/x-c++' },
  { label: 'Rust', mime: 'text/x-rust' },
  { label: 'Go', mime: 'text/x-go' },
  { label: 'Kotlin', mime: 'text/x-kotlin' },
  { label: 'Ruby', mime: 'text/x-ruby' },
  { label: 'YAML', mime: 'application/x-yaml' },
  { label: 'Markdown', mime: 'text/markdown' },
  { label: 'Plain Text', mime: 'text/plain' },
];

async function createNoteOfType(
  type: 'text' | 'code' | 'mermaid' | 'canvas' | 'mindMap',
  mime: string | undefined,
  item: NoteItem | undefined,
  treeProvider: NoteTreeProvider,
  tempFileManager: TempFileManager,
  defaultContent = '',
): Promise<void> {
  const client = treeProvider.getClient();
  if (!client) {
    void vscode.window.showErrorMessage(
      'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
    );
    return;
  }

  const parentId = item?.note.noteId ?? 'root';
  const parentLabel = item?.note.title ?? 'root';

  const title = await vscode.window.showInputBox({
    prompt: `New ${type} note under "${parentLabel}"`,
    placeHolder: 'Note title',
    ignoreFocusOut: true,
  });
  if (!title) { return; }

  try {
    const result = await client.createNote(parentId, title, type, defaultContent, mime);
    await treeProvider.refreshNoteById(parentId);

    const newNote = result.note;

    // Text notes: open with CKEditor (same path as openNote / openTodayNote).
    if (newNote.type === 'text') {
      const filePath = tempFileManager.getTextEditorTempPath(newNote);
      fs.writeFileSync(filePath, defaultContent, 'utf8');
      const uri = vscode.Uri.file(filePath);
      TriliumTextEditorProvider.setDocumentMetadata(uri, {
        noteId: newNote.noteId,
        title: newNote.title,
      });
      await vscode.commands.executeCommand('vscode.openWith', uri, TriliumTextEditorProvider.viewType);
      return;
    }

    // Other note types: use temp file approach.
    const filePath = tempFileManager.getTempPath(newNote);
    fs.writeFileSync(filePath, defaultContent, 'utf8');
    const doc = await vscode.workspace.openTextDocument(filePath);
    const langId = tempFileManager.getLanguageId(newNote);
    await vscode.languages.setTextDocumentLanguage(doc, langId);
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (err) {
    void vscode.window.showErrorMessage(`Trilium: Failed to create note: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Bulk import helpers (used by trilium.importNotes)
// ---------------------------------------------------------------------------

interface NoteImportSpec {
  title: string;
  type?: 'text' | 'code' | 'mermaid' | 'canvas';
  mime?: string;
  content?: string;
  children?: NoteImportSpec[];
}

interface DraftNoteSpec {
  title: string;
  content: string;
  children?: DraftNoteSpec[];
}

async function importNotesRecursive(
  client: EtapiClient,
  parentNoteId: string,
  specs: NoteImportSpec[],
): Promise<number> {
  let count = 0;
  for (const spec of specs) {
    const type = spec.type ?? 'text';
    const result = await client.createNote(
      parentNoteId,
      spec.title,
      type,
      spec.content ?? '',
      spec.mime,
    );
    count++;
    if (spec.children && spec.children.length > 0) {
      count += await importNotesRecursive(client, result.note.noteId, spec.children);
    }
  }
  return count;
}

async function stageDraftNotesRecursive(
  client: EtapiClient,
  parentNoteId: string,
  specs: DraftNoteSpec[],
  sessionId: string,
  tempFileManager: TempFileManager,
  textEditorProvider: TriliumTextEditorProvider,
  draftNoteManager: DraftNoteManager,
): Promise<Array<{ noteId: string; title: string }>> {
  const created: Array<{ noteId: string; title: string }> = [];

  for (const spec of specs) {
    const serverContent = '<p></p>';
    const result = await client.createNote(parentNoteId, spec.title, 'text', serverContent);
    const note = result.note;
    const filePath = tempFileManager.getTextEditorTempPath(note);
    fs.writeFileSync(filePath, serverContent, 'utf8');
    const uri = vscode.Uri.file(filePath);

    TriliumTextEditorProvider.setDocumentMetadata(uri, {
      noteId: note.noteId,
      title: note.title,
    });
    draftNoteManager.registerDraft({
      noteId: note.noteId,
      sessionId,
      parentNoteId,
      title: note.title,
      type: 'text',
      uri,
      serverContent,
      localContent: spec.content,
    });

    await vscode.commands.executeCommand('vscode.openWith', uri, TriliumTextEditorProvider.viewType);
    textEditorProvider.setTitleForOpenEditor(uri, note.title);
    created.push({ noteId: note.noteId, title: note.title });

    if (spec.children && spec.children.length > 0) {
      created.push(...await stageDraftNotesRecursive(
        client,
        note.noteId,
        spec.children,
        sessionId,
        tempFileManager,
        textEditorProvider,
        draftNoteManager,
      ));
    }
  }

  return created;
}

async function closeTabForUri(uri: vscode.Uri): Promise<void> {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      const tabUri = input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText
        ? input.uri
        : undefined;
      if (tabUri?.toString() === uri.toString()) {
        await vscode.window.tabGroups.close(tab);
        return;
      }
    }
  }
}

async function revertAndCloseTabForUri(uri: vscode.Uri, customViewType?: string): Promise<void> {
  const opened = customViewType
    ? vscode.commands.executeCommand('vscode.openWith', uri, customViewType)
    : vscode.commands.executeCommand('vscode.open', uri);

  await opened;
  await vscode.commands.executeCommand('workbench.action.files.revert');
  await closeTabForUri(uri);
}
