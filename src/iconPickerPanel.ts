import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getBundledBoxiconsSvgRoot, listBundledBoxiconClasses, parseBoxiconClass } from './noteTreeProvider';

interface IconEntry {
  iconClass: string;
  name: string;
  svg: string;
}

// The bundled icon set doesn't change during a running extension host, and reading ~1600
// small SVG files from disk is the only per-open cost worth avoiding - the picker itself is
// rebuilt fresh (new webview, new search state) every time it's opened.
let cachedIcons: IconEntry[] | undefined;

async function loadIcons(extensionPath: string): Promise<IconEntry[]> {
  if (cachedIcons) {
    return cachedIcons;
  }

  const svgRoot = getBundledBoxiconsSvgRoot(extensionPath);
  const classes = await listBundledBoxiconClasses(extensionPath);
  const icons: IconEntry[] = [];

  for (const { iconClass, name } of classes) {
    const parsed = parseBoxiconClass(iconClass);
    if (!parsed) {
      continue;
    }
    try {
      const svg = await fs.promises.readFile(path.join(svgRoot, parsed.style, parsed.fileName), 'utf8');
      icons.push({ iconClass, name, svg });
    } catch {
      // Skip an icon whose file went missing rather than failing the whole picker.
    }
  }

  icons.sort((a, b) => a.name.localeCompare(b.name));
  cachedIcons = icons;
  return icons;
}

function getNonce(): string {
  return crypto.randomBytes(24).toString('base64');
}

/**
 * Trilium's own icon picker is a searchable grid of real icon glyphs. A VS Code QuickPick
 * can't render arbitrary SVGs (only ~50 of the ~1600 bundled boxicons have a close-enough
 * built-in codicon equivalent), so this opens a small webview instead: every bundled icon
 * inlined as an actual `<svg>`, searchable, so every row gets a real preview.
 */
export async function showIconPickerPanel(context: vscode.ExtensionContext): Promise<string | undefined> {
  const icons = await loadIcons(context.extensionPath);

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
      'triliumIconPicker',
      'Insert Icon',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: false },
    );

    panel.webview.html = renderIconPickerHtml(icons);

    panel.webview.onDidReceiveMessage((message: { type: string; iconClass?: string }) => {
      if (message.type === 'pick') {
        settle(message.iconClass);
      } else if (message.type === 'cancel') {
        settle(undefined);
      }
    });

    panel.onDidDispose(() => settle(undefined));
  });
}

function renderIconPickerHtml(icons: IconEntry[]): string {
  const nonce = getNonce();

  const grid = icons.map(({ iconClass, name, svg }) => {
    const search = `${name} ${iconClass}`.toLowerCase();
    return `<button type="button" class="icon-btn" data-icon-class="${iconClass}" data-search="${search}" title="${name} (${iconClass})">${svg}<span class="icon-label">${name}</span></button>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src 'nonce-${nonce}';
    script-src 'nonce-${nonce}';
  ">
  <title>Insert Icon</title>
  <style nonce="${nonce}">
    body {
      margin: 0;
      padding: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
      font-family: var(--vscode-font-family, sans-serif);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    #search-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.3));
      flex: 0 0 auto;
    }
    #search {
      flex: 1;
      padding: 6px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 3px;
      font-size: 13px;
    }
    #search:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }
    #count {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      white-space: nowrap;
    }
    #grid-container {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 10px 12px;
    }
    #grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
      gap: 4px;
    }
    .icon-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 8px 4px;
      background: transparent;
      color: inherit;
      border: 1px solid transparent;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      min-width: 0;
    }
    .icon-btn:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .icon-btn:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }
    .icon-btn svg {
      width: 22px;
      height: 22px;
      flex: 0 0 auto;
      pointer-events: none;
    }
    .icon-btn svg *:not([fill="none"]) {
      fill: currentColor;
    }
    .icon-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
      pointer-events: none;
    }
    #no-results {
      display: none;
      padding: 24px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <div id="search-row">
    <input id="search" type="text" placeholder="Type to search icons…" autofocus autocomplete="off">
    <span id="count"></span>
  </div>
  <div id="grid-container">
    <div id="grid">${grid}</div>
    <div id="no-results">No icons match your search.</div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const searchInput = document.getElementById('search');
    const grid = document.getElementById('grid');
    const countLabel = document.getElementById('count');
    const noResults = document.getElementById('no-results');
    const buttons = Array.from(grid.querySelectorAll('.icon-btn'));

    function pick(button) {
      vscode.postMessage({ type: 'pick', iconClass: button.dataset.iconClass });
    }

    for (const button of buttons) {
      button.addEventListener('click', () => pick(button));
    }

    function applyFilter() {
      const term = searchInput.value.trim().toLowerCase();
      let visible = 0;
      for (const button of buttons) {
        const matches = !term || button.dataset.search.includes(term);
        button.style.display = matches ? '' : 'none';
        if (matches) { visible++; }
      }
      countLabel.textContent = term ? \`\${visible} of \${buttons.length}\` : \`\${buttons.length} icons\`;
      noResults.style.display = visible === 0 ? 'block' : 'none';
    }

    searchInput.addEventListener('input', applyFilter);

    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        const firstMatch = buttons.find((button) => button.style.display !== 'none');
        if (firstMatch) { pick(firstMatch); }
      } else if (event.key === 'Escape') {
        vscode.postMessage({ type: 'cancel' });
      }
    });

    applyFilter();
    searchInput.focus();
  </script>
</body>
</html>`;
}
