import * as vscode from 'vscode';
import { Attribute, EtapiClient, Note } from './etapiClient';
import { getIconSvg, showIconPickerPanel } from './iconPickerPanel';
import { effectiveIconClassForNote } from './noteTreeProvider';

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
interface KanbanRenameColumnMessage {
  type: 'renameColumn';
  columnName: string;
  newTitle: string;
}
interface KanbanSetColumnIconMessage {
  type: 'setColumnIcon';
  columnName: string;
  icon: string | undefined;
}
interface KanbanAddColumnMessage {
  type: 'addColumn';
  name: string;
  icon: string | undefined;
}
interface KanbanShowIconPickerMessage {
  type: 'showIconPicker';
  id: string;
}
interface KanbanSetGroupByLabelMessage {
  type: 'setGroupByLabel';
  label: string;
}
interface KanbanCreateCardMessage {
  type: 'createCard';
  columnName: string;
  title: string;
}
interface KanbanOpenCardMessage {
  type: 'openCard';
  noteId: string;
}
interface KanbanRenameCardMessage {
  type: 'renameCard';
  noteId: string;
  newTitle: string;
}
interface KanbanSetCardIconMessage {
  type: 'setCardIcon';
  noteId: string;
  icon: string | undefined;
}
interface KanbanDeleteCardMessage {
  type: 'deleteCard';
  noteId: string;
}
type KanbanMessage =
  | KanbanMoveMessage
  | KanbanReorderColumnsMessage
  | KanbanArchiveColumnMessage
  | KanbanDeleteColumnMessage
  | KanbanSetColumnColorMessage
  | KanbanRenameColumnMessage
  | KanbanSetColumnIconMessage
  | KanbanAddColumnMessage
  | KanbanShowIconPickerMessage
  | KanbanSetGroupByLabelMessage
  | KanbanCreateCardMessage
  | KanbanOpenCardMessage
  | KanbanRenameCardMessage
  | KanbanSetCardIconMessage
  | KanbanDeleteCardMessage;

interface CardEntry {
  noteId: string;
  title: string;
  icon?: string;
  iconSvg?: string;
  hasCustomIcon: boolean;
}

interface ColumnState {
  name: string;
  cards: CardEntry[];
  archived: boolean;
  displayName?: string;
  color?: string;
  icon?: string;
  /** Inline SVG for `icon`, resolved host-side so the CSP-restrictive webview never needs the icon font. */
  iconSvg?: string;
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
  /** Distinct label names found on the board's cards, for the "Status" grouping dropdown. */
  availableGroupByLabels: string[];
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

async function loadBoardState(client: EtapiClient, boardNote: Note, context: vscode.ExtensionContext): Promise<BoardState> {
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
    const hasCustomIcon = (child.attributes ?? []).some((a) => a.type === 'label' && a.name === 'iconClass');
    cardsByColumn.get(value)!.push({
      noteId: child.noteId,
      title: child.title,
      icon: effectiveIconClassForNote(child),
      hasCustomIcon,
    });
  }
  // Resolve each card's icon to inline SVG in a separate pass (after cards are placed
  // in their columns in stable order) so concurrent resolution can't reorder cards.
  await Promise.all(
    Array.from(cardsByColumn.values()).flat().map(async (card) => {
      card.iconSvg = card.icon ? await getIconSvg(context, card.icon) : undefined;
    }),
  );
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

  const labelNames = new Set<string>(['status', groupByLabel]);
  for (const child of children) {
    for (const attr of child.attributes ?? []) {
      if (attr.type === 'label') {
        labelNames.add(attr.name);
      }
    }
  }
  const availableGroupByLabels = Array.from(labelNames).sort();

  const columns = await Promise.all(displayOrder.map(async (name) => {
    const entry = columnEntryByValue.get(name);
    const icon = entry?.icon;
    return {
      name,
      cards: cardsByColumn.get(name) ?? [],
      archived: entry?.archived === true,
      displayName: entry?.displayName,
      color: entry?.color,
      icon,
      iconSvg: icon ? await getIconSvg(context, icon) : undefined,
    };
  }));

  return {
    groupByLabel,
    columns,
    availableGroupByLabels,
    attributeByNoteId,
    branchByNoteId: branchByNoteId as Map<string, string>,
  };
}

