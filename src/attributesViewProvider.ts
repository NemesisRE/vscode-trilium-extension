import * as vscode from 'vscode';
import { Note, Attribute } from './etapiClient';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class AttributesViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'triliumNoteAttributes';

  private _view?: vscode.WebviewView;
  private _note?: Note;

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: false };
    this._render();
  }

  showNote(note: Note | undefined): void {
    this._note = note;
    this._render();
  }

  private _render(): void {
    if (!this._view) { return; }
    this._view.webview.html = this._buildHtml();
  }

  private _buildHtml(): string {
    const note = this._note;

    if (!note) {
      return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-descriptionForeground);padding:12px;margin:0;}</style>
</head><body><p>Select a note to view its attributes.</p></body></html>`;
    }

    const labels = (note.attributes ?? []).filter((a): a is Attribute => a.type === 'label');
    const relations = (note.attributes ?? []).filter((a): a is Attribute => a.type === 'relation');

    const labelRows = labels.length === 0
      ? '<p class="empty">No labels</p>'
      : labels.map((l) =>
          `<div class="row"><span class="name">#${escapeHtml(l.name)}</span>${l.value ? `<span class="sep">=</span><span class="value">${escapeHtml(l.value)}</span>` : ''}</div>`,
        ).join('\n');

    const relationRows = relations.length === 0
      ? '<p class="empty">No relations</p>'
      : relations.map((r) =>
          `<div class="row"><span class="name">~${escapeHtml(r.name)}</span><span class="sep">→</span><span class="value">${escapeHtml(r.value)}</span></div>`,
        ).join('\n');

    const typeLabel = note.mime && note.type !== 'text'
      ? `${escapeHtml(note.type)} · ${escapeHtml(note.mime)}`
      : escapeHtml(note.type);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      padding: 8px 12px;
      margin: 0;
    }
    .note-title {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 2px;
    }
    .note-type {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 10px;
    }
    hr {
      border: none;
      border-top: 1px solid var(--vscode-panel-border, #444);
      margin: 8px 0;
    }
    h3 {
      font-size: 0.8em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
      margin: 10px 0 4px;
    }
    .row {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 3px;
      padding: 2px 0;
      font-size: 0.9em;
    }
    .name {
      color: var(--vscode-symbolIcon-fieldForeground, #4ec9b0);
      font-weight: 500;
      word-break: break-word;
    }
    .sep {
      color: var(--vscode-descriptionForeground);
    }
    .value {
      color: var(--vscode-foreground);
      word-break: break-all;
    }
    .empty {
      font-style: italic;
      color: var(--vscode-descriptionForeground);
      font-size: 0.85em;
      margin: 2px 0;
    }
  </style>
</head>
<body>
  <div class="note-title" title="${escapeHtml(note.title)}">${escapeHtml(note.title)}</div>
  <div class="note-type">${typeLabel}</div>
  <hr>
  <h3>Labels</h3>
  ${labelRows}
  <h3>Relations</h3>
  ${relationRows}
</body>
</html>`;
  }
}
