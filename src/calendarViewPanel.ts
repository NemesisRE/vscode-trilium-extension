import * as vscode from 'vscode';
import { EtapiClient, Note } from './etapiClient';
import { effectiveIconClassForNote, NoteItem } from './noteTreeProvider';
import { getIconSvg } from './iconPickerPanel';

type CalendarMessage = OpenDayMessage | LoadRangeMessage;

interface OpenDayMessage {
  type: 'openDay';
  date: string; // YYYY-MM-DD
}

interface LoadRangeMessage {
  type: 'loadRange';
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

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

function buildHtml(webview: vscode.Webview, title: string, todayDateStr: string): string {
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
    .tabs { display: flex; gap: 2px; border: 1px solid var(--vscode-editorWidget-border); border-radius: 4px; overflow: hidden; }
    .tab { border: none; border-radius: 0; background: transparent; padding: 4px 12px; }
    .tab.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }

    .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
    .weekday { text-align: center; font-size: 11px; color: var(--vscode-descriptionForeground); padding: 2px 0; }

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
    .singleDayWrap { display: flex; }
    .day.singleDay { width: 100%; min-height: 240px; }

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
      background: var(--vscode-focusBorder);
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
    }
    .day-note-icon { width: 13px; height: 13px; flex: 0 0 auto; display: inline-flex; }
    .day-note-icon svg { width: 100%; height: 100%; }
    .day-note-icon svg *:not([fill="none"]) { fill: currentColor; }
    .day-note-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .yearGrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .miniMonth { border: 1px solid var(--vscode-editorWidget-border); border-radius: 4px; padding: 8px; }
    .miniMonthHeader { font-size: 12px; font-weight: 600; margin-bottom: 4px; text-align: center; }
    .miniGrid { grid-template-columns: repeat(7, 1fr); gap: 2px; }
    .miniDay {
      aspect-ratio: 1 / 1;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      border-radius: 50%;
      cursor: pointer;
    }
    .miniDay:hover { background: var(--vscode-list-hoverBackground); }
    .miniDay.empty { visibility: hidden; cursor: default; }
    .miniDay.today { background: var(--vscode-focusBorder); color: var(--vscode-editor-background); font-weight: 600; }
    .miniDay.hasNote:not(.today) { box-shadow: inset 0 -3px 0 var(--vscode-focusBorder); }

    .noteList { display: grid; gap: 4px; }
    .listRow {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 4px;
      cursor: pointer;
    }
    .listRow:hover, .listRow:focus { background: var(--vscode-list-hoverBackground); outline: none; }
    .listRow.today { border-color: var(--vscode-focusBorder); }
    .listDate { font-size: 11px; color: var(--vscode-descriptionForeground); min-width: 84px; }
    .listTitle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .listEmpty { color: var(--vscode-descriptionForeground); font-size: 12px; padding: 12px 0; }
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
      <div class="tabs" id="tabs">
        <button class="tab" data-view="day">Day</button>
        <button class="tab" data-view="week">Week</button>
        <button class="tab active" data-view="month">Month</button>
        <button class="tab" data-view="year">Year</button>
        <button class="tab" data-view="list">List</button>
      </div>
    </div>
    <div id="viewContainer"></div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const todayStr = ${JSON.stringify(todayDateStr)};
    let view = 'month';

    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const weekdayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

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

    let currentDate = parseDate(todayStr);

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

    function dayNoteEl(entry) {
      const el = document.createElement('div');
      el.className = 'day-note';
      if (entry.color) {
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
      return el;
    }

    function dayCellEl(dateStr, dayLabel, entriesMap, extraClass) {
      const cell = document.createElement('div');
      cell.className = 'day' + (extraClass ? ' ' + extraClass : '');
      cell.tabIndex = 0;
      cell.dataset.date = dateStr;

      const numEl = document.createElement('div');
      numEl.className = 'day-number' + (dateStr === todayStr ? ' today' : '');
      numEl.textContent = dayLabel;
      cell.appendChild(numEl);

      const entry = entriesMap.get(dateStr);
      if (entry) {
        cell.appendChild(dayNoteEl(entry));
      }

      const open = () => openDate(dateStr);
      cell.addEventListener('click', open);
      cell.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      });
      return cell;
    }

    function weekdaysRowEl() {
      const row = document.createElement('div');
      row.className = 'grid';
      weekdayNames.forEach((w) => {
        const el = document.createElement('div');
        el.className = 'weekday';
        el.textContent = w;
        row.appendChild(el);
      });
      return row;
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
      container.appendChild(weekdaysRowEl());

      const daysEl = document.createElement('div');
      daysEl.className = 'grid';
      const y = currentDate.getUTCFullYear(), m = currentDate.getUTCMonth();
      const firstOfMonth = new Date(Date.UTC(y, m, 1));
      const leadingBlanks = (firstOfMonth.getUTCDay() + 6) % 7;
      const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const entriesMap = new Map(currentEntries.map((e) => [e.date, e]));

      for (let i = 0; i < leadingBlanks; i += 1) {
        const el = document.createElement('div');
        el.className = 'day empty';
        daysEl.appendChild(el);
      }
      for (let day = 1; day <= daysInMonth; day += 1) {
        const dateStr = y + '-' + pad(m + 1) + '-' + pad(day);
        daysEl.appendChild(dayCellEl(dateStr, String(day), entriesMap));
      }
      container.appendChild(daysEl);
    }

    // --- Week view ---
    function weekRange(date) {
      const start = startOfWeek(date);
      return { start: formatDate(start), end: formatDate(addDays(start, 6)) };
    }
    function renderWeekView(container) {
      container.innerHTML = '';
      container.appendChild(weekdaysRowEl());

      const daysEl = document.createElement('div');
      daysEl.className = 'grid';
      const start = startOfWeek(currentDate);
      const entriesMap = new Map(currentEntries.map((e) => [e.date, e]));
      for (let i = 0; i < 7; i += 1) {
        const d = addDays(start, i);
        daysEl.appendChild(dayCellEl(formatDate(d), String(d.getUTCDate()), entriesMap));
      }
      container.appendChild(daysEl);
    }

    // --- Day view ---
    function dayRange(date) {
      const s = formatDate(date);
      return { start: s, end: s };
    }
    function renderDayView(container) {
      container.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'singleDayWrap';
      const entriesMap = new Map(currentEntries.map((e) => [e.date, e]));
      const dateStr = formatDate(currentDate);
      wrap.appendChild(dayCellEl(dateStr, String(currentDate.getUTCDate()), entriesMap, 'singleDay'));
      container.appendChild(wrap);
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
          const el = document.createElement('div');
          el.className = 'miniDay'
            + (dateStr === todayStr ? ' today' : '')
            + (entriesMap.has(dateStr) ? ' hasNote' : '');
          el.textContent = String(day);
          el.tabIndex = 0;
          const open = () => openDate(dateStr);
          el.addEventListener('click', open);
          el.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
          });
          grid.appendChild(el);
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
        end: formatDate(new Date(Date.UTC(y, m + 3, 0))),
      };
    }
    function renderListView(container) {
      container.innerHTML = '';
      const list = document.createElement('div');
      list.className = 'noteList';
      const sorted = currentEntries.slice().sort((a, b) => a.date.localeCompare(b.date));

      if (sorted.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'listEmpty';
        empty.textContent = 'No notes in this range.';
        list.appendChild(empty);
      }

      for (const entry of sorted) {
        const row = document.createElement('div');
        row.className = 'listRow' + (entry.date === todayStr ? ' today' : '');
        row.tabIndex = 0;

        const dateEl = document.createElement('span');
        dateEl.className = 'listDate';
        dateEl.textContent = entry.date;
        row.appendChild(dateEl);

        if (entry.iconSvg) {
          const icon = document.createElement('span');
          icon.className = 'day-note-icon';
          icon.innerHTML = entry.iconSvg;
          row.appendChild(icon);
        }

        const titleEl = document.createElement('span');
        titleEl.className = 'listTitle';
        titleEl.textContent = entry.title;
        row.appendChild(titleEl);

        const open = () => openDate(entry.date);
        row.addEventListener('click', open);
        row.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
        });
        list.appendChild(row);
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
        label: (d) => { const s = startOfWeek(d); return formatShort(s) + ' - ' + formatShort(addDays(s, 6)); },
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
        label: (d) => monthNames[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ' +2',
        step: (d, dir) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir * 3, 1)),
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
      currentDate = parseDate(todayStr);
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
  const todayDateStr = new Date().toISOString().slice(0, 10);

  const panel = vscode.window.createWebviewPanel(
    'triliumCalendarView',
    note.title,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  panel.webview.html = buildHtml(panel.webview, note.title, todayDateStr);

  let lastRange: { start: string; end: string } | undefined;

  const disposable = panel.webview.onDidReceiveMessage(async (msg: CalendarMessage) => {
    if (msg.type === 'loadRange') {
      lastRange = { start: msg.start, end: msg.end };
      try {
        const entries = await searchDayNotesInRange(client, msg.start, msg.end, context);
        void panel.webview.postMessage({ type: 'rangeLoaded', start: msg.start, end: msg.end, entries });
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
        if (lastRange) {
          const entries = await searchDayNotesInRange(client, lastRange.start, lastRange.end, context);
          void panel.webview.postMessage({
            type: 'rangeLoaded',
            start: lastRange.start,
            end: lastRange.end,
            entries,
          });
        }
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open day note for ${msg.date}: ${err}`);
      }
    }
  });

  panel.onDidDispose(() => disposable.dispose());
}
