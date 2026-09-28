import * as vscode from 'vscode';
import { EtapiClient, Note } from './etapiClient';
import { NoteItem } from './noteTreeProvider';

interface CalendarMessage {
  type: 'openDay';
  date: string; // YYYY-MM-DD
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

function buildHtml(webview: vscode.Webview, title: string, year: number, month: number): string {
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
    .header { font-size: 13px; color: var(--vscode-descriptionForeground); }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .monthLabel { font-weight: 600; }
    button {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-radius: 4px;
      padding: 4px 10px;
      cursor: pointer;
    }
    .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
    .weekday { text-align: center; font-size: 11px; color: var(--vscode-descriptionForeground); padding: 2px 0; }
    .day {
      aspect-ratio: 1 / 1;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 4px;
      cursor: pointer;
      background: var(--vscode-sideBar-background);
    }
    .day:hover, .day:focus { background: var(--vscode-list-hoverBackground); outline: none; }
    .day.today { border-color: var(--vscode-focusBorder); font-weight: 600; }
    .day.empty { visibility: hidden; cursor: default; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">Calendar</div>
    <div class="toolbar">
      <button id="prevBtn">&larr; Prev</button>
      <div class="monthLabel" id="monthLabel"></div>
      <button id="nextBtn">Next &rarr;</button>
    </div>
    <div class="grid" id="weekdays"></div>
    <div class="grid" id="days"></div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let year = ${year};
    let month = ${month}; // 1-12

    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const weekdayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

    const todayStr = new Date().toISOString().slice(0, 10);

    function pad(n) { return String(n).padStart(2, '0'); }

    function render() {
      document.getElementById('monthLabel').textContent = monthNames[month - 1] + ' ' + year;

      const weekdaysEl = document.getElementById('weekdays');
      weekdaysEl.innerHTML = '';
      weekdayNames.forEach((w) => {
        const el = document.createElement('div');
        el.className = 'weekday';
        el.textContent = w;
        weekdaysEl.appendChild(el);
      });

      const daysEl = document.getElementById('days');
      daysEl.innerHTML = '';

      const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
      // getUTCDay(): 0=Sun..6=Sat, shift to Monday-first (0=Mon..6=Sun).
      const leadingBlanks = (firstOfMonth.getUTCDay() + 6) % 7;
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

      for (let i = 0; i < leadingBlanks; i += 1) {
        const el = document.createElement('div');
        el.className = 'day empty';
        daysEl.appendChild(el);
      }

      for (let day = 1; day <= daysInMonth; day += 1) {
        const dateStr = year + '-' + pad(month) + '-' + pad(day);
        const el = document.createElement('div');
        el.className = 'day' + (dateStr === todayStr ? ' today' : '');
        el.textContent = String(day);
        el.tabIndex = 0;
        el.dataset.date = dateStr;
        const open = () => vscode.postMessage({ type: 'openDay', date: dateStr });
        el.addEventListener('click', open);
        el.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        });
        daysEl.appendChild(el);
      }
    }

    document.getElementById('prevBtn').addEventListener('click', () => {
      month -= 1;
      if (month < 1) { month = 12; year -= 1; }
      render();
    });
    document.getElementById('nextBtn').addEventListener('click', () => {
      month += 1;
      if (month > 12) { month = 1; year += 1; }
      render();
    });

    render();
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
 * Lightweight calendar view for book notes with `#viewType=calendar`. Trilium ties
 * the calendar to a `#calendarRoot` ancestor, but the day/week/month/year lookup is
 * plain date-based ETAPI (already used by the `trilium.openCalendarNote` command),
 * so this doesn't need to resolve that relationship - it just shows a month grid and
 * opens (or creates, same as Trilium's own calendar) the day note for whichever date
 * is clicked.
 */
export async function openCalendarViewPanel(client: EtapiClient, note: Note): Promise<void> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const panel = vscode.window.createWebviewPanel(
    'triliumCalendarView',
    note.title,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  panel.webview.html = buildHtml(panel.webview, note.title, year, month);

  const disposable = panel.webview.onDidReceiveMessage(async (msg: CalendarMessage) => {
    if (msg.type !== 'openDay') {
      return;
    }
    try {
      const dayNote = await client.getDayNote(msg.date);
      await vscode.commands.executeCommand('trilium.openNote', new NoteItem(dayNote));
    } catch (err) {
      void vscode.window.showErrorMessage(`Trilium: Failed to open day note for ${msg.date}: ${err}`);
    }
  });

  panel.onDidDispose(() => disposable.dispose());
}
