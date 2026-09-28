import * as vscode from 'vscode';
import { Attribute, EtapiClient, Note } from './etapiClient';

interface KanbanMoveMessage {
  type: 'move';
  noteId: string;
  toColumn: string;
  columnNoteIds: string[];
}
interface KanbanReorderColumnsMessage {
  type: 'reorderColumns';
  columnNames: string[];
}
type KanbanMessage = KanbanMoveMessage | KanbanReorderColumnsMessage;

interface CardEntry {
  noteId: string;
  title: string;
}

interface ColumnState {
  name: string;
  cards: CardEntry[];
}

interface BoardState {
  groupByLabel: string;
  columns: ColumnState[];
  attributeByNoteId: Map<string, Attribute | undefined>;
  branchByNoteId: Map<string, string>;
  columnOrderAttribute: Attribute | undefined;
}

const NO_VALUE_COLUMN = '';
const REFRESH_INTERVAL_MS = 6000;
const COLUMN_ORDER_LABEL = 'board:columnOrder';

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

/**
 * Reads the board's persisted column order from a `#board:columnOrder` label on the
 * board note itself (JSON array of column values, `""` standing in for the "no value"
 * column). Returns null when missing or unparseable, so callers fall back to
 * discovering an order from the cards instead.
 */
function getPersistedColumnOrder(boardNote: Note): string[] | null {
  const attr = (boardNote.attributes ?? []).find(
    (a) => a.type === 'label' && a.name === COLUMN_ORDER_LABEL,
  );
  if (!attr) {
    return null;
  }
  try {
    const parsed = JSON.parse(attr.value);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
      return parsed;
    }
  } catch {
    // fall through to null below
  }
  return null;
}

/**
 * Combines the persisted column order with the columns actually discovered from the
 * current cards: persisted columns keep their saved position (even if currently
 * empty), and any newly-seen column value is appended once, in first-seen order.
 * This is what keeps the column order stable across reloads/polls instead of being
 * re-derived from card fetch order every time.
 */
function mergeColumnOrder(persisted: string[] | null, discovered: string[]): string[] {
  const discoveredSet = new Set(discovered);
  const merged = (persisted ?? []).filter((name) => discoveredSet.has(name));
  const mergedSet = new Set(merged);
  for (const name of discovered) {
    if (!mergedSet.has(name)) {
      merged.push(name);
      mergedSet.add(name);
    }
  }
  if (!mergedSet.has(NO_VALUE_COLUMN)) {
    merged.unshift(NO_VALUE_COLUMN);
  }
  return merged;
}

async function loadBoardState(client: EtapiClient, boardNote: Note): Promise<BoardState> {
  const parent = await client.getNote(boardNote.noteId);
  const children = await Promise.all(parent.childNoteIds.map((id) => client.getNote(id)));
  const groupByLabel = getBoardGroupByLabel(parent);

  const branchByNoteId = new Map(
    parent.childNoteIds.map((noteId, index) => [noteId, parent.childBranchIds[index]]),
  );

  const discoveredOrder: string[] = [];
  const cardsByColumn = new Map<string, CardEntry[]>();
  for (const child of children) {
    const value = getCardColumnValue(child, groupByLabel);
    if (!cardsByColumn.has(value)) {
      discoveredOrder.push(value);
      cardsByColumn.set(value, []);
    }
    cardsByColumn.get(value)!.push({ noteId: child.noteId, title: child.title });
  }
  // Keep an explicit "no value" column visible even when every card already has
  // the label, so there's somewhere to drag a card back to remove it.
  if (!cardsByColumn.has(NO_VALUE_COLUMN)) {
    cardsByColumn.set(NO_VALUE_COLUMN, []);
  }

  const persistedOrder = getPersistedColumnOrder(parent);
  const columnOrder = mergeColumnOrder(persistedOrder, discoveredOrder);

  const columnOrderAttribute = (parent.attributes ?? []).find(
    (a) => a.type === 'label' && a.name === COLUMN_ORDER_LABEL,
  );

  // Self-heal: if the merged order doesn't match what's persisted (first run, or a
  // new column value just appeared), persist it so the order is stable next time
  // instead of being re-derived from card fetch order on every load/poll.
  const serializedOrder = JSON.stringify(columnOrder);
  let finalColumnOrderAttribute = columnOrderAttribute;
  if (!persistedOrder || JSON.stringify(persistedOrder) !== serializedOrder) {
    if (columnOrderAttribute) {
      await client.patchAttribute(columnOrderAttribute.attributeId, { value: serializedOrder });
      finalColumnOrderAttribute = { ...columnOrderAttribute, value: serializedOrder };
    } else {
      await client.createAttribute(parent.noteId, 'label', COLUMN_ORDER_LABEL, serializedOrder);
    }
  }

  const attributeByNoteId = new Map(children.map((c) => [
    c.noteId,
    (c.attributes ?? []).find((a) => a.type === 'label' && a.name === groupByLabel),
  ]));

  return {
    groupByLabel,
    columns: columnOrder.map((name) => ({ name, cards: cardsByColumn.get(name) ?? [] })),
    attributeByNoteId,
    branchByNoteId: branchByNoteId as Map<string, string>,
    columnOrderAttribute: finalColumnOrderAttribute,
  };
}

