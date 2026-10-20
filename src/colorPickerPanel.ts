import * as crypto from 'crypto';
import * as vscode from 'vscode';

function getNonce(): string {
  return crypto.randomBytes(24).toString('base64');
}

/**
 * Fallback for when the quick-select swatches don't have the color the user wants: a tiny
 * webview wrapping a native `<input type="color">`, which gets the OS color picker without
 * pulling in a color-picker dependency.
 */
export async function showColorPickerPanel(
  initialColor: string | undefined,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: string | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
      panel.dispose();
    };

    const panel = vscode.window.createWebviewPanel(
      'triliumColorPicker',
      'Choose Note Color',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: false },
    );

    panel.webview.html = renderColorPickerHtml(initialColor);

    panel.webview.onDidReceiveMessage((message: { type: string; color?: string }) => {
      if (message.type === 'pick') {
        settle(message.color);
      } else if (message.type === 'cancel') {
        settle(undefined);
      }
    });

    panel.onDidDispose(() => settle(undefined));
  });
}

function renderColorPickerHtml(initialColor: string | undefined): string {
  const nonce = getNonce();
  const startColor = /^#[0-9a-fA-F]{6}$/.test(initialColor ?? '') ? initialColor! : '#4d99e6';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src 'nonce-${nonce}';
    script-src 'nonce-${nonce}';
  ">
  <title>Choose Note Color</title>
  <style nonce="${nonce}">
    body {
      margin: 0;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      font-family: var(--vscode-font-family, sans-serif);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    #row {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    #swatch {
      width: 48px;
      height: 48px;
      border-radius: 6px;
      border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.4));
      cursor: pointer;
      padding: 0;
      background: ${startColor};
    }
    #color-input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
      width: 1px;
      height: 1px;
    }
    #hex {
      flex: 1;
      padding: 6px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 3px;
      font-size: 13px;
      font-family: var(--vscode-editor-font-family, monospace);
    }
    #actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    button.action {
      padding: 6px 14px;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-family: inherit;
      font-size: 13px;
    }
    #confirm {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    #confirm:hover {
      background: var(--vscode-button-hoverBackground);
    }
    #cancel {
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    }
    #cancel:hover {
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
    }
  </style>
</head>
<body>
  <div id="row">
    <button type="button" id="swatch" title="Click to open the color picker"></button>
    <input type="color" id="color-input" value="${startColor}">
    <input type="text" id="hex" value="${startColor}" spellcheck="false" autocomplete="off">
  </div>
  <div id="actions">
    <button type="button" class="action" id="cancel">Cancel</button>
    <button type="button" class="action" id="confirm">Use Color</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const swatch = document.getElementById('swatch');
    const colorInput = document.getElementById('color-input');
    const hexInput = document.getElementById('hex');

    function setColor(hex) {
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        swatch.style.background = hex;
        colorInput.value = hex;
      }
    }

    swatch.addEventListener('click', () => colorInput.click());
    colorInput.addEventListener('input', () => {
      hexInput.value = colorInput.value;
      setColor(colorInput.value);
    });
    hexInput.addEventListener('input', () => setColor(hexInput.value.trim()));

    document.getElementById('confirm').addEventListener('click', () => {
      const hex = hexInput.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        vscode.postMessage({ type: 'pick', color: hex });
      }
    });
    document.getElementById('cancel').addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });
  </script>
</body>
</html>`;
}
