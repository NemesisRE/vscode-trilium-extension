import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import { showColorPickerPanel } from '../../src/colorPickerPanel';

describe('showColorPickerPanel', () => {
  let originalCreateWebviewPanel: unknown;
  let originalViewColumn: unknown;

  beforeEach(() => {
    originalCreateWebviewPanel = (vscode.window as any).createWebviewPanel;
    originalViewColumn = (vscode as any).ViewColumn;
    (vscode as any).ViewColumn = { Beside: 2 };
  });

  afterEach(() => {
    (vscode.window as any).createWebviewPanel = originalCreateWebviewPanel;
    (vscode as any).ViewColumn = originalViewColumn;
  });

  function stubPanel() {
    let receiveMessage: ((message: { type: string; color?: string }) => void) | undefined;
    let disposeCalls = 0;
    let disposeHandler: (() => void) | undefined;
    const panel = {
      webview: {
        cspSource: 'csp',
        html: '',
        onDidReceiveMessage: (handler: typeof receiveMessage) => {
          receiveMessage = handler;
          return { dispose: () => undefined };
        },
      },
      onDidDispose: (handler: () => void) => {
        disposeHandler = handler;
        return { dispose: () => undefined };
      },
      dispose: () => {
        disposeCalls += 1;
        disposeHandler?.();
      },
    };
    (vscode.window as any).createWebviewPanel = () => panel;
    return {
      panel,
      send: (message: { type: string; color?: string }) => receiveMessage?.(message),
      get disposeCalls() { return disposeCalls; },
    };
  }

  it('seeds the webview with a valid initial color', () => {
    const stub = stubPanel();
    void showColorPickerPanel('#123abc');

    assert.ok(stub.panel.webview.html.includes('#123abc'));
  });

  it('falls back to a default color when the initial value is not a valid hex color', () => {
    const stub = stubPanel();
    void showColorPickerPanel('not-a-color');

    assert.ok(stub.panel.webview.html.includes('#4d99e6'));
    assert.ok(!stub.panel.webview.html.includes('not-a-color'));
  });

  it('resolves with the picked color and disposes the panel', async () => {
    const stub = stubPanel();
    const resultPromise = showColorPickerPanel(undefined);

    stub.send({ type: 'pick', color: '#ff00aa' });

    assert.strictEqual(await resultPromise, '#ff00aa');
    assert.strictEqual(stub.disposeCalls, 1);
  });

  it('resolves with undefined when cancelled', async () => {
    const stub = stubPanel();
    const resultPromise = showColorPickerPanel(undefined);

    stub.send({ type: 'cancel' });

    assert.strictEqual(await resultPromise, undefined);
  });

  it('resolves with undefined when the panel is closed without a pick', async () => {
    const stub = stubPanel();
    const resultPromise = showColorPickerPanel(undefined);

    stub.panel.dispose();

    assert.strictEqual(await resultPromise, undefined);
  });
});
