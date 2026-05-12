import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import { DraftNoteManager } from '../../src/draftNoteManager';
import { TriliumCustomDocument, TriliumTextEditorProvider } from '../../src/triliumTextEditorProvider';
import type { EtapiClient } from '../../src/etapiClient';

type WarningMessageFn = typeof vscode.window.showWarningMessage;
type ErrorMessageFn = typeof vscode.window.showErrorMessage;
type StatusBarFn = typeof vscode.window.setStatusBarMessage;
type ExecuteCommandFn = typeof vscode.commands.executeCommand;

function createProvider(client: EtapiClient): TriliumTextEditorProvider {
  const provider = Object.create(TriliumTextEditorProvider.prototype) as TriliumTextEditorProvider;
  (provider as any).getClient = () => client;
  (provider as any).draftNoteManager = new DraftNoteManager();
  (provider as any).allowedDraftSaves = new Set<string>();
  (provider as any).conflictTheirsByPath = new Map<string, string>();
  (provider as any).conflictOursByPath = new Map<string, string>();
  (provider as any).refreshTreeForNote = async () => undefined;
  (provider as any).refreshTreeOnEditorLoad = async () => undefined;
  return provider;
}

describe('TriliumTextEditorProvider', () => {
  let originalShowWarningMessage: WarningMessageFn;
  let originalShowErrorMessage: ErrorMessageFn;
  let originalSetStatusBarMessage: StatusBarFn;
  let originalExecuteCommand: ExecuteCommandFn;
  let originalJoinPath: unknown;

  beforeEach(() => {
    originalShowWarningMessage = vscode.window.showWarningMessage;
    originalShowErrorMessage = vscode.window.showErrorMessage;
    originalSetStatusBarMessage = vscode.window.setStatusBarMessage;
    originalExecuteCommand = vscode.commands.executeCommand;
    originalJoinPath = (vscode.Uri as any).joinPath;

    (vscode.window as any).showErrorMessage = async () => undefined;
    (vscode.window as any).setStatusBarMessage = () => ({ dispose: () => undefined });
    (vscode.Uri as any).joinPath = (base: vscode.Uri, ...paths: string[]) =>
      vscode.Uri.file([base.path, ...paths].join('/'));
  });

  afterEach(() => {
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    (vscode.window as any).setStatusBarMessage = originalSetStatusBarMessage;
    (vscode.commands as any).executeCommand = originalExecuteCommand;
    (vscode.Uri as any).joinPath = originalJoinPath;
  });

  it('opens a conflict diff and aborts save when Compare is chosen', async () => {
    const executeCalls: Array<{ id: string; args: unknown[] }> = [];
    let putCalls = 0;
    const client = {
      getNoteContent: async () => '<p>server</p>',
      putNoteContent: async () => { putCalls += 1; },
    } as unknown as EtapiClient;
    const provider = createProvider(client);
    const document = new TriliumCustomDocument(
      vscode.Uri.parse('trilium-text://trilium/conflict?noteId=n1'),
      'n1',
      'Conflict Note',
      '<p>local</p>',
    );
    document.syncedContent = '<p>synced</p>';

    (vscode.window as any).showWarningMessage = async () => 'Compare';
    (vscode.commands as any).executeCommand = async (id: string, ...args: unknown[]) => {
      executeCalls.push({ id, args });
      return undefined;
    };

    await assert.rejects(
      () => provider.saveCustomDocument(document, {} as vscode.CancellationToken),
      /Conflict: awaiting resolution/,
    );

    assert.strictEqual(putCalls, 0);
    assert.strictEqual(executeCalls.length, 1);
    assert.strictEqual(executeCalls[0]?.id, 'vscode.diff');
    assert.strictEqual((provider as any).conflictOursByPath.size, 1);
    assert.strictEqual((provider as any).conflictTheirsByPath.size, 1);
  });

  it('replaces local state with server content when Use Theirs is chosen', async () => {
    const panelMessages: unknown[] = [];
    let putCalls = 0;
    const client = {
      getNoteContent: async () => '<p>server</p>',
      putNoteContent: async () => { putCalls += 1; },
    } as unknown as EtapiClient;
    const provider = createProvider(client);
    const document = new TriliumCustomDocument(
      vscode.Uri.parse('trilium-text://trilium/use-theirs?noteId=n2'),
      'n2',
      'Conflict Note',
      '<p>local</p>',
    );
    document.syncedContent = '<p>synced</p>';
    document.registerPanel({
      webview: {
        postMessage: async (message: unknown) => {
          panelMessages.push(message);
        },
      },
    } as unknown as vscode.WebviewPanel);

    (vscode.window as any).showWarningMessage = async () => 'Use Theirs';

    await provider.saveCustomDocument(document, {} as vscode.CancellationToken);

    assert.strictEqual(putCalls, 0);
    assert.strictEqual(document.content, '<p>server</p>');
    assert.strictEqual(document.syncedContent, '<p>server</p>');
    assert.deepStrictEqual(panelMessages, [{ type: 'update', content: '<p>server</p>' }]);
  });

  it('saves local content when Keep Ours is chosen', async () => {
    const putCalls: Array<{ noteId: string; content: string }> = [];
    const refreshCalls: string[] = [];
    const client = {
      getNoteContent: async () => '<p>server</p>',
      putNoteContent: async (noteId: string, content: string) => {
        putCalls.push({ noteId, content });
      },
    } as unknown as EtapiClient;
    const provider = createProvider(client);
    const document = new TriliumCustomDocument(
      vscode.Uri.parse('trilium-text://trilium/keep-ours?noteId=n3'),
      'n3',
      'Conflict Note',
      '<p>local</p>',
    );
    document.syncedContent = '<p>synced</p>';
    (provider as any).refreshTreeForNote = async (noteId: string) => {
      refreshCalls.push(noteId);
    };

    (vscode.window as any).showWarningMessage = async () => 'Keep Ours';

    await provider.saveCustomDocument(document, {} as vscode.CancellationToken);

    assert.deepStrictEqual(putCalls, [{ noteId: 'n3', content: '<p>local</p>' }]);
    assert.deepStrictEqual(refreshCalls, ['n3']);
    assert.strictEqual(document.syncedContent, '<p>local</p>');
  });

  it('cancels conflict save when no resolution option is chosen', async () => {
    let putCalls = 0;
    const client = {
      getNoteContent: async () => '<p>server</p>',
      putNoteContent: async () => { putCalls += 1; },
    } as unknown as EtapiClient;
    const provider = createProvider(client);
    const document = new TriliumCustomDocument(
      vscode.Uri.parse('trilium-text://trilium/cancel?noteId=n4'),
      'n4',
      'Conflict Note',
      '<p>local</p>',
    );
    document.syncedContent = '<p>synced</p>';

    (vscode.window as any).showWarningMessage = async () => undefined;

    await assert.rejects(
      () => provider.saveCustomDocument(document, {} as vscode.CancellationToken),
      /Conflict: cancelled/,
    );

    assert.strictEqual(putCalls, 0);
  });

  it('refreshes the full tree when authoritative server content loads into the editor', async () => {
    const rootRefreshCalls: string[] = [];
    const client = {
      getNote: async () => ({ title: 'Loaded Title' }),
      getNoteContent: async () => '<p>loaded</p>',
    } as unknown as EtapiClient;
    const provider = createProvider(client);
    const document = new TriliumCustomDocument(
      vscode.Uri.parse('trilium-text://trilium/load?noteId=n5'),
      'n5',
      'Initial Title',
      '<p>initial</p>',
    );
    const panelMessages: unknown[] = [];
    const panel = {
      title: 'Initial Title',
      webview: {
        options: {},
        html: '',
        postMessage: async (message: unknown) => {
          panelMessages.push(message);
        },
        onDidReceiveMessage: () => ({ dispose: () => undefined }),
      },
      onDidDispose: () => ({ dispose: () => undefined }),
    } as unknown as vscode.WebviewPanel;

    (provider as any).context = {
      extensionUri: vscode.Uri.file('/tmp/ext'),
      subscriptions: [],
    };
    (provider as any).refreshTreeOnEditorLoad = async () => {
      rootRefreshCalls.push('refresh');
    };
    (provider as any).sendBreadcrumb = async () => undefined;
    (provider as any).getHtmlForWebview = () => '<html></html>';
    document.registerPanel(panel);

    await provider.resolveCustomEditor(document, panel, {} as vscode.CancellationToken);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(document.content, '<p>loaded</p>');
    assert.strictEqual(document.syncedContent, '<p>loaded</p>');
    assert.strictEqual(panel.title, 'Loaded Title');
    assert.deepStrictEqual(rootRefreshCalls, ['refresh']);
    assert.deepStrictEqual(panelMessages, [{ type: 'update', content: '<p>loaded</p>' }]);
  });
});
