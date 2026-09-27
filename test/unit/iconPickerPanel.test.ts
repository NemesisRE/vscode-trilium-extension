import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { showIconPickerPanel } from '../../src/iconPickerPanel';

const STAR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 2 3 4"/></svg>';
const HEART_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 6 7 8"/></svg>';

describe('showIconPickerPanel', () => {
  let extensionPath: string;
  let originalCreateWebviewPanel: unknown;
  let originalViewColumn: unknown;

  before(() => {
    // The icon list is cached at module scope after the first read (mirroring the
    // extension host, where extensionPath never changes mid-session), so all cases
    // in this suite share one fixture tree populated once.
    extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-picker-test-'));
    const svgRoot = path.join(extensionPath, 'out', 'boxicons', 'svg');
    fs.mkdirSync(path.join(svgRoot, 'regular'), { recursive: true });
    fs.mkdirSync(path.join(svgRoot, 'solid'), { recursive: true });
    fs.writeFileSync(path.join(svgRoot, 'regular', 'bx-star.svg'), STAR_SVG);
    fs.writeFileSync(path.join(svgRoot, 'solid', 'bxs-heart.svg'), HEART_SVG);
  });

  after(() => {
    fs.rmSync(extensionPath, { recursive: true, force: true });
  });

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
    let receiveMessage: ((message: { type: string; iconClass?: string }) => void) | undefined;
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
      send: (message: { type: string; iconClass?: string }) => receiveMessage?.(message),
      get disposeCalls() { return disposeCalls; },
    };
  }

  // showIconPickerPanel reads icon files off disk (via fs.promises) before the panel is
  // created, which can take more than a single macrotask tick - poll instead of guessing
  // at a fixed delay.
  async function waitForPanelReady(stub: ReturnType<typeof stubPanel>): Promise<void> {
    for (let i = 0; i < 200 && !stub.panel.webview.html; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(stub.panel.webview.html, 'panel HTML was never set');
  }

  it('renders every bundled icon as a real inlined SVG, searchable by name and class', async () => {
    const stub = stubPanel();
    const resultPromise = showIconPickerPanel({ extensionPath } as unknown as vscode.ExtensionContext);
    await waitForPanelReady(stub);

    const html = stub.panel.webview.html;
    assert.ok(html.includes(STAR_SVG), 'expected the actual bundled SVG markup to be inlined, not just referenced');
    assert.ok(html.includes(HEART_SVG));
    assert.ok(html.includes('data-icon-class="bx bx-star"'));
    assert.ok(html.includes('data-icon-class="bx bxs-heart"'));
    assert.ok(html.includes('data-search="star bx bx-star"'));
    assert.ok(html.includes('id="search"'), 'expected a search input');

    stub.send({ type: 'cancel' });
    assert.strictEqual(await resultPromise, undefined);
  });

  it('resolves with the picked icon class and disposes the panel', async () => {
    const stub = stubPanel();
    const resultPromise = showIconPickerPanel({ extensionPath } as unknown as vscode.ExtensionContext);
    await waitForPanelReady(stub);

    stub.send({ type: 'pick', iconClass: 'bx bxs-heart' });

    assert.strictEqual(await resultPromise, 'bx bxs-heart');
    assert.strictEqual(stub.disposeCalls, 1);
  });

  it('resolves with undefined when the panel is closed without a pick', async () => {
    const stub = stubPanel();
    const resultPromise = showIconPickerPanel({ extensionPath } as unknown as vscode.ExtensionContext);
    await waitForPanelReady(stub);

    stub.panel.dispose();

    assert.strictEqual(await resultPromise, undefined);
  });
});
