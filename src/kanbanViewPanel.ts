import * as vscode from 'vscode';
import { EtapiClient, Note } from './etapiClient';

interface KanbanSaveMessage {
  type: 'save';
  columns: { name: string; noteIds: string[] }[];
}
type KanbanMessage = KanbanSaveMessage | { type: 'cancel' };

interface CardEntry {
  noteId: string;
  branchId: string;
  title: string;
}

const NO_VALUE_COLUMN = '';

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
 * Reads a book note's `#viewType` label (Trilium's own name for it), case-insensitively.
 * Duplicated in bookViewPanel.ts (getBookViewType) and calendarViewPanel.ts
 * (getBookViewTypeLabel) rather than shared across these independent PRs.
 */
export function getBookViewTypeLabel(note: Note): string {
  const attr = (note.attributes ?? []).find(
    (a) => a.type === 'label' && a.name.trim().toLowerCase() === 'viewtype',
  );
  return attr?.value.trim().toLowerCase() || 'grid';
}

/**
 * The label a board note groups its cards by. Trilium's own default is `#status`;
 * a board can override it with `#board:groupBy=<labelName>` (no leading `#`) on the
 * board note itself.
 */
export function getBoardGroupByLabel(boardNote: Note): string {
  const attr = (boardNote.attributes ?? []).find(
    (a) => a.type === 'label' && a.name === 'board:groupBy',
  );
  return attr?.value.trim() || 'status';
}

function getCardColumnValue(card: Note, groupByLabel: string): string {
  const attr = (card.attributes ?? []).find((a) => a.type === 'label' && a.name === groupByLabel);
  return attr?.value.trim() ?? NO_VALUE_COLUMN;
}

