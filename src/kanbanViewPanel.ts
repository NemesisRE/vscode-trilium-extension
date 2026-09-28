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
interface KanbanArchiveColumnMessage {
  type: 'archiveColumn';
  columnName: string;
  archived: boolean;
}
interface KanbanDeleteColumnMessage {
  type: 'deleteColumn';
  columnName: string;
}
interface KanbanSetColumnColorMessage {
  type: 'setColumnColor';
  columnName: string;
  color: string | undefined;
}
type KanbanMessage =
  | KanbanMoveMessage
  | KanbanReorderColumnsMessage
  | KanbanArchiveColumnMessage
  | KanbanDeleteColumnMessage
  | KanbanSetColumnColorMessage;

interface CardEntry {
  noteId: string;
  title: string;
}

interface ColumnState {
  name: string;
  cards: CardEntry[];
  archived: boolean;
  displayName?: string;
  color?: string;
}

/**
 * Matches Trilium's own `BoardColumnData` (apps/client/src/widgets/collections/board/index.tsx
 * in TriliumNext/Trilium) field-for-field, so metadata it stores per column - notably `color`
 * and `icon` - round-trips through this extension instead of being silently dropped.
 */
interface BoardColumnData {
  value: string;
  id?: string;
  icon?: string;
  color?: string;
  archived?: boolean;
  collapsed?: boolean;
  keepCollapsed?: boolean;
  nested?: boolean;
  displayName?: string;
  limit?: number;
  orderBy?: string;
  descendingOrder?: boolean;
  [key: string]: unknown;
}

interface BoardState {
  groupByLabel: string;
  columns: ColumnState[];
  attributeByNoteId: Map<string, Attribute | undefined>;
  branchByNoteId: Map<string, string>;
}

const NO_VALUE_COLUMN = '';
const REFRESH_INTERVAL_MS = 6000;
const BOARD_JSON_ATTACHMENT_TITLE = 'board.json';

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
 * The key holding a board's column list inside its `board.json` viewConfig attachment.
 * This mirrors Trilium's own `boardColumnsKey()` (packages/commons/src/lib/board_columns.ts):
 * the default `#status` grouping's columns live under `"columns"`, any other
 * `#board:groupBy` value gets its own `"<label>ViewColumns"` key so different
 * groupings don't clobber each other's column list/order.
 */
function boardColumnsKey(groupByLabel: string): string {
  return groupByLabel === 'status' ? 'columns' : `${groupByLabel}ViewColumns`;
}

/**
 * Reads and parses the board note's `board.json` viewConfig attachment - the same
 * attachment Trilium's own native Kanban board reads/writes column order from/to
 * (apps/client/src/widgets/collections/view_mode_storage.ts). Returns an empty object
 * and no attachment id when none exists yet.
 */
async function loadBoardJson(
  client: EtapiClient,
  boardNoteId: string,
): Promise<{ json: Record<string, unknown>; attachmentId: string | undefined }> {
  const attachments = await client.getNoteAttachments(boardNoteId);
  const attachment = attachments.find(
    (a) => a.role === 'viewConfig' && a.title === BOARD_JSON_ATTACHMENT_TITLE,
  );
  if (!attachment) {
    return { json: {}, attachmentId: undefined };
  }
  try {
    const buf = await client.getAttachmentContent(attachment.attachmentId);
    const parsed = JSON.parse(Buffer.from(buf).toString('utf-8'));
    if (parsed && typeof parsed === 'object') {
      return { json: parsed as Record<string, unknown>, attachmentId: attachment.attachmentId };
    }
  } catch {
    // fall through to an empty config below
  }
  return { json: {}, attachmentId: attachment.attachmentId };
}

async function saveBoardJson(
  client: EtapiClient,
  boardNoteId: string,
  attachmentId: string | undefined,
  json: Record<string, unknown>,
): Promise<string> {
  const content = JSON.stringify(json);
  if (attachmentId) {
    await client.putAttachmentContentBinary(attachmentId, Buffer.from(content, 'utf-8'));
    return attachmentId;
  }
  const created = await client.createAttachment(
    boardNoteId, 'viewConfig', 'application/json', BOARD_JSON_ATTACHMENT_TITLE, content,
  );
  return created.attachmentId;
}

