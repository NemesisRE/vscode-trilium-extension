import * as vscode from 'vscode';
import { EtapiClient, Note } from './etapiClient';
import { NoteItem, noteTypeToLabel } from './noteTreeProvider';

interface ReorderEntry {
  noteId: string;
  branchId: string;
  title: string;
  type: Note['type'];
}

interface ReorderMessage {
  type: 'save' | 'cancel';
  orderedNoteIds?: string[];
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

function buildHtml(webview: vscode.Webview, parentTitle: string, entries: ReorderEntry[]): string {
  const nonce = createNonce();
  const items = entries.map((entry) => {
    return [
      `<li class="row" draggable="true" data-note-id="${escapeHtml(entry.noteId)}">`,
      `  <span class="drag"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="4" r="1.2"/><circle cx="11" cy="4" r="1.2"/><circle cx="5" cy="8" r="1.2"/><circle cx="11" cy="8" r="1.2"/><circle cx="5" cy="12" r="1.2"/><circle cx="11" cy="12" r="1.2"/></svg></span>`,
      `  <span class="title">${escapeHtml(entry.title)}</span>`,
      `  <span class="type">${escapeHtml(noteTypeToLabel(entry.type))}</span>`,
      '</li>',
    ].join('\n');
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Reorder Children</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; }
    .wrap { padding: 14px; display: grid; gap: 10px; }
    .header { font-size: 13px; color: var(--vscode-descriptionForeground); }
    .parent { font-weight: 600; margin-top: 4px; }
    .list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--vscode-editorWidget-border); border-radius: 6px; overflow: hidden; }
    .row {
      display: grid;
      grid-template-columns: 22px 1fr auto;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-top: 1px solid var(--vscode-editorWidget-border);
      background: var(--vscode-sideBar-background);
      cursor: grab;
      user-select: none;
    }
    .row:first-child { border-top: 0; }
    .row.dragging { opacity: 0.5; }
    .drag { color: var(--vscode-descriptionForeground); }
    .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .type { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .actions { display: flex; gap: 8px; justify-content: flex-end; }
    button {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 4px;
      padding: 6px 10px;
      cursor: pointer;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div>
      <div class="header">Drag to reorder direct children of:</div>
      <div class="parent">${escapeHtml(parentTitle)}</div>
    </div>
    <ul id="list" class="list">${items}</ul>
    <div class="actions">
      <button class="secondary" id="cancelBtn">Cancel</button>
      <button id="saveBtn">Save Order</button>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const list = document.getElementById('list');
    let dragged = null;

    const rows = () => Array.from(list.querySelectorAll('.row'));

    function attach(row) {
      row.addEventListener('dragstart', () => {
        dragged = row;
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        dragged = null;
      });
    }

    rows().forEach(attach);

    list.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (!dragged) {
        return;
      }
      const siblings = rows().filter((r) => r !== dragged);
      let next = null;
      for (const sib of siblings) {
        const rect = sib.getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 2) {
          next = sib;
          break;
        }
      }
      if (next) {
        list.insertBefore(dragged, next);
      } else {
        list.appendChild(dragged);
      }
    });

    document.getElementById('cancelBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });

    document.getElementById('saveBtn').addEventListener('click', () => {
      const orderedNoteIds = rows().map((row) => row.dataset.noteId);
      vscode.postMessage({ type: 'save', orderedNoteIds });
    });
  </script>
</body>
</html>`;
}

export async function openReorderChildrenPanel(
  context: vscode.ExtensionContext,
  client: EtapiClient,
  source: NoteItem,
  onApplied: () => void,
): Promise<void> {
  const parent = await client.getNote(source.note.noteId);
  if (parent.childNoteIds.length === 0) {
    void vscode.window.showInformationMessage(`Trilium: "${parent.title}" has no child notes to reorder.`);
    return;
  }

  const children = await Promise.all(parent.childNoteIds.map((id) => client.getNote(id)));
  const entries: ReorderEntry[] = parent.childNoteIds.map((noteId, index) => {
    const child = children.find((n) => n.noteId === noteId);
    const branchId = parent.childBranchIds[index];
    if (!child || !branchId) {
      throw new Error(`Missing child note or branch mapping for ${noteId}`);
    }
    return {
      noteId,
      branchId,
      title: child.title,
      type: child.type,
    };
  });

  const panel = vscode.window.createWebviewPanel(
    'triliumReorderChildren',
    `Reorder: ${parent.title}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: false },
  );

  panel.webview.html = buildHtml(panel.webview, parent.title, entries);

  const disposable = panel.webview.onDidReceiveMessage(async (msg: ReorderMessage) => {
    if (msg.type === 'cancel') {
      panel.dispose();
      return;
    }

    if (msg.type !== 'save') {
      return;
    }

    const orderedNoteIds = msg.orderedNoteIds ?? [];
    if (orderedNoteIds.length !== entries.length) {
      void vscode.window.showErrorMessage('Trilium: Invalid reorder payload.');
      return;
    }

    const expected = new Set(entries.map((e) => e.noteId));
    const actual = new Set(orderedNoteIds);
    if (expected.size !== actual.size || Array.from(expected).some((id) => !actual.has(id))) {
      void vscode.window.showErrorMessage('Trilium: Invalid reorder selection.');
      return;
    }

    try {
      const branchByNoteId = new Map(entries.map((entry) => [entry.noteId, entry.branchId]));
      await Promise.all(orderedNoteIds.map((noteId, index) => {
        const branchId = branchByNoteId.get(noteId);
        if (!branchId) {
          throw new Error(`Missing branch for note ${noteId}`);
        }
        return client.patchBranch(branchId, { notePosition: (index + 1) * 10 });
      }));
      await client.refreshNoteOrdering(parent.noteId);
      onApplied();
      panel.dispose();
      void vscode.window.showInformationMessage(`Trilium: Saved child order for "${parent.title}".`);
    } catch (err) {
      void vscode.window.showErrorMessage(`Trilium: Failed to save child order: ${err}`);
    }
  });

  panel.onDidDispose(() => disposable.dispose());
  context.subscriptions.push(disposable);
}