function buildHtml(
  webview: vscode.Webview,
  boardTitle: string,
  groupByLabel: string,
  columns: { name: string; cards: CardEntry[] }[],
): string {
  const nonce = createNonce();
  const columnsHtml = columns.map((col) => {
    const cardsHtml = col.cards.map((card) => (
      `<li class="card" draggable="true" data-note-id="${escapeHtml(card.noteId)}">${escapeHtml(card.title)}</li>`
    )).join('\n');
    const label = col.name === NO_VALUE_COLUMN ? `(no ${escapeHtml(groupByLabel)})` : escapeHtml(col.name);
    return [
      `<div class="column" data-column="${escapeHtml(col.name)}">`,
      `  <div class="columnHeader">${label}</div>`,
      `  <ul class="cardList">${cardsHtml}</ul>`,
      '</div>',
    ].join('\n');
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>${escapeHtml(boardTitle)}</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; }
    .wrap { padding: 14px; display: grid; gap: 10px; }
    .header { font-size: 13px; color: var(--vscode-descriptionForeground); }
    .parent { font-weight: 600; margin-top: 4px; }
    .board { display: flex; gap: 10px; align-items: flex-start; overflow-x: auto; padding-bottom: 4px; }
    .column {
      min-width: 220px;
      max-width: 260px;
      flex: 0 0 auto;
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 6px;
      background: var(--vscode-sideBar-background);
      display: flex;
      flex-direction: column;
    }
    .columnHeader {
      padding: 8px 10px;
      font-weight: 600;
      font-size: 12px;
      border-bottom: 1px solid var(--vscode-editorWidget-border);
    }
    .cardList { list-style: none; margin: 0; padding: 8px; display: grid; gap: 6px; min-height: 40px; }
    .card {
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 4px;
      padding: 6px 8px;
      background: var(--vscode-editor-background);
      cursor: grab;
      font-size: 13px;
    }
    .card.dragging { opacity: 0.5; }
    .cardList.dragover { outline: 1px dashed var(--vscode-focusBorder); }
    .addColumn { display: flex; gap: 6px; }
    .addColumn input {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      padding: 4px 8px;
    }
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
      <div class="header">Board &middot; grouped by #${escapeHtml(groupByLabel)}</div>
      <div class="parent">${escapeHtml(boardTitle)}</div>
    </div>
    <div class="board" id="board">${columnsHtml}</div>
    <div class="addColumn">
      <input id="newColumnName" type="text" placeholder="New column value" />
      <button class="secondary" id="addColumnBtn">Add Column</button>
    </div>
    <div class="actions">
      <button class="secondary" id="cancelBtn">Cancel</button>
      <button id="saveBtn">Save Board</button>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const board = document.getElementById('board');
    let dragged = null;

    function attachCard(card) {
      card.addEventListener('dragstart', () => {
        dragged = card;
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        dragged = null;
      });
    }
    board.querySelectorAll('.card').forEach(attachCard);

    function attachList(list) {
      list.addEventListener('dragover', (event) => {
        event.preventDefault();
        list.classList.add('dragover');
        if (!dragged) { return; }
        const siblings = Array.from(list.querySelectorAll('.card')).filter((c) => c !== dragged);
        let next = null;
        for (const sib of siblings) {
          const rect = sib.getBoundingClientRect();
          if (event.clientY < rect.top + rect.height / 2) { next = sib; break; }
        }
        if (next) { list.insertBefore(dragged, next); } else { list.appendChild(dragged); }
      });
      list.addEventListener('dragleave', () => list.classList.remove('dragover'));
      list.addEventListener('drop', (event) => {
        event.preventDefault();
        list.classList.remove('dragover');
      });
    }
    board.querySelectorAll('.cardList').forEach(attachList);

    document.getElementById('addColumnBtn').addEventListener('click', () => {
      const input = document.getElementById('newColumnName');
      const name = input.value.trim();
      if (!name) { return; }
      if (board.querySelector('.column[data-column="' + CSS.escape(name) + '"]')) { return; }
      const col = document.createElement('div');
      col.className = 'column';
      col.dataset.column = name;
      col.innerHTML = '<div class="columnHeader"></div><ul class="cardList"></ul>';
      col.querySelector('.columnHeader').textContent = name;
      board.appendChild(col);
      attachList(col.querySelector('.cardList'));
      input.value = '';
    });

    document.getElementById('cancelBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });

    document.getElementById('saveBtn').addEventListener('click', () => {
      const columns = Array.from(board.querySelectorAll('.column')).map((col) => ({
        name: col.dataset.column,
        noteIds: Array.from(col.querySelectorAll('.card')).map((c) => c.dataset.noteId),
      }));
      vscode.postMessage({ type: 'save', columns });
    });
  </script>
</body>
</html>`;
}

export async function openKanbanViewPanel(client: EtapiClient, boardNote: Note): Promise<void> {
  const children = await Promise.all(boardNote.childNoteIds.map((id) => client.getNote(id)));
  const groupByLabel = getBoardGroupByLabel(boardNote);

  const entries: CardEntry[] = boardNote.childNoteIds.map((noteId, index) => {
    const child = children.find((n) => n.noteId === noteId);
    const branchId = boardNote.childBranchIds[index];
    if (!child || !branchId) {
      throw new Error(`Missing child note or branch mapping for ${noteId}`);
    }
    return { noteId, branchId, title: child.title };
  });

  const columnOrder: string[] = [];
  const cardsByColumn = new Map<string, CardEntry[]>();
  for (const child of children) {
    const value = getCardColumnValue(child, groupByLabel);
    if (!cardsByColumn.has(value)) {
      columnOrder.push(value);
      cardsByColumn.set(value, []);
    }
    const entry = entries.find((e) => e.noteId === child.noteId);
    if (entry) {
      cardsByColumn.get(value)!.push(entry);
    }
  }
  // Keep an explicit "no value" column visible even when every card already has
  // the label, so there's somewhere to drag a card back to remove it.
  if (!cardsByColumn.has(NO_VALUE_COLUMN)) {
    columnOrder.unshift(NO_VALUE_COLUMN);
    cardsByColumn.set(NO_VALUE_COLUMN, []);
  }

  const columns = columnOrder.map((name) => ({ name, cards: cardsByColumn.get(name) ?? [] }));

  const panel = vscode.window.createWebviewPanel(
    'triliumKanbanView',
    boardNote.title,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: false },
  );

  panel.webview.html = buildHtml(panel.webview, boardNote.title, groupByLabel, columns);

  const attributeByNoteId = new Map(children.map((c) => [
    c.noteId,
    (c.attributes ?? []).find((a) => a.type === 'label' && a.name === groupByLabel),
  ]));
  const branchByNoteId = new Map(entries.map((e) => [e.noteId, e.branchId]));

  const disposable = panel.webview.onDidReceiveMessage(async (msg: KanbanMessage) => {
    if (msg.type === 'cancel') {
      panel.dispose();
      return;
    }
    if (msg.type !== 'save') {
      return;
    }

    try {
      for (const column of msg.columns) {
        await Promise.all(column.noteIds.map(async (noteId, index) => {
          const branchId = branchByNoteId.get(noteId);
          if (!branchId) {
            throw new Error(`Missing branch for note ${noteId}`);
          }
          await client.patchBranch(branchId, { notePosition: (index + 1) * 10 });

          const existing = attributeByNoteId.get(noteId);
          if (column.name === NO_VALUE_COLUMN) {
            if (existing) {
              await client.deleteAttribute(existing.attributeId);
            }
            return;
          }
          if (existing) {
            if (existing.value !== column.name) {
              await client.patchAttribute(existing.attributeId, { value: column.name });
            }
          } else {
            await client.createAttribute(noteId, 'label', groupByLabel, column.name);
          }
        }));
      }
      await client.refreshNoteOrdering(boardNote.noteId);
      panel.dispose();
      void vscode.window.showInformationMessage(`Trilium: Saved board "${boardNote.title}".`);
    } catch (err) {
      void vscode.window.showErrorMessage(`Trilium: Failed to save board: ${err}`);
    }
  });

  panel.onDidDispose(() => disposable.dispose());
}
