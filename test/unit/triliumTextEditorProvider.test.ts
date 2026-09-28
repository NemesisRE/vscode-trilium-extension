import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import { TriliumCustomDocument, TriliumTextEditorProvider } from '../../src/triliumTextEditorProvider';
import type { EtapiClient, Note } from '../../src/etapiClient';

function makeNote(overrides: Partial<Note>): Note {
  return {
    noteId: 'n1',
    title: 'Test note',
    type: 'text',
    mime: 'text/html',
    isProtected: false,
    blobId: 'b1',
    childNoteIds: [],
    parentNoteIds: [],
    childBranchIds: [],
    parentBranchIds: [],
    dateCreated: '2024-01-01 00:00:00.000+0000',
    dateModified: '2024-01-01 00:00:00.000+0000',
    utcDateCreated: '2024-01-01 00:00:00.000Z',
    utcDateModified: '2024-01-01 00:00:00.000Z',
    ...overrides,
  } as Note;
}

type WarningMessageFn = typeof vscode.window.showWarningMessage;
type ErrorMessageFn = typeof vscode.window.showErrorMessage;
type StatusBarFn = typeof vscode.window.setStatusBarMessage;
type ExecuteCommandFn = typeof vscode.commands.executeCommand;

function createProvider(client: EtapiClient): TriliumTextEditorProvider {
  const provider = Object.create(TriliumTextEditorProvider.prototype) as TriliumTextEditorProvider;
  (provider as any).getClient = () => client;
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

describe('TriliumTextEditorProvider.fetchIncludedNotePreview (IncludeNote)', () => {
  it('returns an error result when not connected', async () => {
    const provider = createProvider(undefined as unknown as EtapiClient);

    const preview = await (provider as any).fetchIncludedNotePreview('n1');
    assert.deepStrictEqual(preview, { kind: 'error' });
  });

  it('sanitizes a text note before rendering it', async () => {
    const client = {
      getNote: async () => makeNote({ type: 'text', title: 'Text note' }),
      getNoteContent: async () => '<p>hello</p><script>alert(1)</script><a href="javascript:evil()">x</a>',
    } as unknown as EtapiClient;
    const provider = createProvider(client);

    const preview = await (provider as any).fetchIncludedNotePreview('n1');
    assert.strictEqual(preview.kind, 'text');
    assert.strictEqual(preview.title, 'Text note');
    assert.ok(!preview.html.includes('<script'), 'script tag should be stripped');
    assert.ok(!preview.html.includes('javascript:'), 'javascript: URL should be neutralized');
    assert.ok(preview.html.includes('<p>hello</p>'), 'benign markup should survive');
  });

  it('returns raw code and mime for a code note', async () => {
    const client = {
      getNote: async () => makeNote({ type: 'code', title: 'Script', mime: 'application/javascript' }),
      getNoteContent: async () => 'console.log(1);',
    } as unknown as EtapiClient;
    const provider = createProvider(client);

    const preview = await (provider as any).fetchIncludedNotePreview('n1');
    assert.deepStrictEqual(preview, { kind: 'code', title: 'Script', code: 'console.log(1);', mime: 'application/javascript' });
  });

  it('returns a base64 data URI for an image note', async () => {
    const client = {
      getNote: async () => makeNote({ type: 'image', title: 'Pic', mime: 'image/png' }),
      getNoteContentBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    } as unknown as EtapiClient;
    const provider = createProvider(client);

    const preview = await (provider as any).fetchIncludedNotePreview('n1');
    assert.strictEqual(preview.kind, 'image');
    assert.strictEqual(preview.title, 'Pic');
    assert.strictEqual(preview.dataUri, `data:image/png;base64,${Buffer.from([1, 2, 3]).toString('base64')}`);
  });

  it('returns the raw source for a mermaid note', async () => {
    const client = {
      getNote: async () => makeNote({ type: 'mermaid', title: 'Diagram' }),
      getNoteContent: async () => 'graph TD; A-->B;',
    } as unknown as EtapiClient;
    const provider = createProvider(client);

    const preview = await (provider as any).fetchIncludedNotePreview('n1');
    assert.deepStrictEqual(preview, { kind: 'mermaid', title: 'Diagram', source: 'graph TD; A-->B;' });
  });

  it('falls back to a plain link for note types with no preview renderer', async () => {
    const client = {
      getNote: async () => makeNote({ type: 'canvas', title: 'Sketch' }),
    } as unknown as EtapiClient;
    const provider = createProvider(client);

    const preview = await (provider as any).fetchIncludedNotePreview('n1');
    assert.deepStrictEqual(preview, { kind: 'fallback', title: 'Sketch', noteType: 'canvas' });
  });

  it('returns an error result when the fetch fails', async () => {
    const client = {
      getNote: async () => { throw new Error('not found'); },
    } as unknown as EtapiClient;
    const provider = createProvider(client);

    const preview = await (provider as any).fetchIncludedNotePreview('missing');
    assert.deepStrictEqual(preview, { kind: 'error' });
  });
});
