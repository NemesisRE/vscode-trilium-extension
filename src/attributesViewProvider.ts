import * as vscode from 'vscode';
import { EtapiClient, Note, Attribute, Attachment } from './etapiClient';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MIME_FOR_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
  txt: 'text/plain', md: 'text/markdown', html: 'text/html', css: 'text/css',
  js: 'application/javascript', json: 'application/json', xml: 'application/xml',
  zip: 'application/zip', mp3: 'audio/mpeg', mp4: 'video/mp4',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// Messages sent from webview → extension host
type WebviewMessage =
  | { type: 'saveValue'; attributeId: string; value: string }
  | { type: 'deleteAttribute'; attributeId: string }
  | { type: 'addAttribute'; attrType: 'label' | 'relation'; name: string; value: string }
  | { type: 'downloadAttachment'; attachmentId: string; title: string; mime: string }
  | { type: 'deleteAttachment'; attachmentId: string }
  | { type: 'uploadAttachment' };

export class AttributesViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'triliumNoteAttributes';

  private _view?: vscode.WebviewView;
  private _note?: Note;
  private _client?: EtapiClient;
  private _attachments: Attachment[] = [];
  private _attachmentsLoaded = false;

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      if (!this._client || !this._note) { return; }
      try {
        switch (msg.type) {
          case 'saveValue': {
            await this._client.patchAttribute(msg.attributeId, { value: msg.value });
            // Refresh the note's attribute list
            this._note = await this._client.getNote(this._note.noteId);
            this._render();
            break;
          }
          case 'deleteAttribute': {
            await this._client.deleteAttribute(msg.attributeId);
            this._note = await this._client.getNote(this._note.noteId);
            this._render();
            break;
          }
          case 'addAttribute': {
            const { attrType, name, value } = msg;
            await this._client.createAttribute(this._note.noteId, attrType, name, value);
            this._note = await this._client.getNote(this._note.noteId);
            this._render();
            break;
          }
          case 'downloadAttachment': {
            const buf = await this._client.getAttachmentContent(msg.attachmentId);
            const defaultName = msg.title || `attachment-${msg.attachmentId}`;
            const saveUri = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file(defaultName),
              saveLabel: 'Download',
            });
            if (saveUri) {
              await vscode.workspace.fs.writeFile(saveUri, new Uint8Array(buf));
              void vscode.window.showInformationMessage(
                `Trilium: Downloaded "${msg.title}" to ${saveUri.fsPath}`,
              );
            }
            break;
          }
          case 'deleteAttachment': {
            await this._client.deleteAttachment(msg.attachmentId);
            this._attachments = await this._client.getNoteAttachments(this._note.noteId);
            this._render();
            break;
          }
          case 'uploadAttachment': {
            const uris = await vscode.window.showOpenDialog({
              canSelectMany: false,
              openLabel: 'Upload',
              title: 'Upload Attachment to Trilium',
            });
            if (!uris || uris.length === 0) { break; }
            const fileUri = uris[0];
            const rawBytes = await vscode.workspace.fs.readFile(fileUri);
            const base64Content = Buffer.from(rawBytes).toString('base64');
            const fileName = fileUri.path.split('/').pop() ?? 'attachment';
            const ext = fileName.includes('.') ? fileName.split('.').pop() ?? '' : '';
            const mime = MIME_FOR_EXT[ext.toLowerCase()] ?? 'application/octet-stream';
            await this._client.createAttachment(
              this._note.noteId, 'file', mime, fileName, base64Content,
            );
            this._attachments = await this._client.getNoteAttachments(this._note.noteId);
            this._render();
            break;
          }
        }
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Operation failed: ${err}`);
      }
    });

    this._render();
  }

  showNote(note: Note | undefined): void {
    this._note = note;
    this._attachments = [];
    this._attachmentsLoaded = false;
    this._render();
    if (note && this._client) {
      this._client.getNoteAttachments(note.noteId).then((attachments) => {
        this._attachments = attachments;
        this._attachmentsLoaded = true;
        this._render();
      }).catch(() => {
        this._attachmentsLoaded = true;
        this._render();
      });
    }
  }

  setClient(client: EtapiClient | undefined): void {
    this._client = client;
    this._attachments = [];
    this._attachmentsLoaded = false;
    this._render();
  }

  private _render(): void {
    if (!this._view) { return; }
    this._view.webview.html = this._buildHtml();
  }

  private _buildHtml(): string {
    const note = this._note;
    const editable = !!this._client;
    const attachments = this._attachments;
    const attachmentsLoaded = this._attachmentsLoaded;

    if (!note) {
      return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-descriptionForeground);padding:12px;margin:0;}</style>
</head><body><p>Select a note to view its attributes.</p></body></html>`;
    }

    const labels    = (note.attributes ?? []).filter((a): a is Attribute => a.type === 'label');
    const relations = (note.attributes ?? []).filter((a): a is Attribute => a.type === 'relation');

    const deleteBtn = (attr: Attribute) => editable
      ? `<button class="del-btn" data-id="${escapeHtml(attr.attributeId)}" title="Delete attribute">×</button>`
      : '';

    const labelRows = labels.length === 0
      ? '<p class="empty">No labels</p>'
      : labels.map((l) => `
<div class="row" data-id="${escapeHtml(l.attributeId)}">
  <span class="name">#${escapeHtml(l.name)}</span>
  ${l.value !== '' ? `<span class="sep">=</span>` : ''}
  ${editable
    ? `<input class="val-input" data-id="${escapeHtml(l.attributeId)}" value="${escapeHtml(l.value)}" spellcheck="false">`
    : (l.value ? `<span class="value">${escapeHtml(l.value)}</span>` : '')}
  ${deleteBtn(l)}
</div>`).join('\n');

    const relationRows = relations.length === 0
      ? '<p class="empty">No relations</p>'
      : relations.map((r) => `
<div class="row" data-id="${escapeHtml(r.attributeId)}">
  <span class="name">~${escapeHtml(r.name)}</span>
  <span class="sep">→</span>
  ${editable
    ? `<input class="val-input" data-id="${escapeHtml(r.attributeId)}" value="${escapeHtml(r.value)}" spellcheck="false">`
    : `<span class="value">${escapeHtml(r.value)}</span>`}
  ${deleteBtn(r)}
</div>`).join('\n');

    const typeLabel = note.mime && note.type !== 'text'
      ? `${escapeHtml(note.type)} · ${escapeHtml(note.mime)}`
      : escapeHtml(note.type);

    const addButtons = editable ? `
<div class="add-row">
  <button class="add-btn" id="addLabel">+ Add Label</button>
  <button class="add-btn" id="addRelation">+ Add Relation</button>
</div>` : '';

    // Nonce for inline script CSP
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    const script = editable ? `<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

// Save on Enter or blur
document.querySelectorAll('.val-input').forEach(input => {
  let original = input.value;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = original; input.blur(); }
  });
  input.addEventListener('blur', () => {
    if (input.value !== original) {
      vscode.postMessage({ type: 'saveValue', attributeId: input.dataset.id, value: input.value });
      original = input.value;
    }
  });
});

// Delete buttons
document.querySelectorAll('.del-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    vscode.postMessage({ type: 'deleteAttribute', attributeId: btn.dataset.id });
  });
});

// Add label
document.getElementById('addLabel')?.addEventListener('click', () => {
  const name = prompt('Label name:');
  if (!name || !name.trim()) return;
  const value = prompt('Label value (leave blank for flag-style):') ?? '';
  vscode.postMessage({ type: 'addAttribute', attrType: 'label', name: name.trim(), value });
});

// Add relation
document.getElementById('addRelation')?.addEventListener('click', () => {
  const name = prompt('Relation name:');
  if (!name || !name.trim()) return;
  const value = prompt('Target note ID:') ?? '';
  vscode.postMessage({ type: 'addAttribute', attrType: 'relation', name: name.trim(), value });
});

// Attachment actions
function downloadAttachment(btn) {
  vscode.postMessage({ type: 'downloadAttachment', attachmentId: btn.dataset.attId, title: btn.dataset.attTitle, mime: btn.dataset.attMime });
}
function deleteAttachment(btn) {
  if (!confirm('Delete attachment "' + btn.dataset.attId + '"?')) return;
  vscode.postMessage({ type: 'deleteAttachment', attachmentId: btn.dataset.attId });
}
function uploadAttachment() {
  vscode.postMessage({ type: 'uploadAttachment' });
}
</script>` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
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
    hr { border: none; border-top: 1px solid var(--vscode-panel-border, #444); margin: 8px 0; }
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
      white-space: nowrap;
    }
    .sep { color: var(--vscode-descriptionForeground); }
    .value { color: var(--vscode-foreground); word-break: break-all; }
    .val-input {
      flex: 1;
      min-width: 40px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid transparent;
      border-radius: 2px;
      padding: 1px 4px;
      font-family: inherit;
      font-size: inherit;
    }
    .val-input:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    .del-btn {
      margin-left: auto;
      background: none;
      border: none;
      color: var(--vscode-errorForeground, #f44);
      cursor: pointer;
      font-size: 1em;
      padding: 0 2px;
      line-height: 1;
      opacity: 0.5;
    }
    .del-btn:hover { opacity: 1; }
    .empty {
      font-style: italic;
      color: var(--vscode-descriptionForeground);
      font-size: 0.85em;
      margin: 2px 0;
    }
    .add-row {
      display: flex;
      gap: 6px;
      margin-top: 12px;
    }
    .add-btn {
      flex: 1;
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      border: none;
      border-radius: 2px;
      padding: 4px 6px;
      font-family: inherit;
      font-size: 0.85em;
      cursor: pointer;
    }
    .add-btn:hover { filter: brightness(1.15); }
    .attachment-list { margin: 0; padding: 0; list-style: none; }
    .att-item {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 0;
    }
    .att-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.85em;
    }
    .att-size {
      font-size: 0.75em;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }
    .att-dl, .att-del {
      background: none;
      border: none;
      cursor: pointer;
      padding: 0 2px;
      line-height: 1;
      opacity: 0.6;
      font-size: 1em;
    }
    .att-dl:hover, .att-del:hover { opacity: 1; }
    .att-del { color: var(--vscode-errorForeground, #f44); }
    .upload-btn {
      display: block;
      width: 100%;
      margin-top: 8px;
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      border: none;
      border-radius: 2px;
      padding: 4px 6px;
      font-family: inherit;
      font-size: 0.85em;
      cursor: pointer;
      text-align: center;
    }
    .upload-btn:hover { filter: brightness(1.15); }
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
  ${addButtons}
  <hr>
  <h3>Attachments</h3>
  ${this._buildAttachmentsHtml(attachments, attachmentsLoaded, editable)}
  ${script}
</body>
</html>`;
  }

  private _buildAttachmentsHtml(
    attachments: Attachment[],
    loaded: boolean,
    editable: boolean,
  ): string {
    if (!loaded) {
      return `<p class="empty">Loading…</p>`;
    }
    const rows = attachments.length === 0
      ? `<p class="empty">No attachments.</p>`
      : `<ul class="attachment-list">${attachments.map((a) => `
        <li class="att-item">
          <span class="att-name" title="${escapeHtml(a.title)}">${escapeHtml(a.title)}</span>
          <span class="att-size">${a.contentLength > 0
            ? (a.contentLength < 1024
              ? `${a.contentLength} B`
              : a.contentLength < 1_048_576
                ? `${(a.contentLength / 1024).toFixed(1)} KB`
                : `${(a.contentLength / 1_048_576).toFixed(1)} MB`)
            : ''}</span>
          <button class="att-dl" title="Download"
            data-att-id="${escapeHtml(a.attachmentId)}"
            data-att-title="${escapeHtml(a.title)}"
            data-att-mime="${escapeHtml(a.mime)}"
            onclick="downloadAttachment(this)">⬇</button>
          ${editable ? `<button class="att-del" title="Delete"
            data-att-id="${escapeHtml(a.attachmentId)}"
            onclick="deleteAttachment(this)">×</button>` : ''}
        </li>`).join('')}</ul>`;
    const uploadBtn = editable
      ? `<button class="upload-btn" onclick="uploadAttachment()">＋ Upload file…</button>`
      : '';
    return rows + uploadBtn;
  }
}

