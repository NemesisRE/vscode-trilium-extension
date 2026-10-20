import * as vscode from 'vscode';
import { EtapiClient, Note } from './etapiClient';
import { NoteItem, noteTypeToLabel } from './noteTreeProvider';

interface BookChildMessage {
  type: 'open';
  noteId: string;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 24; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/**
 * Reads a book note's `#viewType` label (Trilium's own name for it). Notes with no
 * label, or an explicit `grid`/`list` value, get this extension's plain children view;
 * any other value (calendar, board, table, presentation, ...) is a view this extension
 * doesn't render yet, so callers should fall back to opening it in the browser.
 */
export function getBookViewType(note: Note): string {
  const attr = (note.attributes ?? []).find(
    (a) => a.type === 'label' && a.name.trim().toLowerCase() === 'viewtype',
  );
  return attr?.value.trim().toLowerCase() || 'grid';
}

export function isPlainBookView(note: Note): boolean {
  const viewType = getBookViewType(note);
  return viewType === 'grid' || viewType === 'list';
}

function buildHtml(webview: vscode.Webview, parent: Note, children: Note[]): string {
  const nonce = createNonce();
  const rows = children.map((child) => {
    return [
      `<li class="row" data-note-id="${escapeHtml(child.noteId)}" tabindex="0">`,
      `  <span class="title">${escapeHtml(child.title)}</span>`,
      `  <span class="type">${escapeHtml(noteTypeToLabel(child.type))}</span>`,
      '</li>',
    ].join('\n');
  }).join('\n');

  const body = children.length > 0
    ? `<ul id="list" class="list">${rows}</ul>`
    : `<div class="empty">This book has no child notes.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>${escapeHtml(parent.title)}</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; }
    .wrap { padding: 14px; display: grid; gap: 10px; }
    .header { font-size: 13px; color: var(--vscode-descriptionForeground); }
    .parent { font-weight: 600; margin-top: 4px; }
    .list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--vscode-editorWidget-border); border-radius: 6px; overflow: hidden; }
    .row {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-top: 1px solid var(--vscode-editorWidget-border);
      background: var(--vscode-sideBar-background);
      cursor: pointer;
    }
    .row:first-child { border-top: 0; }
    .row:hover, .row:focus { background: var(--vscode-list-hoverBackground); outline: none; }
    .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .type { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .empty { color: var(--vscode-descriptionForeground); padding: 8px 0; }
  </style>
</head>
<body>
  <div class="wrap">
    <div>
      <div class="header">Book</div>
      <div class="parent">${escapeHtml(parent.title)}</div>
    </div>
    ${body}
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('.row').forEach((row) => {
      const open = () => vscode.postMessage({ type: 'open', noteId: row.dataset.noteId });
      row.addEventListener('click', open);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
    });
  </script>
</body>
</html>`;
}

export async function openBookViewPanel(client: EtapiClient, note: Note): Promise<void> {
  const children = await Promise.all(note.childNoteIds.map((id) => client.getNote(id)));

  const panel = vscode.window.createWebviewPanel(
    'triliumBookView',
    note.title,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: false },
  );

  panel.webview.html = buildHtml(panel.webview, note, children);

  const disposable = panel.webview.onDidReceiveMessage(async (msg: BookChildMessage) => {
    if (msg.type !== 'open') {
      return;
    }
    const child = children.find((c) => c.noteId === msg.noteId);
    if (!child) {
      return;
    }
    await vscode.commands.executeCommand('trilium.openNote', new NoteItem(child));
  });

  panel.onDidDispose(() => disposable.dispose());
}