function buildHtml(webview: vscode.Webview, boardTitle: string, initialState: BoardState): string {
  const nonce = createNonce();
  const initialPayload = {
    groupByLabel: initialState.groupByLabel,
    columns: initialState.columns,
    availableGroupByLabels: initialState.availableGroupByLabels,
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
    .header { font-size: 13px; color: var(--vscode-descriptionForeground); display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
    .headerRight { display: flex; align-items: center; gap: 8px; }
    .statusSelect {
      background: var(--vscode-dropdown-background, var(--vscode-input-background));
      color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
      border-radius: 4px;
      padding: 3px 6px;
      font: inherit;
    }
    .filterInput {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      padding: 3px 8px;
      font: inherit;
      min-width: 160px;
    }
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
      display: flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 4px;
      padding: 6px 8px;
      background: var(--vscode-editor-background);
      cursor: grab;
      font-size: 13px;
    }
    .card.dragging { opacity: 0.5; }
    .cardIcon { flex: 0 0 auto; display: inline-flex; align-items: center; width: 14px; height: 14px; color: var(--vscode-descriptionForeground); }
    .cardIcon svg { width: 14px; height: 14px; }
    .cardIcon svg *:not([fill="none"]) { fill: currentColor; }
    .cardTitle { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cardTitleInput {
      flex: 1 1 auto;
      min-width: 0;
      font: inherit;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-focusBorder);
      border-radius: 3px;
      padding: 1px 4px;
    }
    .cardList.dragover { outline: 1px dashed var(--vscode-focusBorder); }
    .columnHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      cursor: grab;
    }
    .columnIcon { flex: 0 0 auto; display: inline-flex; align-items: center; width: 16px; height: 16px; }
    .columnIcon svg { width: 16px; height: 16px; }
    .columnIcon svg *:not([fill="none"]) { fill: currentColor; }
    .columnTitle { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .columnCount {
      flex: 0 0 auto;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 10px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      font-size: 11px;
      font-weight: 600;
      line-height: 18px;
      text-align: center;
    }
    .columnTitleInput {
      flex: 1 1 auto;
      min-width: 0;
      font: inherit;
      font-weight: 600;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-focusBorder);
      border-radius: 3px;
      padding: 1px 4px;
    }
    .contextMenu {
      position: fixed;
      display: none;
      flex-direction: column;
      min-width: 150px;
      z-index: 1000;
      background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
      color: var(--vscode-menu-foreground, var(--vscode-foreground));
      border: 1px solid var(--vscode-menu-border, var(--vscode-editorWidget-border));
      border-radius: 4px;
      padding: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    }
    .contextMenu button {
      text-align: left;
      background: transparent;
      border-color: transparent;
      border-radius: 3px;
      padding: 6px 10px;
      font-size: 13px;
    }
    .contextMenu button:hover { background: var(--vscode-list-hoverBackground, var(--vscode-toolbar-hoverBackground)); }
    .column.draggingColumn { opacity: 0.5; }
    .column.archived { opacity: 0.5; }
    .board.dragover { outline: 1px dashed var(--vscode-focusBorder); }
    .addCardRow { padding: 4px 8px 8px; }
    .addCardTrigger {
      width: 100%;
      background: transparent;
      border: 1px solid transparent;
      color: var(--vscode-descriptionForeground);
      text-align: left;
      padding: 4px 6px;
      font-size: 12px;
    }
    .addCardTrigger:hover { color: var(--vscode-foreground); background: var(--vscode-list-hoverBackground); border-radius: 4px; }
    .addCardInput {
      width: 100%;
      box-sizing: border-box;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-focusBorder);
      border-radius: 4px;
      padding: 4px 6px;
      font: inherit;
      font-size: 13px;
    }
    .newColumnCell {
      min-width: 160px;
      max-width: 200px;
      flex: 0 0 auto;
      border: 1px dashed var(--vscode-editorWidget-border);
      border-radius: 6px;
      background: transparent;
      padding: 8px;
    }
    .newColumnTrigger {
      width: 100%;
      background: transparent;
      border: 1px solid transparent;
      color: var(--vscode-descriptionForeground);
      text-align: left;
      padding: 6px 4px;
    }
    .newColumnTrigger:hover { color: var(--vscode-foreground); background: var(--vscode-list-hoverBackground); }
    .newColumnForm { display: flex; flex-direction: column; gap: 6px; }
    .newColumnForm input {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      padding: 4px 8px;
      font: inherit;
    }
    .newColumnIconBtn { align-self: flex-start; display: flex; align-items: center; gap: 6px; }
    .newColumnIconBtn .columnIcon { width: 14px; height: 14px; }
    .newColumnIconBtn .columnIcon svg { width: 14px; height: 14px; }
    .newColumnFormActions { display: flex; gap: 6px; }
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
        <span>Board</span>
        <div class="headerRight">
          <select id="groupBySelect" class="statusSelect" title="Grouped by"></select>
          <input id="boardFilter" class="filterInput" type="text" placeholder="Filter board..." />
          <span class="syncState" id="syncState">synced</span>
        </div>
      </div>
      <div class="parent">${escapeHtml(boardTitle)}</div>
    </div>
    <div class="board" id="board"></div>
  </div>
  <div class="contextMenu" id="columnContextMenu"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const board = document.getElementById('board');
    const groupBySelect = document.getElementById('groupBySelect');
    const filterInput = document.getElementById('boardFilter');
    const syncStateEl = document.getElementById('syncState');
    const contextMenu = document.getElementById('columnContextMenu');
    let dragged = null;
    let dragging = false;
    let draggedColumn = null;

    function hideContextMenu() {
      contextMenu.style.display = 'none';
    }

    function openContextMenu(items, x, y) {
      contextMenu.innerHTML = '';
      items.forEach((item) => {
        const btn = document.createElement('button');
        btn.textContent = item.label;
        btn.addEventListener('click', () => {
          hideContextMenu();
          item.onClick();
        });
        contextMenu.appendChild(btn);
      });
      contextMenu.style.display = 'flex';
      // Clamp so the menu never opens off the right/bottom edge of the panel.
      const maxLeft = Math.max(0, window.innerWidth - contextMenu.offsetWidth - 4);
      const maxTop = Math.max(0, window.innerHeight - contextMenu.offsetHeight - 4);
      contextMenu.style.left = Math.min(x, maxLeft) + 'px';
      contextMenu.style.top = Math.min(y, maxTop) + 'px';
    }

    function requestIconPicker() {
      return new Promise((resolve) => {
        const id = 'icon-' + Math.random().toString(36).slice(2);
        const handler = (event) => {
          const msg = event.data;
          if (msg.type === 'iconPickerResult' && msg.id === id) {
            window.removeEventListener('message', handler);
            resolve(msg.iconClass);
          }
        };
        window.addEventListener('message', handler);
        vscode.postMessage({ type: 'showIconPicker', id });
      });
    }

    document.addEventListener('click', hideContextMenu);
    document.addEventListener('contextmenu', (event) => {
      if (event.target.closest('.columnHeader')) { return; } // handled by the column's own menu
      if (event.target.closest('input, select')) { hideContextMenu(); return; } // keep the native menu in form controls
      event.preventDefault();
      const items = [{
        label: showArchived ? 'Hide archived columns' : 'Show archived columns',
        onClick: () => {
          showArchived = !showArchived;
          if (lastState) { render(lastState); }
        },
      }];
      openContextMenu(items, event.clientX, event.clientY);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { hideContextMenu(); }
    });

    function cardEl(card, columnName) {
      const li = document.createElement('li');
      li.className = 'card';
      li.draggable = true;
      li.dataset.noteId = card.noteId;

      if (card.iconSvg) {
        const icon = document.createElement('span');
        icon.className = 'cardIcon';
        icon.innerHTML = card.iconSvg;
        li.appendChild(icon);
      }

      const title = document.createElement('span');
      title.className = 'cardTitle';
      title.textContent = card.title;
      li.appendChild(title);

      function startCardRename() {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cardTitleInput';
        input.value = card.title;
        li.replaceChild(input, title);
        input.focus();
        input.select();
        input.addEventListener('click', (event) => event.stopPropagation());
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') { input.blur(); }
          if (event.key === 'Escape') { input.value = card.title; input.blur(); }
        });
        input.addEventListener('blur', () => {
          li.replaceChild(title, input);
          const newTitle = input.value.trim();
          if (!newTitle || newTitle === card.title) { return; }
          syncStateEl.textContent = 'saving…';
          vscode.postMessage({ type: 'renameCard', noteId: card.noteId, newTitle });
        });
      }

      li.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const items = [
          { label: 'Open Note', onClick: () => vscode.postMessage({ type: 'openCard', noteId: card.noteId }) },
          { label: 'Rename', onClick: startCardRename },
          {
            label: 'Set Icon…', onClick: async () => {
              const iconClass = await requestIconPicker();
              if (iconClass === undefined) { return; }
              syncStateEl.textContent = 'saving…';
              vscode.postMessage({ type: 'setCardIcon', noteId: card.noteId, icon: iconClass });
            },
          },
        ];
        if (card.hasCustomIcon) {
          items.push({
            label: 'Clear Icon', onClick: () => {
              syncStateEl.textContent = 'saving…';
              vscode.postMessage({ type: 'setCardIcon', noteId: card.noteId, icon: undefined });
            },
          });
        }
        const otherColumns = (lastState ? lastState.columns : []).filter((c) => c.name !== columnName && !c.archived);
        otherColumns.forEach((c) => {
          items.push({
            label: 'Move to ' + columnTitle(c, lastState.groupByLabel),
            onClick: () => {
              const columnNoteIds = c.cards.map((existing) => existing.noteId).concat(card.noteId);
              syncStateEl.textContent = 'saving…';
              vscode.postMessage({ type: 'move', noteId: card.noteId, toColumn: c.name, columnNoteIds });
            },
          });
        });
        items.push({
          label: 'Delete Note…', onClick: () => {
            syncStateEl.textContent = 'saving…';
            vscode.postMessage({ type: 'deleteCard', noteId: card.noteId });
          },
        });
        openContextMenu(items, event.clientX, event.clientY);
      });

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
        if (next) {
          container.insertBefore(draggedColumn, next);
        } else {
          const trailing = container.querySelector('.newColumnCell');
          if (trailing) { container.insertBefore(draggedColumn, trailing); } else { container.appendChild(draggedColumn); }
        }
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
      div.style.background = col.color
        ? 'color-mix(in srgb, ' + col.color + ' 18%, var(--vscode-sideBar-background))'
        : '';
      const header = document.createElement('div');
      header.className = 'columnHeader';
      if (col.iconSvg) {
        const icon = document.createElement('span');
        icon.className = 'columnIcon';
        icon.innerHTML = col.iconSvg;
        if (col.color) { icon.style.color = col.color; }
        header.appendChild(icon);
      }
      const title = document.createElement('span');
      title.className = 'columnTitle';
      title.textContent = columnTitle(col, groupByLabel);
      header.appendChild(title);

      const count = document.createElement('span');
      count.className = 'columnCount';
      count.textContent = String(col.cards.length);
      header.appendChild(count);

      function startRename() {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'columnTitleInput';
        input.value = columnTitle(col, groupByLabel);
        header.replaceChild(input, title);
        input.focus();
        input.select();
        input.addEventListener('click', (event) => event.stopPropagation());
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') { input.blur(); }
          if (event.key === 'Escape') { input.value = columnTitle(col, groupByLabel); input.blur(); }
        });
        input.addEventListener('blur', () => {
          header.replaceChild(title, input);
          const newTitle = input.value.trim();
          if (!newTitle || newTitle === columnTitle(col, groupByLabel)) { return; }
          syncStateEl.textContent = 'saving…';
          vscode.postMessage({ type: 'renameColumn', columnName: col.name, newTitle });
        });
      }

      // Not shown - clicked programmatically from the "Set Color" context menu item
      // so the native color picker can open without a permanently visible swatch.
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.style.display = 'none';
      colorInput.value = col.color || '#808080';
      colorInput.addEventListener('change', () => {
        syncStateEl.textContent = 'saving…';
        vscode.postMessage({ type: 'setColumnColor', columnName: col.name, color: colorInput.value });
      });
      div.appendChild(colorInput);

      header.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const items = [
          { label: 'Rename', onClick: startRename },
          { label: 'Set Color…', onClick: () => colorInput.click() },
        ];
        if (col.color) {
          items.push({
            label: 'Clear Color', onClick: () => {
              syncStateEl.textContent = 'saving…';
              vscode.postMessage({ type: 'setColumnColor', columnName: col.name, color: undefined });
            },
          });
        }
        items.push({
          label: 'Set Icon…', onClick: async () => {
            const iconClass = await requestIconPicker();
            if (iconClass === undefined) { return; }
            syncStateEl.textContent = 'saving…';
            vscode.postMessage({ type: 'setColumnIcon', columnName: col.name, icon: iconClass });
          },
        });
        if (col.icon) {
          items.push({
            label: 'Clear Icon', onClick: () => {
              syncStateEl.textContent = 'saving…';
              vscode.postMessage({ type: 'setColumnIcon', columnName: col.name, icon: undefined });
            },
          });
        }
        items.push({
          label: col.archived ? 'Unarchive' : 'Archive', onClick: () => {
            syncStateEl.textContent = 'saving…';
            vscode.postMessage({ type: 'archiveColumn', columnName: col.name, archived: !col.archived });
          },
        });
        if (col.name !== '') {
          items.push({
            label: 'Delete…', onClick: () => {
              syncStateEl.textContent = 'saving…';
              vscode.postMessage({ type: 'deleteColumn', columnName: col.name });
            },
          });
        }
        openContextMenu(items, event.clientX, event.clientY);
      });

      const list = document.createElement('ul');
      list.className = 'cardList';
      col.cards.forEach((card) => list.appendChild(cardEl(card, col.name)));
      attachList(list);
      attachColumn(div);

      const addCardRow = document.createElement('div');
      addCardRow.className = 'addCardRow';

      function renderAddCardIdle() {
        addCardRow.innerHTML = '';
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'addCardTrigger';
        trigger.textContent = '+ New Element';
        trigger.addEventListener('click', (event) => { event.stopPropagation(); renderAddCardForm(); });
        addCardRow.appendChild(trigger);
      }

      function renderAddCardForm() {
        addCardRow.innerHTML = '';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'addCardInput';
        input.placeholder = 'Title';
        input.addEventListener('click', (event) => event.stopPropagation());
        function submit() {
          const cardTitle = input.value.trim();
          if (!cardTitle) {
            renderAddCardIdle();
            return;
          }
          syncStateEl.textContent = 'saving…';
          vscode.postMessage({ type: 'createCard', columnName: col.name, title: cardTitle });
          renderAddCardIdle();
        }
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') { submit(); }
          if (event.key === 'Escape') { renderAddCardIdle(); }
        });
        input.addEventListener('blur', renderAddCardIdle);
        addCardRow.appendChild(input);
        input.focus();
      }

      renderAddCardIdle();

      div.appendChild(header);
      div.appendChild(list);
      div.appendChild(addCardRow);
      return div;
    }

    function newColumnCellEl() {
      const div = document.createElement('div');
      div.className = 'newColumnCell';

      function renderIdle() {
        div.innerHTML = '';
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'newColumnTrigger';
        trigger.textContent = '+ New Column';
        trigger.addEventListener('click', renderForm);
        div.appendChild(trigger);
      }

      function renderForm() {
        div.innerHTML = '';
        let chosenIcon;

        const form = document.createElement('div');
        form.className = 'newColumnForm';

        const iconBtn = document.createElement('button');
        iconBtn.type = 'button';
        iconBtn.className = 'newColumnIconBtn';
        iconBtn.textContent = 'Icon…';
        iconBtn.addEventListener('click', async () => {
          const iconClass = await requestIconPicker();
          if (iconClass === undefined) { return; }
          chosenIcon = iconClass;
          iconBtn.textContent = iconClass;
        });

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = 'Column name';
        nameInput.addEventListener('click', (event) => event.stopPropagation());

        function submit() {
          const name = nameInput.value.trim();
          if (!name) { return; }
          if (lastState && lastState.columns.some((c) => c.name === name)) { return; }
          syncStateEl.textContent = 'saving…';
          vscode.postMessage({ type: 'addColumn', name, icon: chosenIcon });
          renderIdle();
        }

        nameInput.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') { submit(); }
          if (event.key === 'Escape') { renderIdle(); }
        });

        const actions = document.createElement('div');
        actions.className = 'newColumnFormActions';
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.textContent = 'Add';
        addBtn.addEventListener('click', submit);
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', renderIdle);
        actions.appendChild(addBtn);
        actions.appendChild(cancelBtn);

        form.appendChild(iconBtn);
        form.appendChild(nameInput);
        form.appendChild(actions);
        div.appendChild(form);
        nameInput.focus();
      }

      renderIdle();
      return div;
    }

    attachBoard(board);
    let lastState = null;
    let filterTerm = '';
    let showArchived = false;

    function applyFilter() {
      board.querySelectorAll('.card').forEach((card) => {
        const match = !filterTerm || card.textContent.toLowerCase().includes(filterTerm);
        card.style.display = match ? '' : 'none';
      });
    }

    function renderGroupBySelect(state) {
      const labels = state.availableGroupByLabels && state.availableGroupByLabels.length
        ? state.availableGroupByLabels
        : [state.groupByLabel];
      groupBySelect.innerHTML = '';
      labels.forEach((label) => {
        const opt = document.createElement('option');
        opt.value = label;
        opt.textContent = label;
        groupBySelect.appendChild(opt);
      });
      groupBySelect.value = state.groupByLabel;
    }

    function render(state) {
      lastState = state;
      renderGroupBySelect(state);
      board.innerHTML = '';
      state.columns
        .filter((col) => showArchived || !col.archived)
        .forEach((col) => board.appendChild(columnEl(col, state.groupByLabel)));
      board.appendChild(newColumnCellEl());
      applyFilter();
    }

    groupBySelect.addEventListener('change', () => {
      syncStateEl.textContent = 'saving…';
      vscode.postMessage({ type: 'setGroupByLabel', label: groupBySelect.value });
    });

    filterInput.addEventListener('input', () => {
      filterTerm = filterInput.value.trim().toLowerCase();
      applyFilter();
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
        render({ groupByLabel: msg.groupByLabel, columns: msg.columns, availableGroupByLabels: msg.availableGroupByLabels });
        syncStateEl.textContent = 'synced';
      }
    });

    render(${JSON.stringify(initialPayload)});
  </script>
