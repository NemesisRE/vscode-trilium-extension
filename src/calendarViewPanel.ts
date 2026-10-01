import * as vscode from 'vscode';
import { EtapiClient, Note } from './etapiClient';
import { effectiveIconClassForNote, NoteItem } from './noteTreeProvider';
import { getIconSvg } from './iconPickerPanel';

type CalendarMessage =
  | OpenDayMessage
  | LoadRangeMessage
  | ArchiveDayNoteMessage
  | DeleteDayNoteMessage
  | SetDayNoteColorMessage;

interface OpenDayMessage {
  type: 'openDay';
  date: string; // YYYY-MM-DD
}

interface LoadRangeMessage {
  type: 'loadRange';
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

interface ArchiveDayNoteMessage {
  type: 'archiveDayNote';
  noteId: string;
}

interface DeleteDayNoteMessage {
  type: 'deleteDayNote';
  noteId: string;
}

interface SetDayNoteColorMessage {
  type: 'setDayNoteColor';
  noteId: string;
  color?: string;
}

// Matches the kanban board's own poll interval.
const REFRESH_INTERVAL_MS = 6000;

interface DayNoteEntry {
  date: string; // YYYY-MM-DD
  noteId: string;
  title: string;
  icon: string;
  iconSvg?: string;
  color?: string;
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 24; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Finds existing day notes (Trilium's `#dateNote` label, an ISO date string) whose date
 * falls within [start, end] - unlike EtapiClient.getDayNote(), this never creates a note
 * as a side effect, so scrolling the calendar doesn't silently populate empty days.
 */
async function searchDayNotesInRange(
  client: EtapiClient,
  start: string,
  end: string,
  context: vscode.ExtensionContext,
): Promise<DayNoteEntry[]> {
  const { results } = await client.searchNotes(
    `#dateNote >= "${start}" #dateNote <= "${end}"`,
    { fastSearch: true },
  );

  const entries: DayNoteEntry[] = [];
  for (const note of results) {
    const dateAttr = (note.attributes ?? []).find(
      (a) => a.type === 'label' && a.name === 'dateNote',
    );
    if (!dateAttr?.value) {
      continue;
    }
    const colorAttr = (note.attributes ?? []).find(
      (a) => a.type === 'label' && a.name === 'color',
    );
    entries.push({
      date: dateAttr.value,
      noteId: note.noteId,
      title: note.title,
      icon: effectiveIconClassForNote(note),
      color: colorAttr?.value,
    });
  }

  // Resolve icon SVGs in a separate pass so out-of-order promise settling can't
  // reorder the entries list (same race-avoidance pattern used for kanban cards).
  await Promise.all(
    entries.map(async (entry) => {
      entry.iconSvg = await getIconSvg(context, entry.icon);
    }),
  );

  return entries;
}

function buildHtml(webview: vscode.Webview, title: string): string {
  const nonce = createNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; }
    .wrap { padding: 14px; display: grid; gap: 10px; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .nav { display: flex; align-items: center; gap: 8px; }
    .periodLabel { font-weight: 600; min-width: 140px; }
    button {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-radius: 4px;
      padding: 4px 10px;
      cursor: pointer;
      font-family: inherit;
    }
    button:hover { background: var(--vscode-list-hoverBackground); }
    .iconBtn { padding: 4px 8px; }
    .tabs { display: flex; gap: 2px; border: 1px solid var(--vscode-editorWidget-border); border-radius: 4px; overflow: hidden; }
    .tab { border: none; border-radius: 0; background: transparent; padding: 4px 12px; }
    .tab.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }

    .settingsWrap { position: relative; }
    .settingsMenu {
      position: absolute; top: 100%; right: 0; margin-top: 4px;
      background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
      color: var(--vscode-menu-foreground, var(--vscode-foreground));
      border: 1px solid var(--vscode-menu-border, var(--vscode-editorWidget-border));
      border-radius: 4px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px;
      font-size: 12px; white-space: nowrap; z-index: 20;
    }
    .settingsMenu[hidden] { display: none; }
    .settingsMenu label { display: flex; align-items: center; gap: 6px; cursor: pointer; }

    .grid { display: grid; gap: 4px; margin-bottom: 4px; }
    .weekday { text-align: center; font-size: 11px; color: var(--vscode-descriptionForeground); padding: 2px 0; }
    .weekNumHeader { }
    .weekNumCell { font-size: 10px; color: var(--vscode-descriptionForeground); display: flex; align-items: center; justify-content: center; }

    .day {
      min-height: 84px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      padding: 6px;
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 4px;
      cursor: pointer;
      background: var(--vscode-sideBar-background);
      overflow: hidden;
    }
    .day:hover, .day:focus { background: var(--vscode-list-hoverBackground); outline: none; }
    .day.empty { visibility: hidden; cursor: default; }

    .day-number {
      font-size: 12px;
      width: 22px;
      height: 22px;
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
    }
    .day-number.today {
      background: var(--vscode-foreground);
      color: var(--vscode-editor-background);
      font-weight: 600;
    }

    .day-note {
      display: flex;
      align-items: center;
      gap: 4px;
      width: 100%;
      padding: 2px 6px;
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 3px;
      background: var(--vscode-list-hoverBackground);
      font-size: 11px;
      box-sizing: border-box;
      overflow: hidden;
      cursor: context-menu;
    }
    .day-note.today {
      border-color: var(--vscode-errorForeground, #f14c4c);
      background: color-mix(in srgb, var(--vscode-errorForeground, #f14c4c) 25%, var(--vscode-sideBar-background));
    }
    .day-note-icon { width: 13px; height: 13px; flex: 0 0 auto; display: inline-flex; }
    .day-note-icon svg { width: 100%; height: 100%; }
    .day-note-icon svg *:not([fill="none"]) { fill: currentColor; }
    .day-note-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* --- Day & Week timeline --- */
    .timelineWrap { display: flex; flex-direction: column; border: 1px solid var(--vscode-editorWidget-border); border-radius: 4px; overflow: hidden; }
    .timelineHeaderRow, .timelineAllDayRow, .timelineHourRow { display: grid; }
    .timelineHeaderRow { border-bottom: 1px solid var(--vscode-editorWidget-border); }
    .timelineAllDayRow { border-bottom: 1px solid var(--vscode-editorWidget-border); min-height: 34px; }
    .timelineGutter { padding: 4px 6px; font-size: 10px; color: var(--vscode-descriptionForeground); text-align: right; }
    .timelineWeekNum { display: flex; align-items: center; justify-content: center; font-weight: 600; }
    .timelineScrollbarSpacer { }
    .timelineDayHeaderCell {
      padding: 6px 4px; display: flex; align-items: center; gap: 6px; justify-content: center;
      border-left: 1px solid var(--vscode-editorWidget-border);
    }
    .timelineDayName { font-size: 11px; color: var(--vscode-descriptionForeground); }
    .timelineAllDayCell {
      border-left: 1px solid var(--vscode-editorWidget-border);
      padding: 3px; cursor: pointer; display: flex; align-items: center;
    }
    .timelineAllDayCell:hover, .timelineAllDayCell:focus { background: var(--vscode-list-hoverBackground); outline: none; }
    .timelineBody { max-height: 420px; overflow-y: auto; }
    .timelineHourRow { border-bottom: 1px dashed var(--vscode-editorWidget-border); min-height: 32px; }
    .timelineHourCell { border-left: 1px solid var(--vscode-editorWidget-border); }

    /* --- Year view --- */
    .yearGrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .miniMonth { border: 1px solid var(--vscode-editorWidget-border); border-radius: 4px; padding: 8px; }
    .miniMonthHeader { font-size: 12px; font-weight: 600; margin-bottom: 4px; text-align: center; }
    .miniGrid { grid-template-columns: repeat(7, 1fr); gap: 2px; }
    .miniDay {
      min-height: 26px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 1px;
      padding: 1px 2px;
      cursor: pointer;
      border-radius: 2px;
      overflow: hidden;
    }
    .miniDay:hover, .miniDay:focus { background: var(--vscode-list-hoverBackground); outline: none; }
    .miniDay.empty { visibility: hidden; cursor: default; }
    .miniDayNum { font-size: 9px; }
    .miniDayNum.today {
      background: var(--vscode-foreground);
      color: var(--vscode-editor-background);
      border-radius: 50%;
      width: 14px; height: 14px;
      display: flex; align-items: center; justify-content: center;
      font-weight: 600;
    }
    .miniDayPill {
      font-size: 8px;
      padding: 0 2px;
      border-radius: 2px;
      background: var(--vscode-list-hoverBackground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
      cursor: context-menu;
    }
    .miniDayPill.today {
      background: color-mix(in srgb, var(--vscode-errorForeground, #f14c4c) 35%, var(--vscode-sideBar-background));
      color: var(--vscode-foreground);
    }

    /* --- List view --- */
    .noteList { display: grid; }
    .listGroup { border-bottom: 1px solid var(--vscode-editorWidget-border); padding: 10px 2px; }
    .listGroup:first-child { padding-top: 0; }
    .listGroupHeader { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
    .listGroupDate { font-weight: 600; font-size: 14px; }
    .listGroupDate.today { color: var(--vscode-errorForeground, #f14c4c); }
    .listGroupWeekday { font-size: 12px; color: var(--vscode-descriptionForeground); }
    .listRow { display: flex; align-items: center; gap: 10px; cursor: pointer; border-radius: 4px; padding: 2px; }
    .listRow:hover, .listRow:focus { background: var(--vscode-list-hoverBackground); outline: none; }
    .listAllDayLabel { font-size: 11px; color: var(--vscode-descriptionForeground); min-width: 60px; flex: 0 0 auto; }
    .listRow .day-note { flex: 1; }
    .listEmpty { color: var(--vscode-descriptionForeground); font-size: 12px; padding: 12px 0; }

    /* --- Context menu --- */
    .ctxMenu {
      position: fixed;
      z-index: 50;
      background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
      color: var(--vscode-menu-foreground, var(--vscode-foreground));
      border: 1px solid var(--vscode-menu-border, var(--vscode-editorWidget-border));
      border-radius: 4px;
      padding: 4px;
      min-width: 170px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .ctxItem {
      background: transparent;
      border: none;
      text-align: left;
      padding: 5px 8px;
      border-radius: 3px;
      cursor: pointer;
      color: inherit;
      font-size: 12px;
      font-family: inherit;
    }
    .ctxItem:hover { background: var(--vscode-list-hoverBackground); }
    .ctxItemDanger { color: var(--vscode-errorForeground, #f14c4c); }
    .ctxSep { height: 1px; background: var(--vscode-editorWidget-border); margin: 4px 2px; }
    .ctxSwatchRow { display: flex; gap: 4px; padding: 4px 6px; flex-wrap: wrap; }
    .ctxSwatch {
      width: 18px; height: 18px; border-radius: 50%;
      border: 1px solid var(--vscode-editorWidget-border);
      cursor: pointer; padding: 0;
    }
    .ctxSwatchClear {
      background: transparent;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px;
      color: var(--vscode-foreground);
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="toolbar">
      <div class="nav">
        <button id="todayBtn">Today</button>
        <button id="prevBtn" aria-label="Previous">&larr;</button>
        <button id="nextBtn" aria-label="Next">&rarr;</button>
        <div class="periodLabel" id="periodLabel"></div>
      </div>
      <div class="nav">
        <div class="tabs" id="tabs">
          <button class="tab" data-view="day">Day</button>
          <button class="tab" data-view="week">Week</button>
          <button class="tab active" data-view="month">Month</button>
          <button class="tab" data-view="year">Year</button>
          <button class="tab" data-view="list">List</button>
        </div>
        <div class="settingsWrap">
          <button id="settingsBtn" class="iconBtn" aria-label="Settings" title="Settings">&#9881;</button>
          <div class="settingsMenu" id="settingsMenu" hidden>
            <label><input type="checkbox" id="hideWeekendsChk"> Hide weekends</label>
            <label><input type="checkbox" id="showWeekNumbersChk"> Show week numbers</label>
          </div>
        </div>
      </div>
    </div>
    <div id="viewContainer"></div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let view = 'month';
    let hideWeekends = false;
    let showWeekNumbers = false;

    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const weekdayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const weekdayFullNames = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

    function pad(n) { return String(n).padStart(2, '0'); }
    function formatDate(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
    function parseDate(s) {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d));
    }
    function addDays(d, n) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n)); }
    function startOfWeek(d) {
      const dow = (d.getUTCDay() + 6) % 7; // Monday-first
      return addDays(d, -dow);
    }
    function formatShort(d) { return monthNames[d.getUTCMonth()].slice(0, 3) + ' ' + d.getUTCDate(); }
    // getTodayStr() is re-evaluated on every render instead of captured once, since
    // the panel can stay alive (retainContextWhenHidden) across midnight - a frozen
    // "today" value would silently go stale while the panel sits in the background.
    function getTodayStr() { return formatDate(new Date()); }
    function isoWeekNumber(d) {
      const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const dayIdx = (date.getUTCDay() + 6) % 7;
      date.setUTCDate(date.getUTCDate() - dayIdx + 3); // Thursday of this week
      const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
      const firstThursdayIdx = (firstThursday.getUTCDay() + 6) % 7;
      firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayIdx + 3);
      return 1 + Math.round((date - firstThursday) / (7 * 86400000));
    }
    function visibleWeekdayIndices() {
      const all = [0, 1, 2, 3, 4, 5, 6];
      return hideWeekends ? all.slice(0, 5) : all;
    }

    let currentDate = parseDate(getTodayStr());

    // Range-loading round trip, correlated by matching start/end (same pattern as the
    // kanban board's icon-picker request/response correlation).
    const pendingRangeRequests = new Map();
    let currentRangeKey = null;
    let currentEntries = [];

    function requestRange(start, end) {
      return new Promise((resolve) => {
        pendingRangeRequests.set(start + '|' + end, resolve);
        vscode.postMessage({ type: 'loadRange', start, end });
      });
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type !== 'rangeLoaded') { return; }
      const key = msg.start + '|' + msg.end;
      const resolver = pendingRangeRequests.get(key);
      if (resolver) {
        pendingRangeRequests.delete(key);
        resolver(msg.entries);
      }
      if (key === currentRangeKey) {
        currentEntries = msg.entries;
        renderCells();
      }
    });

    async function loadEntriesForRange(start, end) {
      currentRangeKey = start + '|' + end;
      currentEntries = await requestRange(start, end);
    }

    function openDate(dateStr) {
      vscode.postMessage({ type: 'openDay', date: dateStr });
    }

    // --- Context menu ---
    let openMenuEl = null;
    function closeContextMenu() {
      if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; }
    }
    function showContextMenu(x, y, items) {
      closeContextMenu();
      const menu = document.createElement('div');
      menu.className = 'ctxMenu';
      menu.style.left = x + 'px';
      menu.style.top = y + 'px';
      for (const item of items) {
        if (item.separator) {
          const sep = document.createElement('div');
          sep.className = 'ctxSep';
          menu.appendChild(sep);
          continue;
        }
        if (item.swatches) {
          const row = document.createElement('div');
          row.className = 'ctxSwatchRow';
          for (const sw of item.swatches) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.title = sw.label;
            if (sw.clear) {
              btn.className = 'ctxSwatchClear';
              btn.textContent = '\\u2715';
            } else {
              btn.className = 'ctxSwatch';
              btn.style.background = sw.color;
            }
            btn.addEventListener('click', () => { closeContextMenu(); sw.action(); });
            row.appendChild(btn);
          }
          menu.appendChild(row);
          continue;
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ctxItem' + (item.danger ? ' ctxItemDanger' : '');
        btn.textContent = item.label;
        btn.addEventListener('click', () => { closeContextMenu(); item.action(); });
        menu.appendChild(btn);
      }
      document.body.appendChild(menu);
      openMenuEl = menu;

      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) { menu.style.left = Math.max(4, window.innerWidth - rect.width - 4) + 'px'; }
      if (rect.bottom > window.innerHeight) { menu.style.top = Math.max(4, window.innerHeight - rect.height - 4) + 'px'; }
    }
    document.addEventListener('click', closeContextMenu);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeContextMenu(); } });

    const COLOR_SWATCHES = [
      { label: 'Red', value: '#e74c3c' },
      { label: 'Orange', value: '#e67e22' },
      { label: 'Yellow', value: '#f1c40f' },
      { label: 'Green', value: '#2ecc71' },
      { label: 'Teal', value: '#1abc9c' },
      { label: 'Blue', value: '#3498db' },
      { label: 'Purple', value: '#9b59b6' },
      { label: 'Pink', value: '#e84393' },
    ];

    function showNoteContextMenu(x, y, entry) {
      showContextMenu(x, y, [
        { label: 'Open Note', action: () => openDate(entry.date) },
        { separator: true },
        { label: 'Archive Note', action: () => vscode.postMessage({ type: 'archiveDayNote', noteId: entry.noteId }) },
        { label: 'Delete Note\\u2026', danger: true, action: () => vscode.postMessage({ type: 'deleteDayNote', noteId: entry.noteId }) },
        { separator: true },
        {
          swatches: [
            ...COLOR_SWATCHES.map((sw) => ({
              label: sw.label,
              color: sw.value,
              action: () => vscode.postMessage({ type: 'setDayNoteColor', noteId: entry.noteId, color: sw.value }),
            })),
            { label: 'Clear color', clear: true, action: () => vscode.postMessage({ type: 'setDayNoteColor', noteId: entry.noteId }) },
          ],
        },
      ]);
    }

    function dayNoteEl(entry, isToday) {
      const el = document.createElement('div');
      el.className = 'day-note' + (isToday ? ' today' : '');
      if (entry.color && !isToday) {
        el.style.borderColor = entry.color;
        el.style.background = 'color-mix(in srgb, ' + entry.color + ' 22%, var(--vscode-sideBar-background))';
      }
      if (entry.iconSvg) {
        const icon = document.createElement('span');
        icon.className = 'day-note-icon';
        icon.innerHTML = entry.iconSvg;
        el.appendChild(icon);
      }
      const titleEl = document.createElement('span');
      titleEl.className = 'day-note-title';
      titleEl.textContent = entry.title;
      el.appendChild(titleEl);
      el.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showNoteContextMenu(event.clientX, event.clientY, entry);
      });
      return el;
    }