function parseBoardColumns(boardJson: Record<string, unknown>, columnsKey: string): BoardColumnData[] {
  return Array.isArray(boardJson[columnsKey])
    ? (boardJson[columnsKey] as unknown[]).filter(
      (c): c is BoardColumnData => !!c && typeof c === 'object' && typeof (c as BoardColumnData).value === 'string',
    )
    : [];
}

/**
 * Appends genuinely new, non-inbox column values discovered from cards to the
 * persisted list, without touching the position of any existing entry. The inbox
 * (`""`) is deliberately never force-added here: Trilium treats it as implicit and
 * doesn't require a stored entry for it, so persisting one on every load/poll just
 * because some card happens to lack the label would cause a write on almost every
 * poll - and each such write is a read-modify-write race against anything the user
 * or Trilium's own client changes (e.g. a column color) in between our last read
 * and that write.
 */
function computeStorageColumnOrder(persisted: string[], discovered: string[]): string[] {
  const merged = [...persisted];
  const mergedSet = new Set(merged);
  for (const name of discovered) {
    if (name === NO_VALUE_COLUMN || mergedSet.has(name)) {
      continue;
    }
    merged.push(name);
    mergedSet.add(name);
  }
  return merged;
}

/** The storage order, plus the inbox pinned at the front for display if it has no stored position. */
function computeDisplayColumnOrder(storageOrder: string[]): string[] {
  return storageOrder.includes(NO_VALUE_COLUMN) ? storageOrder : [NO_VALUE_COLUMN, ...storageOrder];
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

  const columnsKey = boardColumnsKey(groupByLabel);
  const { json: boardJson, attachmentId } = await loadBoardJson(client, parent.noteId);
  const rawColumns = parseBoardColumns(boardJson, columnsKey);
  const persistedOrder = rawColumns.map((c) => c.value);

  const storageOrder = computeStorageColumnOrder(persistedOrder, discoveredOrder);

  // Self-heal: only write back when a genuinely new (non-inbox) column value showed
  // up that isn't tracked yet - never just to reorder or to add an implicit inbox
  // entry. That keeps writes rare (instead of on almost every poll) and avoids
  // clobbering metadata (colors, archived flags, ...) Trilium's own client - or the
  // user, moments earlier - may have written to the same attachment in between.
  const columnEntryByValue = new Map(rawColumns.map((c) => [c.value, c]));
  if (JSON.stringify(persistedOrder) !== JSON.stringify(storageOrder)) {
    const columnEntries = storageOrder.map((name) => columnEntryByValue.get(name) ?? { value: name });
    await saveBoardJson(client, parent.noteId, attachmentId, { ...boardJson, [columnsKey]: columnEntries });
    for (const entry of columnEntries) {
      columnEntryByValue.set(entry.value, entry);
    }
  }

  const displayOrder = computeDisplayColumnOrder(storageOrder);

  const attributeByNoteId = new Map(children.map((c) => [
    c.noteId,
    (c.attributes ?? []).find((a) => a.type === 'label' && a.name === groupByLabel),
  ]));

  return {
    groupByLabel,
    columns: displayOrder.map((name) => {
      const entry = columnEntryByValue.get(name);
      return {
        name,
        cards: cardsByColumn.get(name) ?? [],
        archived: entry?.archived === true,
        displayName: entry?.displayName,
        color: entry?.color,
      };
    }),
    attributeByNoteId,
    branchByNoteId: branchByNoteId as Map<string, string>,
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
    .column { border-top: 3px solid var(--vscode-editorWidget-border); }
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
    .columnHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      cursor: grab;
    }
    .columnTitle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .columnActions { display: flex; gap: 2px; flex: 0 0 auto; }
    .columnActions button {
      padding: 2px 5px;
      font-size: 11px;
      background: transparent;
      border-color: transparent;
    }
    .columnActions button:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-button-secondaryBackground)); }
    .columnColor {
      width: 20px;
      height: 20px;
      padding: 0;
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 3px;
      background: none;
      cursor: pointer;
    }
    .column.draggingColumn { opacity: 0.5; }
    .column.archived { opacity: 0.5; }
    .board.dragover { outline: 1px dashed var(--vscode-focusBorder); }
    .toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .toolbar label { font-size: 12px; color: var(--vscode-descriptionForeground); display: flex; align-items: center; gap: 4px; }
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
    <div class="toolbar">
      <div class="addColumn">
        <input id="newColumnName" type="text" placeholder="New column value" />
        <button id="addColumnBtn">Add Column</button>
      </div>
      <label><input type="checkbox" id="showArchived" /> Show archived columns</label>
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

    function columnTitle(col, groupByLabel) {
      if (col.displayName) { return col.displayName; }
      return col.name === '' ? 'Inbox' : col.name;
    }

    function columnEl(col, groupByLabel) {
      const div = document.createElement('div');
      div.className = 'column' + (col.archived ? ' archived' : '');
      div.dataset.column = col.name;
      div.dataset.archived = col.archived ? 'true' : 'false';
      div.style.borderTopColor = col.color || '';
      const header = document.createElement('div');
      header.className = 'columnHeader';
      const title = document.createElement('span');
      title.className = 'columnTitle';
      title.textContent = columnTitle(col, groupByLabel);
      header.appendChild(title);

      const actions = document.createElement('div');
      actions.className = 'columnActions';
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.className = 'columnColor';
      colorInput.title = 'Column color';
      colorInput.value = col.color || '#808080';
      colorInput.addEventListener('click', (event) => event.stopPropagation());
      colorInput.addEventListener('change', () => {
        syncStateEl.textContent = 'saving…';
        vscode.postMessage({ type: 'setColumnColor', columnName: col.name, color: colorInput.value });
      });
      actions.appendChild(colorInput);
      if (col.color) {
        const clearColorBtn = document.createElement('button');
        clearColorBtn.textContent = '✕';
        clearColorBtn.title = 'Clear column color';
        clearColorBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          syncStateEl.textContent = 'saving…';
          vscode.postMessage({ type: 'setColumnColor', columnName: col.name, color: undefined });
        });
        actions.appendChild(clearColorBtn);
      }
      const archiveBtn = document.createElement('button');
      archiveBtn.textContent = col.archived ? 'Unarchive' : 'Archive';
      archiveBtn.title = col.archived ? 'Unarchive column' : 'Archive column';
      archiveBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        syncStateEl.textContent = 'saving…';
        vscode.postMessage({ type: 'archiveColumn', columnName: col.name, archived: !col.archived });
      });
      actions.appendChild(archiveBtn);
      if (col.name !== '') {
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.title = 'Delete column';
        deleteBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          syncStateEl.textContent = 'saving…';
          vscode.postMessage({ type: 'deleteColumn', columnName: col.name });
        });
        actions.appendChild(deleteBtn);
      }
      header.appendChild(actions);

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
    let lastState = null;
    const showArchivedEl = document.getElementById('showArchived');

    function render(state) {
      lastState = state;
      groupByLabelEl.textContent = state.groupByLabel;
      board.innerHTML = '';
      const showArchived = showArchivedEl.checked;
      state.columns
        .filter((col) => showArchived || !col.archived)
        .forEach((col) => board.appendChild(columnEl(col, state.groupByLabel)));
    }

    showArchivedEl.addEventListener('change', () => {
      if (lastState) { render(lastState); }
    });

    document.getElementById('addColumnBtn').addEventListener('click', () => {
      const input = document.getElementById('newColumnName');
      const name = input.value.trim();
      if (!name) { return; }
      if (board.querySelector('.column[data-column="' + CSS.escape(name) + '"]')) { return; }
      const col = columnEl({ name, cards: [] }, groupByLabelEl.textContent);
      board.appendChild(col);
      input.value = '';
      const columnNames = Array.from(board.querySelectorAll('.column')).map((c) => c.dataset.column);
      syncStateEl.textContent = 'saving…';
      vscode.postMessage({ type: 'reorderColumns', columnNames });
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

  // All of the functions below re-fetch board.json immediately before writing to it
  // (rather than reusing the possibly several-seconds-stale `state.boardJson`), so a
  // column color or other metadata someone set - in Trilium's own client, or via a
  // different action here moments earlier - can't get clobbered by a write built off
  // an outdated snapshot.
  async function withFreshBoardColumns<T>(
    mutate: (columns: BoardColumnData[]) => T,
  ): Promise<T> {
    const { json, attachmentId } = await loadBoardJson(client, boardNote.noteId);
    const columnsKey = boardColumnsKey(state.groupByLabel);
    const columns = parseBoardColumns(json, columnsKey);
    const result = mutate(columns);
    await saveBoardJson(client, boardNote.noteId, attachmentId, { ...json, [columnsKey]: columns });
    return result;
  }

  async function persistColumnOrder(msg: KanbanReorderColumnsMessage): Promise<void> {
    await withFreshBoardColumns((columns) => {
      const entryByValue = new Map(columns.map((c) => [c.value, c]));
      const newColumns = msg.columnNames
        // Never force-persist a bare inbox stub - only keep it if it already carried
        // saved customization (color, archived, displayName, ...).
        .filter((name) => name !== NO_VALUE_COLUMN || entryByValue.has(NO_VALUE_COLUMN))
        .map((name) => entryByValue.get(name) ?? { value: name });
      columns.length = 0;
      columns.push(...newColumns);
    });
  }

  async function persistArchiveColumn(msg: KanbanArchiveColumnMessage): Promise<void> {
    await withFreshBoardColumns((columns) => {
      const existing = columns.find((c) => c.value === msg.columnName);
      if (existing) {
        existing.archived = msg.archived;
      } else {
        columns.push({ value: msg.columnName, archived: msg.archived });
      }
    });
  }

  async function persistSetColumnColor(msg: KanbanSetColumnColorMessage): Promise<void> {
    await withFreshBoardColumns((columns) => {
      const existing = columns.find((c) => c.value === msg.columnName);
      if (existing) {
        if (msg.color) {
          existing.color = msg.color;
        } else {
          delete existing.color;
        }
      } else if (msg.color) {
        columns.push({ value: msg.columnName, color: msg.color });
      }
    });
  }

  async function persistDeleteColumn(msg: KanbanDeleteColumnMessage): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `Delete column "${msg.columnName}"? Cards in it will move to Inbox (the label is removed, notes are kept).`,
      { modal: true },
      'Delete',
    );
    if (confirm !== 'Delete') {
      return;
    }
    const column = state.columns.find((c) => c.name === msg.columnName);
    if (column) {
      await Promise.all(column.cards.map(async (card) => {
        const attr = state.attributeByNoteId.get(card.noteId);
        if (attr) {
          await client.deleteAttribute(attr.attributeId);
        }
      }));
    }
    await withFreshBoardColumns((columns) => {
      const index = columns.findIndex((c) => c.value === msg.columnName);
      if (index !== -1) {
        columns.splice(index, 1);
      }
    });
  }

  const messageDisposable = panel.webview.onDidReceiveMessage(async (msg: KanbanMessage) => {
    try {
      if (msg.type === 'move') {
        await persistMove(msg);
      } else if (msg.type === 'reorderColumns') {
        await persistColumnOrder(msg);
      } else if (msg.type === 'archiveColumn') {
        await persistArchiveColumn(msg);
      } else if (msg.type === 'deleteColumn') {
        await persistDeleteColumn(msg);
      } else if (msg.type === 'setColumnColor') {
        await persistSetColumnColor(msg);
      } else {
        return;
      }
      // Re-fetch so our local attribute/branch maps (used by the next move and by
      // the refresh poll's diff) reflect what was just written.
      state = await loadBoardState(client, boardNote);
      lastSignature = JSON.stringify(state.columns);
      void panel.webview.postMessage({ type: 'refresh', groupByLabel: state.groupByLabel, columns: state.columns });
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
