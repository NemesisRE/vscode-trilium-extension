import * as fs from 'fs';
import * as vscode from 'vscode';
import { EtapiClient } from './etapiClient';
import { NoteItem, NoteTreeProvider, NoteTreeDecorationProvider } from './noteTreeProvider';
import { getServerUrl, getToken, storeToken } from './settings';
import { TempFileManager } from './tempFileManager';
import { AttributesViewProvider } from './attributesViewProvider';
import { TriliumTextEditorProvider } from './triliumTextEditorProvider';
import { VirtualDocumentProvider, createVirtualDocumentUri } from './virtualDocumentProvider';

type Note = import('./etapiClient').Note;

const MIME_EXT_MAP: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
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
  return MIME_EXT_MAP[mime];
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  if (vscode.env.uiKind !== vscode.UIKind.Desktop) {
    void vscode.window.showWarningMessage(
      'Trilium Notes: This extension requires the VS Code desktop application.',
    );
    return;
  }

  const tempFileManager = new TempFileManager();
  const treeProvider = new NoteTreeProvider();
  const attributesProvider = new AttributesViewProvider();

  // Register virtual document provider for trilium-text:// URIs
  const virtualDocProvider = new VirtualDocumentProvider(() => treeProvider.getClient());
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('trilium-text', virtualDocProvider),
  );

  // Register custom text editor provider for CKEditor webview
  const textEditorProvider = new TriliumTextEditorProvider(
    context,
    () => treeProvider.getClient(),
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

  const treeView = vscode.window.createTreeView('triliumNoteTree', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  treeView.onDidChangeSelection((e) => {
    attributesProvider.showNote(e.selection[0]?.note);
  });

  // Attempt to restore a previously stored connection on activation.
  await tryConnect(context.secrets, treeProvider);

  context.subscriptions.push(
    treeView,
    output,
    vscode.window.registerWebviewViewProvider(AttributesViewProvider.viewId, attributesProvider),

    vscode.commands.registerCommand('trilium.refresh', () => {
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand('trilium.connect', async () => {
      await runConnectWizard(context.secrets, treeProvider);
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
          void vscode.window.showWarningMessage(
            `Trilium: Today's journal note is protected. Unlock it in Trilium first (Options → Protected Session).`,
          );
          return;
        }

        // Text notes: open with CKEditor custom editor
        if (note.type === 'text') {
          const uri = createVirtualDocumentUri(note.noteId, note.title);
          await vscode.commands.executeCommand('vscode.openWith', uri, TriliumTextEditorProvider.viewType);
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
        const result = await client.createNote(parentNoteId ?? 'root', title, noteType, content, mime);
        treeProvider.refresh();
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
          treeProvider.refresh();
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
          const result = await client.createNote(parentNoteId ?? 'root', title, noteType, content, mime);
          treeProvider.refresh();
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
          const count = await importNotesRecursive(client, parentNoteId ?? 'root', notes);
          treeProvider.refresh();
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

    vscode.commands.registerCommand('trilium.openInBrowser', async (item: NoteItem) => {
      const serverUrl = getServerUrl().replace(/\/$/, '');
      const noteUrl = `${serverUrl}/#${item.path}`;
      try {
        await vscode.commands.executeCommand('simpleBrowser.show', noteUrl);
      } catch {
        await vscode.env.openExternal(vscode.Uri.parse(noteUrl));
      }
    }),

    vscode.commands.registerCommand('trilium.openInBrowserExternal', async (item: NoteItem) => {
      const serverUrl = getServerUrl().replace(/\/$/, '');
      const noteUrl = `${serverUrl}/#${item.path}`;
      await vscode.env.openExternal(vscode.Uri.parse(noteUrl));
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
        treeProvider.refresh();
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
        treeProvider.refresh();
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
        void vscode.window.showWarningMessage(
          `Trilium: Note type "${note.type}" cannot be edited in VS Code.`,
        );
        return;
      }

      if (note.isProtected) {
        void vscode.window.showWarningMessage(
          `Trilium: "${note.title}" is a protected note. Unlock it in Trilium first (Options → Protected Session).`,
        );
        return;
      }

      try {
        // Text notes: open with CKEditor custom editor (WYSIWYG, no conversion)
        if (note.type === 'text') {
          const uri = createVirtualDocumentUri(note.noteId, note.title);
          await vscode.commands.executeCommand('vscode.openWith', uri, TriliumTextEditorProvider.viewType);
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
        void vscode.window.showWarningMessage(
          `Trilium: "${note.title}" is a protected note. Unlock it in Trilium first (Options → Protected Session).`,
        );
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

    // Sync note content back to Trilium whenever a tracked temp file is saved.
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
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
        // Mind map notes are stored as Markdown locally; convert back to MindElixir JSON.
        let payload: string;
        if (tempFileManager.isTextNote(noteId)) {
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

    vscode.window.registerFileDecorationProvider(new NoteTreeDecorationProvider()),
    { dispose: () => tempFileManager.cleanup() },
  );
}

async function tryConnect(
  secrets: vscode.SecretStorage,
  treeProvider: NoteTreeProvider,
): Promise<boolean> {
  const token = await getToken(secrets);
  if (!token) {
    return false;
  }

  const serverUrl = getServerUrl();
  const client = new EtapiClient(serverUrl, token);

  try {
    await client.getAppInfo();
    treeProvider.setClient(client);
    return true;
  } catch {
    // Credentials stored but server unreachable — user can reconnect manually.
    return false;
  }
}

async function runConnectWizard(
  secrets: vscode.SecretStorage,
  treeProvider: NoteTreeProvider,
): Promise<void> {
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
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Trilium: Could not connect — check URL and token. ${err}`,
    );
  }
}

export function deactivate(): void {
  // Cleanup is handled via context.subscriptions.
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
    treeProvider.refresh();

    const newNote = result.note;
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