function buildHtml(webview: vscode.Webview, boardTitle: string, initialState: BoardState): string {
  const nonce = createNonce();
  const initialPayload = {
    groupByLabel: initialState.groupByLabel,
    columns: initialState.columns,
  };

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
    .header { font-size: 13px; color: var(--vscode-descriptionForeground); display: flex; justify-content: space-between; gap: 8px; }
    .syncState { font-size: 11px; color: var(--vscode-descriptionForeground); }
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
    .columnHeader { cursor: grab; }
    .column.draggingColumn { opacity: 0.5; }
    .board.dragover { outline: 1px dashed var(--vscode-focusBorder); }
    .addColumn { display: flex; gap: 6px; }
    .addColumn input {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      padding: 4px 8px;
    }
    button {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-radius: 4px;
      padding: 6px 10px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div>
      <div class="header">
        <span>Board &middot; grouped by #<span id="groupByLabel"></span></span>
        <span class="syncState" id="syncState">synced</span>
      </div>
      <div class="parent">${escapeHtml(boardTitle)}</div>
    </div>
    <div class="board" id="board"></div>
    <div class="addColumn">
      <input id="newColumnName" type="text" placeholder="New column value" />
      <button id="addColumnBtn">Add Column</button>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const board = document.getElementById('board');
    const groupByLabelEl = document.getElementById('groupByLabel');
    const syncStateEl = document.getElementById('syncState');
    let dragged = null;
    let dragging = false;
    let draggedColumn = null;

    function cardEl(card) {
      const li = document.createElement('li');
      li.className = 'card';
      li.draggable = true;
      li.dataset.noteId = card.noteId;
      li.textContent = card.title;
      attachCard(li);
      return li;
    }

    function attachCard(card) {
      card.addEventListener('dragstart', (event) => {
        event.stopPropagation();
        dragged = card;
        dragging = true;
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', (event) => {
        event.stopPropagation();
        card.classList.remove('dragging');
        dragged = null;
        dragging = false;
      });
    }

    function attachList(list) {
      list.addEventListener('dragover', (event) => {
        if (!dragged) { return; }
        event.preventDefault();
        event.stopPropagation();
        list.classList.add('dragover');
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
        if (!dragged) { return; }
        event.preventDefault();
        event.stopPropagation();
        list.classList.remove('dragover');
        const noteId = dragged.dataset.noteId;
        const toColumn = list.closest('.column').dataset.column;
        const columnNoteIds = Array.from(list.querySelectorAll('.card')).map((c) => c.dataset.noteId);
        syncStateEl.textContent = 'saving…';
        vscode.postMessage({ type: 'move', noteId, toColumn, columnNoteIds });
      });
    }

    function attachColumn(div) {
      div.draggable = true;
      div.addEventListener('dragstart', (event) => {
        draggedColumn = div;
        dragging = true;
        div.classList.add('draggingColumn');
      });
      div.addEventListener('dragend', () => {
        div.classList.remove('draggingColumn');
        draggedColumn = null;
        dragging = false;
      });
    }

    function attachBoard(container) {
      container.addEventListener('dragover', (event) => {
        if (!draggedColumn) { return; }
        event.preventDefault();
        container.classList.add('dragover');
        const siblings = Array.from(container.querySelectorAll('.column')).filter((c) => c !== draggedColumn);
        let next = null;
        for (const sib of siblings) {
          const rect = sib.getBoundingClientRect();
          if (event.clientX < rect.left + rect.width / 2) { next = sib; break; }
        }
        if (next) { container.insertBefore(draggedColumn, next); } else { container.appendChild(draggedColumn); }
      });
      container.addEventListener('dragleave', () => container.classList.remove('dragover'));
      container.addEventListener('drop', (event) => {
        if (!draggedColumn) { return; }
        event.preventDefault();
        container.classList.remove('dragover');
        const columnNames = Array.from(container.querySelectorAll('.column')).map((c) => c.dataset.column);
        syncStateEl.textContent = 'saving…';
        vscode.postMessage({ type: 'reorderColumns', columnNames });
      });
    }

    function columnEl(col, groupByLabel) {
      const div = document.createElement('div');
      div.className = 'column';
      div.dataset.column = col.name;
      const header = document.createElement('div');
      header.className = 'columnHeader';
      header.textContent = col.name === '' ? '(no ' + groupByLabel + ')' : col.name;
      const list = document.createElement('ul');
      list.className = 'cardList';
      col.cards.forEach((card) => list.appendChild(cardEl(card)));
      attachList(list);
      attachColumn(div);
      div.appendChild(header);
      div.appendChild(list);
      return div;
    }

    attachBoard(board);

    function render(state) {
      groupByLabelEl.textContent = state.groupByLabel;
      board.innerHTML = '';
      state.columns.forEach((col) => board.appendChild(columnEl(col, state.groupByLabel)));
    }

    document.getElementById('addColumnBtn').addEventListener('click', () => {
      const input = document.getElementById('newColumnName');
      const name = input.value.trim();
      if (!name) { return; }
      if (board.querySelector('.column[data-column="' + CSS.escape(name) + '"]')) { return; }
      const col = columnEl({ name, cards: [] }, groupByLabelEl.textContent);
      board.appendChild(col);
      input.value = '';
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'synced') {
        syncStateEl.textContent = 'synced';
        return;
      }
      if (msg.type === 'saveFailed') {
        syncStateEl.textContent = 'save failed';
        return;
      }
      if (msg.type === 'refresh') {
        if (dragging) { return; } // don't yank a card out from under an in-progress drag
        render({ groupByLabel: msg.groupByLabel, columns: msg.columns });
        syncStateEl.textContent = 'synced';
      }
    });

    render(${JSON.stringify(initialPayload)});
  </script>
</body>
</html>`;
}

export async function openKanbanViewPanel(client: EtapiClient, boardNote: Note): Promise<void> {
  let state = await loadBoardState(client, boardNote);

  const panel = vscode.window.createWebviewPanel(
    'triliumKanbanView',
    boardNote.title,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  panel.webview.html = buildHtml(panel.webview, boardNote.title, state);

  async function persistMove(msg: KanbanMoveMessage): Promise<void> {
    await Promise.all(msg.columnNoteIds.map(async (noteId, index) => {
      const branchId = state.branchByNoteId.get(noteId);
      if (!branchId) {
        throw new Error(`Missing branch for note ${noteId}`);
      }
      await client.patchBranch(branchId, { notePosition: (index + 1) * 10 });
    }));

    const existing = state.attributeByNoteId.get(msg.noteId);
    if (msg.toColumn === NO_VALUE_COLUMN) {
      if (existing) {
        await client.deleteAttribute(existing.attributeId);
      }
    } else if (existing) {
      if (existing.value !== msg.toColumn) {
        await client.patchAttribute(existing.attributeId, { value: msg.toColumn });
      }
    } else {
      await client.createAttribute(msg.noteId, 'label', state.groupByLabel, msg.toColumn);
    }

    await client.refreshNoteOrdering(boardNote.noteId);
  }

  async function persistColumnOrder(msg: KanbanReorderColumnsMessage): Promise<void> {
    const serializedOrder = JSON.stringify(msg.columnNames);
    if (state.columnOrderAttribute) {
      await client.patchAttribute(state.columnOrderAttribute.attributeId, { value: serializedOrder });
    } else {
      await client.createAttribute(boardNote.noteId, 'label', COLUMN_ORDER_LABEL, serializedOrder);
    }
  }

  const messageDisposable = panel.webview.onDidReceiveMessage(async (msg: KanbanMessage) => {
    try {
      if (msg.type === 'move') {
        await persistMove(msg);
      } else if (msg.type === 'reorderColumns') {
        await persistColumnOrder(msg);
      } else {
        return;
      }
      // Re-fetch so our local attribute/branch maps (used by the next move and by
      // the refresh poll's diff) reflect what was just written.
      state = await loadBoardState(client, boardNote);
      lastSignature = JSON.stringify(state.columns);
      void panel.webview.postMessage({ type: 'synced' });
    } catch (err) {
      void panel.webview.postMessage({ type: 'saveFailed' });
      void vscode.window.showErrorMessage(`Trilium: Failed to save board change: ${err}`);
    }
  });

  let lastSignature = JSON.stringify(state.columns);
  const refreshTimer = setInterval(async () => {
    if (!panel.visible) {
      return;
    }
    try {
      const fresh = await loadBoardState(client, boardNote);
      const signature = JSON.stringify(fresh.columns);
      if (signature !== lastSignature) {
        state = fresh;
        lastSignature = signature;
        void panel.webview.postMessage({
          type: 'refresh',
          groupByLabel: fresh.groupByLabel,
          columns: fresh.columns,
        });
      }
    } catch {
      // Transient fetch failures (e.g. momentarily disconnected) just skip this tick.
    }
  }, REFRESH_INTERVAL_MS);

  panel.onDidDispose(() => {
    clearInterval(refreshTimer);
    messageDisposable.dispose();
  });
}