    function dayCellEl(dateStr, dayLabel, entriesMap, today) {
      const cell = document.createElement('div');
      cell.className = 'day';
      cell.tabIndex = 0;
      cell.dataset.date = dateStr;
      const isToday = dateStr === today;

      const numEl = document.createElement('div');
      numEl.className = 'day-number' + (isToday ? ' today' : '');
      numEl.textContent = dayLabel;
      cell.appendChild(numEl);

      const entry = entriesMap.get(dateStr);
      if (entry) {
        cell.appendChild(dayNoteEl(entry, isToday));
      }

      const open = () => openDate(dateStr);
      cell.addEventListener('click', open);
      cell.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      });
      return cell;
    }

    // --- Month view ---
    function monthRange(date) {
      const y = date.getUTCFullYear(), m = date.getUTCMonth();
      return {
        start: formatDate(new Date(Date.UTC(y, m, 1))),
        end: formatDate(new Date(Date.UTC(y, m + 1, 0))),
      };
    }
    function renderMonthView(container) {
      container.innerHTML = '';
      const cols = visibleWeekdayIndices();
      const gridCols = (showWeekNumbers ? '32px ' : '') + 'repeat(' + cols.length + ', 1fr)';
      const today = getTodayStr();
      const entriesMap = new Map(currentEntries.map((e) => [e.date, e]));

      const headerRow = document.createElement('div');
      headerRow.className = 'grid';
      headerRow.style.gridTemplateColumns = gridCols;
      if (showWeekNumbers) {
        const corner = document.createElement('div');
        corner.className = 'weekNumHeader';
        headerRow.appendChild(corner);
      }
      for (const idx of cols) {
        const el = document.createElement('div');
        el.className = 'weekday';
        el.textContent = weekdayNames[idx];
        headerRow.appendChild(el);
      }
      container.appendChild(headerRow);

      const y = currentDate.getUTCFullYear(), m = currentDate.getUTCMonth();
      const firstOfMonth = new Date(Date.UTC(y, m, 1));
      const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const leadingBlanks = (firstOfMonth.getUTCDay() + 6) % 7;
      const totalWeeks = Math.ceil((daysInMonth + leadingBlanks) / 7);
      let cursor = addDays(firstOfMonth, -leadingBlanks);

      for (let w = 0; w < totalWeeks; w += 1) {
        const row = document.createElement('div');
        row.className = 'grid';
        row.style.gridTemplateColumns = gridCols;
        if (showWeekNumbers) {
          const wn = document.createElement('div');
          wn.className = 'weekNumCell';
          wn.textContent = String(isoWeekNumber(cursor));
          row.appendChild(wn);
        }
        for (const idx of cols) {
          const d = addDays(cursor, idx);
          if (d.getUTCMonth() !== m) {
            const el = document.createElement('div');
            el.className = 'day empty';
            row.appendChild(el);
            continue;
          }
          row.appendChild(dayCellEl(formatDate(d), String(d.getUTCDate()), entriesMap, today));
        }
        container.appendChild(row);
        cursor = addDays(cursor, 7);
      }
    }

    // --- Day & Week timeline ---
    const HOURS = Array.from({ length: 24 }, (_, i) => i);
    // The header and all-day rows sit outside .timelineBody's scroll container, so
    // without this they stay full-width while the hour grid below loses the
    // scrollbar's width - columns drift out of alignment towards the right edge.
    function measureScrollbarWidth() {
      const outer = document.createElement('div');
      outer.style.cssText = 'position:absolute; top:-9999px; width:100px; height:100px; overflow:scroll;';
      const inner = document.createElement('div');
      inner.style.cssText = 'width:100%; height:100%;';
      outer.appendChild(inner);
      document.body.appendChild(outer);
      const width = outer.offsetWidth - inner.offsetWidth;
      outer.remove();
      return width;
    }
    const SCROLLBAR_WIDTH = measureScrollbarWidth();
    function dayRange(date) {
      const s = formatDate(date);
      return { start: s, end: s };
    }
    function weekRange(date) {
      const start = startOfWeek(date);
      return { start: formatDate(start), end: formatDate(addDays(start, 6)) };
    }
    function renderTimeline(container, dates) {
      container.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'timelineWrap';
      const cols = 'minmax(50px, auto) repeat(' + dates.length + ', 1fr)';
      // Header/all-day rows aren't inside the scrolling body, so they get an extra
      // trailing column the width of the scrollbar to keep their cells aligned with
      // the hour grid's columns below (see measureScrollbarWidth above).
      const colsWithScrollbarSpacer = cols + ' ' + SCROLLBAR_WIDTH + 'px';
      const entriesMap = new Map(currentEntries.map((e) => [e.date, e]));
      const today = getTodayStr();

      const headerRow = document.createElement('div');
      headerRow.className = 'timelineHeaderRow';
      headerRow.style.gridTemplateColumns = colsWithScrollbarSpacer;
      const headerGutter = document.createElement('div');
      headerGutter.className = 'timelineGutter timelineWeekNum';
      headerGutter.textContent = 'W' + isoWeekNumber(dates[0]);
      headerRow.appendChild(headerGutter);
      for (const d of dates) {
        const cell = document.createElement('div');
        cell.className = 'timelineDayHeaderCell';
        const num = document.createElement('div');
        num.className = 'day-number' + (formatDate(d) === today ? ' today' : '');
        num.textContent = String(d.getUTCDate());
        cell.appendChild(num);
        const name = document.createElement('div');
        name.className = 'timelineDayName';
        name.textContent = weekdayNames[(d.getUTCDay() + 6) % 7];
        cell.appendChild(name);
        headerRow.appendChild(cell);
      }
      headerRow.appendChild(document.createElement('div')).className = 'timelineScrollbarSpacer';
      wrap.appendChild(headerRow);

      const allDayRow = document.createElement('div');
      allDayRow.className = 'timelineAllDayRow';
      allDayRow.style.gridTemplateColumns = colsWithScrollbarSpacer;
      const gutterLabel = document.createElement('div');
      gutterLabel.className = 'timelineGutter';
      gutterLabel.textContent = 'All day';
      allDayRow.appendChild(gutterLabel);
      for (const d of dates) {
        const dateStr = formatDate(d);
        const cell = document.createElement('div');
        cell.className = 'timelineAllDayCell';
        cell.tabIndex = 0;
        const entry = entriesMap.get(dateStr);
        if (entry) {
          cell.appendChild(dayNoteEl(entry, dateStr === today));
        }
        const open = () => openDate(dateStr);
        cell.addEventListener('click', open);
        cell.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
        });
        allDayRow.appendChild(cell);
      }
      allDayRow.appendChild(document.createElement('div')).className = 'timelineScrollbarSpacer';
      wrap.appendChild(allDayRow);

      const body = document.createElement('div');
      body.className = 'timelineBody';
      for (const h of HOURS) {
        const hourRow = document.createElement('div');
        hourRow.className = 'timelineHourRow';
        hourRow.style.gridTemplateColumns = cols;
        const label = document.createElement('div');
        label.className = 'timelineGutter';
        label.textContent = pad(h) + ' Uhr';
        hourRow.appendChild(label);
        for (let i = 0; i < dates.length; i += 1) {
          const cell = document.createElement('div');
          cell.className = 'timelineHourCell';
          hourRow.appendChild(cell);
        }
        body.appendChild(hourRow);
      }
      wrap.appendChild(body);
      container.appendChild(wrap);
      body.scrollTop = 6 * 32; // scroll roughly to the start of a typical day
    }
    function renderDayView(container) {
      renderTimeline(container, [currentDate]);
    }
    function renderWeekView(container) {
      const start = startOfWeek(currentDate);
      const dates = visibleWeekdayIndices().map((idx) => addDays(start, idx));
      renderTimeline(container, dates);
    }

    // --- Year view ---
    function yearRange(date) {
      const y = date.getUTCFullYear();
      return { start: y + '-01-01', end: y + '-12-31' };
    }
    function renderYearView(container) {
      container.innerHTML = '';
      const y = currentDate.getUTCFullYear();
      const entriesMap = new Map(currentEntries.map((e) => [e.date, e]));
      const today = getTodayStr();
      const yearGrid = document.createElement('div');
      yearGrid.className = 'yearGrid';

      for (let m = 0; m < 12; m += 1) {
        const monthBox = document.createElement('div');
        monthBox.className = 'miniMonth';
        const header = document.createElement('div');
        header.className = 'miniMonthHeader';
        header.textContent = monthNames[m];
        monthBox.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'grid miniGrid';
        const firstOfMonth = new Date(Date.UTC(y, m, 1));
        const leadingBlanks = (firstOfMonth.getUTCDay() + 6) % 7;
        const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

        for (let i = 0; i < leadingBlanks; i += 1) {
          const el = document.createElement('div');
          el.className = 'miniDay empty';
          grid.appendChild(el);
        }
        for (let day = 1; day <= daysInMonth; day += 1) {
          const dateStr = y + '-' + pad(m + 1) + '-' + pad(day);
          const isToday = dateStr === today;
          const entry = entriesMap.get(dateStr);
          const cell = document.createElement('div');
          cell.className = 'miniDay';
          cell.tabIndex = 0;

          const numEl = document.createElement('div');
          numEl.className = 'miniDayNum' + (isToday ? ' today' : '');
          numEl.textContent = String(day);
          cell.appendChild(numEl);

          if (entry) {
            const pill = document.createElement('div');
            pill.className = 'miniDayPill' + (isToday ? ' today' : '');
            pill.textContent = pad(day) + ' - ' + entry.title;
            pill.addEventListener('contextmenu', (event) => {
              event.preventDefault();
              event.stopPropagation();
              showNoteContextMenu(event.clientX, event.clientY, entry);
            });
            cell.appendChild(pill);
          }

          const open = () => openDate(dateStr);
          cell.addEventListener('click', open);
          cell.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
          });
          grid.appendChild(cell);
        }
        monthBox.appendChild(grid);
        yearGrid.appendChild(monthBox);
      }
      container.appendChild(yearGrid);
    }

    // --- List view: a rolling 3-month window starting at the current month ---
    function listRange(date) {
      const y = date.getUTCFullYear(), m = date.getUTCMonth();
      return {
        start: formatDate(new Date(Date.UTC(y, m, 1))),
        end: formatDate(new Date(Date.UTC(y, m + 1, 0))),
      };
    }
    function renderListView(container) {
      container.innerHTML = '';
      const list = document.createElement('div');
      list.className = 'noteList';
      const sorted = currentEntries.slice().sort((a, b) => a.date.localeCompare(b.date));
      const today = getTodayStr();

      if (sorted.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'listEmpty';
        empty.textContent = 'No notes in this range.';
        list.appendChild(empty);
      }

      for (const entry of sorted) {
        const d = parseDate(entry.date);
        const isToday = entry.date === today;

        const group = document.createElement('div');
        group.className = 'listGroup';

        const header = document.createElement('div');
        header.className = 'listGroupHeader';
        const dateLine = document.createElement('div');
        dateLine.className = 'listGroupDate' + (isToday ? ' today' : '');
        dateLine.textContent = d.getUTCDate() + '. ' + monthNames[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
        header.appendChild(dateLine);
        const weekdayLine = document.createElement('div');
        weekdayLine.className = 'listGroupWeekday';
        weekdayLine.textContent = weekdayFullNames[(d.getUTCDay() + 6) % 7];
        header.appendChild(weekdayLine);
        group.appendChild(header);

        const row = document.createElement('div');
        row.className = 'listRow';
        row.tabIndex = 0;
        const label = document.createElement('span');
        label.className = 'listAllDayLabel';
        label.textContent = 'All day';
        row.appendChild(label);
        row.appendChild(dayNoteEl(entry, isToday));
        const open = () => openDate(entry.date);
        row.addEventListener('click', open);
        row.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
        });
        group.appendChild(row);

        list.appendChild(group);
      }
      container.appendChild(list);
    }

    const VIEWS = {
      day: {
        range: dayRange,
        render: renderDayView,
        label: (d) => monthNames[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear(),
        step: (d, dir) => addDays(d, dir),
      },
      week: {
        range: weekRange,
        render: renderWeekView,
        label: (d) => {
          const s = startOfWeek(d);
          const base = formatShort(s) + ' - ' + formatShort(addDays(s, 6));
          return showWeekNumbers ? base + ' (W' + isoWeekNumber(s) + ')' : base;
        },
        step: (d, dir) => addDays(d, dir * 7),
      },
      month: {
        range: monthRange,
        render: renderMonthView,
        label: (d) => monthNames[d.getUTCMonth()] + ' ' + d.getUTCFullYear(),
        step: (d, dir) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1)),
      },
      year: {
        range: yearRange,
        render: renderYearView,
        label: (d) => String(d.getUTCFullYear()),
        step: (d, dir) => new Date(Date.UTC(d.getUTCFullYear() + dir, d.getUTCMonth(), 1)),
      },
      list: {
        range: listRange,
        render: renderListView,
        label: (d) => monthNames[d.getUTCMonth()] + ' ' + d.getUTCFullYear(),
        step: (d, dir) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1)),
      },
    };

    const viewContainer = document.getElementById('viewContainer');
    const periodLabel = document.getElementById('periodLabel');

    function renderCells() {
      VIEWS[view].render(viewContainer);
    }

    async function renderView() {
      periodLabel.textContent = VIEWS[view].label(currentDate);
      const { start, end } = VIEWS[view].range(currentDate);
      await loadEntriesForRange(start, end);
      renderCells();
    }

    document.getElementById('tabs').addEventListener('click', (event) => {
      const btn = event.target.closest('.tab');
      if (!btn) { return; }
      view = btn.dataset.view;
      for (const tab of document.querySelectorAll('.tab')) {
        tab.classList.toggle('active', tab === btn);
      }
      renderView();
    });

    document.getElementById('todayBtn').addEventListener('click', () => {
      currentDate = parseDate(getTodayStr());
      renderView();
    });
    document.getElementById('prevBtn').addEventListener('click', () => {
      currentDate = VIEWS[view].step(currentDate, -1);
      renderView();
    });
    document.getElementById('nextBtn').addEventListener('click', () => {
      currentDate = VIEWS[view].step(currentDate, 1);
      renderView();
    });

    const settingsBtn = document.getElementById('settingsBtn');
    const settingsMenu = document.getElementById('settingsMenu');
    settingsBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      settingsMenu.hidden = !settingsMenu.hidden;
    });
    settingsMenu.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('click', () => { settingsMenu.hidden = true; });
    document.getElementById('hideWeekendsChk').addEventListener('change', (event) => {
      hideWeekends = event.target.checked;
      renderCells();
    });
    document.getElementById('showWeekNumbersChk').addEventListener('change', (event) => {
      showWeekNumbers = event.target.checked;
      periodLabel.textContent = VIEWS[view].label(currentDate);
      renderCells();
    });

    // The panel can sit hidden in the background for a long time (retainContextWhenHidden) -
    // refresh the "today" highlighting (cheaply, without re-fetching) whenever it's shown again.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { renderCells(); }
    });

    renderView();
  </script>