</body>
</html>`;
}

export async function openKanbanViewPanel(client: EtapiClient, boardNote: Note, context: vscode.ExtensionContext): Promise<void> {
  let state = await loadBoardState(client, boardNote, context);

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

  async function persistRenameColumn(msg: KanbanRenameColumnMessage): Promise<void> {
    if (msg.columnName === NO_VALUE_COLUMN) {
      // The inbox isn't identified by a label value, so "renaming" it is purely a
      // display override (matches Trilium's own setColumnTitle: no card writes).
      await withFreshBoardColumns((columns) => {
        const existing = columns.find((c) => c.value === NO_VALUE_COLUMN);
        if (existing) {
          existing.displayName = msg.newTitle;
        } else {
          columns.push({ value: NO_VALUE_COLUMN, displayName: msg.newTitle });
        }
      });
      return;
    }

    const oldValue = msg.columnName;
    const newValue = msg.newTitle;
    if (oldValue === newValue) {
      return;
    }

    // A normal column's identity IS the label value, so renaming it means bulk-
    // updating that label's value on every card currently in it - mirroring
    // Trilium's own rename-column behavior (packages/trilium-core/.../board.ts) -
    // not just relabeling the column in board.json.
    const column = state.columns.find((c) => c.name === oldValue);
    if (column) {
      await Promise.all(column.cards.map(async (card) => {
        const attr = state.attributeByNoteId.get(card.noteId);
        if (attr) {
          await client.patchAttribute(attr.attributeId, { value: newValue });
        }
      }));
    }

    await withFreshBoardColumns((columns) => {
      const renamed = columns.map((c) => (c.value === oldValue ? { ...c, value: newValue } : c));
      if (!renamed.some((c) => c.value === newValue)) {
        renamed.push({ value: newValue });
      }
      // If newValue collides with an already-tracked column, merge into it (keep
      // the first entry's metadata) rather than persisting two rows for one value.
      const seen = new Set<string>();
      const deduped = renamed.filter((c) => {
        if (seen.has(c.value)) {
          return false;
        }
        seen.add(c.value);
        return true;
      });
      columns.length = 0;
      columns.push(...deduped);
    });
  }

  async function persistSetColumnIcon(msg: KanbanSetColumnIconMessage): Promise<void> {
    await withFreshBoardColumns((columns) => {
      const existing = columns.find((c) => c.value === msg.columnName);
      if (existing) {
        if (msg.icon) {
          existing.icon = msg.icon;
        } else {
          delete existing.icon;
        }
      } else if (msg.icon) {
        columns.push({ value: msg.columnName, icon: msg.icon });
      }
    });
  }

  async function persistAddColumn(msg: KanbanAddColumnMessage): Promise<void> {
    await withFreshBoardColumns((columns) => {
      if (columns.some((c) => c.value === msg.name)) {
        return;
      }
      const entry: BoardColumnData = { value: msg.name };
      if (msg.icon) {
        entry.icon = msg.icon;
      }
      columns.push(entry);
    });
  }

  // The active grouping label lives directly on the board note itself (`#board:groupBy`),
  // not in board.json - matches Trilium's own storage for it.
  async function persistSetGroupByLabel(msg: KanbanSetGroupByLabelMessage): Promise<void> {
    const parent = await client.getNote(boardNote.noteId);
    const existing = (parent.attributes ?? []).find((a) => a.type === 'label' && a.name === 'board:groupBy');
    if (existing) {
      if (existing.value !== msg.label) {
        await client.patchAttribute(existing.attributeId, { value: msg.label });
      }
    } else {
      await client.createAttribute(boardNote.noteId, 'label', 'board:groupBy', msg.label);
    }
  }

  async function persistCreateCard(msg: KanbanCreateCardMessage): Promise<void> {
    const { note } = await client.createNote(boardNote.noteId, msg.title);
    if (msg.columnName !== NO_VALUE_COLUMN) {
      await client.createAttribute(note.noteId, 'label', state.groupByLabel, msg.columnName);
    }
    await client.refreshNoteOrdering(boardNote.noteId);
  }

  async function persistRenameCard(msg: KanbanRenameCardMessage): Promise<void> {
    await client.patchNote(msg.noteId, { title: msg.newTitle });
  }

  // A card's own icon is Trilium's real `#iconClass` label on the note itself - the
  // same attribute Trilium's own note-icon feature reads/writes.
  async function persistSetCardIcon(msg: KanbanSetCardIconMessage): Promise<void> {
    const note = await client.getNote(msg.noteId);
    const existing = (note.attributes ?? []).find((a) => a.type === 'label' && a.name === 'iconClass');
    if (msg.icon) {
      if (existing) {
        if (existing.value !== msg.icon) {
          await client.patchAttribute(existing.attributeId, { value: msg.icon });
        }
      } else {
        await client.createAttribute(msg.noteId, 'label', 'iconClass', msg.icon);
      }
    } else if (existing) {
      await client.deleteAttribute(existing.attributeId);
    }
  }

  async function persistDeleteCard(msg: KanbanDeleteCardMessage): Promise<void> {
    const cardTitle = state.columns.flatMap((c) => c.cards).find((c) => c.noteId === msg.noteId)?.title;
    const confirm = await vscode.window.showWarningMessage(
      `Delete note "${cardTitle ?? msg.noteId}"? This cannot be undone.`,
      { modal: true },
      'Delete',
    );
    if (confirm !== 'Delete') {
      return;
    }
    await client.deleteNote(msg.noteId);
  }

  const messageDisposable = panel.webview.onDidReceiveMessage(async (msg: KanbanMessage) => {
    if (msg.type === 'showIconPicker') {
      const iconClass = await showIconPickerPanel(context);
      void panel.webview.postMessage({ type: 'iconPickerResult', id: msg.id, iconClass });
      return;
    }
    if (msg.type === 'openCard') {
      await vscode.commands.executeCommand('trilium.openNoteById', msg.noteId);
      return;
    }
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
      } else if (msg.type === 'renameColumn') {
        await persistRenameColumn(msg);
      } else if (msg.type === 'setColumnIcon') {
        await persistSetColumnIcon(msg);
      } else if (msg.type === 'addColumn') {
        await persistAddColumn(msg);
      } else if (msg.type === 'setGroupByLabel') {
        await persistSetGroupByLabel(msg);
      } else if (msg.type === 'createCard') {
        await persistCreateCard(msg);
      } else if (msg.type === 'renameCard') {
        await persistRenameCard(msg);
      } else if (msg.type === 'setCardIcon') {
        await persistSetCardIcon(msg);
      } else if (msg.type === 'deleteCard') {
        await persistDeleteCard(msg);
      } else {
        return;
      }
      // Re-fetch so our local attribute/branch maps (used by the next move and by
      // the refresh poll's diff) reflect what was just written.
      state = await loadBoardState(client, boardNote, context);
      lastSignature = JSON.stringify(state.columns);
      void panel.webview.postMessage({
        type: 'refresh',
        groupByLabel: state.groupByLabel,
        columns: state.columns,
        availableGroupByLabels: state.availableGroupByLabels,
      });
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
      const fresh = await loadBoardState(client, boardNote, context);
      const signature = JSON.stringify(fresh.columns);
      if (signature !== lastSignature) {
        state = fresh;
        lastSignature = signature;
        void panel.webview.postMessage({
          type: 'refresh',
          groupByLabel: fresh.groupByLabel,
          columns: fresh.columns,
          availableGroupByLabels: fresh.availableGroupByLabels,
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