</body>
</html>`;
}

/**
 * Reads a book note's `#viewType` label (Trilium's own name for it), case-insensitively.
 * Duplicated in bookViewPanel.ts (getBookViewType) rather than shared across these two
 * independent PRs; see that copy's doc comment for why an unset label defaults to "grid".
 */
export function getBookViewTypeLabel(note: Note): string {
  const attr = (note.attributes ?? []).find(
    (a) => a.type === 'label' && a.name.trim().toLowerCase() === 'viewtype',
  );
  return attr?.value.trim().toLowerCase() || 'grid';
}

/**
 * Calendar view for book notes with `#viewType=calendar`. Trilium ties the calendar to a
 * `#calendarRoot` ancestor, but day/week/month/year lookup is plain date-based ETAPI
 * (already used by `trilium.openCalendarNote`), so this doesn't need to resolve that
 * relationship - it shows Day/Week/Month/Year/List views and opens (or creates, same as
 * Trilium's own calendar) the day note for whichever date is clicked. Existing day notes
 * are found via a `#dateNote` range search (searchDayNotesInRange) rather than
 * `getDayNote()`, which would otherwise create one for every date merely displayed.
 */
export async function openCalendarViewPanel(
  client: EtapiClient,
  note: Note,
  context: vscode.ExtensionContext,
): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    'triliumCalendarView',
    note.title,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  panel.webview.html = buildHtml(panel.webview, note.title);

  let lastRange: { start: string; end: string } | undefined;
  let lastEntriesSignature = '';

  const pushEntries = (entries: DayNoteEntry[]) => {
    if (!lastRange) {
      return;
    }
    lastEntriesSignature = JSON.stringify(entries);
    void panel.webview.postMessage({
      type: 'rangeLoaded',
      start: lastRange.start,
      end: lastRange.end,
      entries,
    });
  };

  const refreshLastRange = async () => {
    if (!lastRange) {
      return;
    }
    const entries = await searchDayNotesInRange(client, lastRange.start, lastRange.end, context);
    pushEntries(entries);
  };

  const disposable = panel.webview.onDidReceiveMessage(async (msg: CalendarMessage) => {
    if (msg.type === 'loadRange') {
      lastRange = { start: msg.start, end: msg.end };
      try {
        const entries = await searchDayNotesInRange(client, msg.start, msg.end, context);
        pushEntries(entries);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to load calendar notes: ${err}`);
      }
      return;
    }

    if (msg.type === 'openDay') {
      try {
        const dayNote = await client.getDayNote(msg.date);
        await vscode.commands.executeCommand('trilium.openNote', new NoteItem(dayNote));
        // A newly-created day note wasn't in the last search result - refresh the
        // currently-displayed range so its pill appears once the user returns.
        await refreshLastRange();
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open day note for ${msg.date}: ${err}`);
      }
      return;
    }

    if (msg.type === 'archiveDayNote') {
      try {
        const current = await client.getNote(msg.noteId);
        const hasArchived = (current.attributes ?? []).some(
          (a) => a.type === 'label' && a.name === 'archived',
        );
        if (!hasArchived) {
          await client.createAttribute(msg.noteId, 'label', 'archived', '', false);
        }
        await refreshLastRange();
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to archive note: ${err}`);
      }
      return;
    }

    if (msg.type === 'deleteDayNote') {
      const confirmed = await vscode.window.showWarningMessage(
        'Trilium: Delete this note? This cannot be undone.',
        { modal: true },
        'Delete',
      );
      if (confirmed !== 'Delete') {
        return;
      }
      try {
        await client.deleteNote(msg.noteId);
        await refreshLastRange();
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to delete note: ${err}`);
      }
      return;
    }

    if (msg.type === 'setDayNoteColor') {
      try {
        const current = await client.getNote(msg.noteId);
        const colorAttr = (current.attributes ?? []).find(
          (a) => a.type === 'label' && a.name === 'color',
        );
        if (msg.color) {
          if (colorAttr) {
            await client.patchAttribute(colorAttr.attributeId, { value: msg.color });
          } else {
            await client.createAttribute(msg.noteId, 'label', 'color', msg.color, false);
          }
        } else if (colorAttr) {
          await client.deleteAttribute(colorAttr.attributeId);
        }
        await refreshLastRange();
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to set note color: ${err}`);
      }
    }
  });

  // Polls for changes made elsewhere (Trilium's own UI, another device) while the panel
  // is open, same as the kanban board. Only runs while visible, and only pushes an
  // update when the entries actually changed, so an idle tab doesn't keep re-rendering.
  const refreshTimer = setInterval(async () => {
    if (!panel.visible || !lastRange) {
      return;
    }
    try {
      const entries = await searchDayNotesInRange(client, lastRange.start, lastRange.end, context);
      if (JSON.stringify(entries) !== lastEntriesSignature) {
        pushEntries(entries);
      }
    } catch {
      // Transient fetch failures (e.g. momentarily disconnected) just skip this tick.
    }
  }, REFRESH_INTERVAL_MS);

  panel.onDidDispose(() => {
    clearInterval(refreshTimer);
    disposable.dispose();
  });
}
