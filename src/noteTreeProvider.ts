import * as vscode from 'vscode';
import { EtapiClient, Note } from './etapiClient';
import { getRootNoteId } from './settings';

// ---------------------------------------------------------------------------
// Icon helpers: BoxIcons (used by Trilium's #iconClass label) → Codicons
// ---------------------------------------------------------------------------

const BOXICON_TO_CODICON: Record<string, string> = {
  // Content
  note: 'note', notepad: 'note', book: 'book', 'book-open': 'book',
  bookmark: 'bookmark', bookmarks: 'bookmark',
  // Files & Folders
  file: 'file', 'file-blank': 'file', folder: 'folder', 'folder-open': 'folder-opened',
  // Navigation
  home: 'home', globe: 'globe', world: 'globe', location: 'location', map: 'map',
  'map-pin': 'location', link: 'link', 'link-external': 'link-external',
  // Edit actions
  edit: 'edit', pencil: 'pencil', pen: 'pencil', copy: 'copy',
  trash: 'trash', 'trash-alt': 'trash', plus: 'add', minus: 'remove',
  check: 'check', 'check-square': 'pass', x: 'close', close: 'close',
  refresh: 'refresh', sync: 'sync', search: 'search', filter: 'filter',
  save: 'save', download: 'cloud-download', upload: 'cloud-upload',
  send: 'send', 'paper-plane': 'send', share: 'share', 'share-alt': 'share',
  export: 'export', printer: 'printer', undo: 'discard', redo: 'redo',
  // Media
  image: 'file-media', images: 'file-media', video: 'device-camera-video',
  camera: 'device-camera', play: 'play', 'play-circle': 'play-circle',
  // Communication
  chat: 'comment-discussion', comment: 'comment', envelope: 'mail', mail: 'mail',
  bell: 'bell', rss: 'rss', reply: 'reply',
  // People
  user: 'person', 'user-circle': 'account', group: 'account', people: 'account',
  // Tech
  code: 'code', 'code-block': 'code', terminal: 'terminal',
  'git-branch': 'git-branch', 'git-merge': 'git-merge', 'git-commit': 'git-commit',
  data: 'database', server: 'server', cloud: 'cloud', extension: 'extensions',
  bug: 'bug', pulse: 'pulse',
  // Status & Info
  info: 'info', 'info-circle': 'info', error: 'error', 'error-circle': 'error',
  warning: 'warning', help: 'question', 'help-circle': 'question', 'question-mark': 'question',
  // Time
  calendar: 'calendar', clock: 'clock', timer: 'watch', time: 'clock', history: 'history',
  // Markers
  star: 'star', flag: 'flag', tag: 'tag', pin: 'pinned', unpin: 'pin',
  // Security
  lock: 'lock', 'lock-open': 'unlock', key: 'key', shield: 'shield',
  // Settings & Tools
  settings: 'settings-gear', cog: 'gear', wrench: 'wrench', tool: 'tools', tools: 'tools',
  // Objects
  bulb: 'lightbulb', idea: 'lightbulb', heart: 'heart',
  trophy: 'star-filled', award: 'star-filled', gift: 'gift', package: 'package',
  palette: 'paintcan', paintcan: 'paintcan', rocket: 'rocket', beaker: 'beaker',
  // Charts & Layout
  'chart-bar': 'graph', 'bar-chart': 'graph', 'chart-line': 'graph-line',
  table: 'table', list: 'list-unordered', 'list-ul': 'list-unordered',
  'list-ol': 'list-ordered', menu: 'menu',
  eye: 'eye', show: 'eye', hide: 'eye-closed',
  'zoom-in': 'zoom-in', 'zoom-out': 'zoom-out',
  // Arrows
  'arrow-right': 'arrow-right', 'arrow-left': 'arrow-left',
  'arrow-up': 'arrow-up', 'arrow-down': 'arrow-down',
};

export const TYPE_ICON: Partial<Record<Note['type'], string>> = {
  text: 'file-text',
  code: 'file-code',
  mermaid: 'type-hierarchy',
  canvas: 'symbol-misc',
  mindMap: 'type-hierarchy-sub',
  file: 'file',
  image: 'file-media',
  search: 'search',
  book: 'book',
  relationMap: 'references',
  render: 'preview',
  noteMap: 'type-hierarchy',
  webView: 'globe',
  shortcut: 'link',
  doc: 'book',
  contentWidget: 'symbol-misc',
  launcher: 'rocket',
};

/** Convert a BoxIcon class string (e.g. "bx bx-home") to a VS Code Codicon ID. */
export function boxiconToCodeicon(iconClass: string): string | undefined {
  for (const part of iconClass.trim().split(/\s+/)) {
    const m = /^bx[sl]?-(.+)$/.exec(part);
    if (m) { return BOXICON_TO_CODICON[m[1]]; }
  }
  return undefined;
}

/** Map a CSS color string to the nearest VS Code charts.* ThemeColor ID. */
export function cssColorToThemeColorId(css: string): string | undefined {
  const s = css.trim().toLowerCase();

  const named: Record<string, string> = {
    red: 'charts.red', crimson: 'charts.red', tomato: 'charts.red',
    firebrick: 'charts.red', maroon: 'charts.red', darkred: 'charts.red',
    pink: 'charts.red', hotpink: 'charts.red', deeppink: 'charts.red',
    orange: 'charts.orange', darkorange: 'charts.orange', coral: 'charts.orange',
    salmon: 'charts.orange', orangered: 'charts.orange',
    yellow: 'charts.yellow', gold: 'charts.yellow', khaki: 'charts.yellow',
    green: 'charts.green', lime: 'charts.green', limegreen: 'charts.green',
    darkgreen: 'charts.green', forestgreen: 'charts.green', olive: 'charts.green',
    teal: 'charts.green', seagreen: 'charts.green',
    blue: 'charts.blue', navy: 'charts.blue', darkblue: 'charts.blue',
    royalblue: 'charts.blue', steelblue: 'charts.blue', dodgerblue: 'charts.blue',
    cornflowerblue: 'charts.blue', cyan: 'charts.blue', darkcyan: 'charts.blue',
    purple: 'charts.purple', violet: 'charts.purple', magenta: 'charts.purple',
    orchid: 'charts.purple', plum: 'charts.purple', fuchsia: 'charts.purple',
    indigo: 'charts.purple', darkviolet: 'charts.purple',
  };
  if (named[s]) { return named[s]; }

  let r = -1, g = -1, b = -1;
  let m: RegExpExecArray | null;
  if ((m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s))) {
    [r, g, b] = [m[1] + m[1], m[2] + m[2], m[3] + m[3]].map(x => parseInt(x, 16));
  } else if ((m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(s))) {
    [r, g, b] = [m[1], m[2], m[3]].map(x => parseInt(x, 16));
  } else if ((m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s))) {
    [r, g, b] = [m[1], m[2], m[3]].map(Number);
  }
  if (r < 0) { return undefined; }

  const [rf, gf, bf] = [r / 255, g / 255, b / 255];
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const d = max - min;
  if (d < 0.15) { return undefined; } // achromatic (white / black / gray)

  let h = 0;
  if (max === rf) { h = ((gf - bf) / d + (gf < bf ? 6 : 0)) * 60; }
  else if (max === gf) { h = ((bf - rf) / d + 2) * 60; }
  else { h = ((rf - gf) / d + 4) * 60; }

  if (h < 20 || h >= 345) { return 'charts.red'; }
  if (h < 50) { return 'charts.orange'; }
  if (h < 75) { return 'charts.yellow'; }
  if (h < 165) { return 'charts.green'; }
  if (h < 255) { return 'charts.blue'; }
  return 'charts.purple';
}

// ---------------------------------------------------------------------------

export class NoteItem extends vscode.TreeItem {
  constructor(
    public readonly note: Note,
    public readonly path: string = note.noteId,
    public readonly branchId: string | undefined = undefined,
  ) {
    super(
      note.title,
      note.childNoteIds.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );

    this.id = note.noteId;
    this.tooltip = note.title;

    const { type } = note;
    if (type === 'text') {
      this.contextValue = 'noteText';
    } else if (type === 'code' || type === 'mermaid' || type === 'canvas' || type === 'mindMap') {
      this.contextValue = 'noteCode';
    } else if (type === 'file' || type === 'image') {
      this.contextValue = 'noteFile';
    } else {
      this.contextValue = 'noteExternal';
    }

    if (type !== 'text') {
      this.description = type;
    }

    // Leaf notes open on single click; collapsible notes open via context menu
    if (note.childNoteIds.length === 0) {
      let command: string;
      if (type === 'text' || type === 'code' || type === 'mermaid' || type === 'canvas' || type === 'mindMap') {
        command = 'trilium.openNote';
      } else if (type === 'file' || type === 'image') {
        command = 'trilium.downloadFile';
      } else {
        command = 'trilium.openInBrowser';
      }
      this.command = { command, title: 'Open', arguments: [this] };
    }

    // Icon: #iconClass label → Codicon mapping, falls back to note type default
    const iconAttr = (note.attributes ?? []).find(a => a.type === 'label' && a.name === 'iconClass');
    const codiconId = iconAttr ? boxiconToCodeicon(iconAttr.value) : undefined;
    this.iconPath = new vscode.ThemeIcon(codiconId ?? TYPE_ICON[note.type] ?? 'file');

    // Color: #color label → FileDecoration applied via synthetic resourceUri
    const colorAttr = (note.attributes ?? []).find(a => a.type === 'label' && a.name === 'color');
    if (colorAttr?.value) {
      const colorId = cssColorToThemeColorId(colorAttr.value);
      if (colorId) {
        this.resourceUri = vscode.Uri.from({
          scheme: 'trilium-note',
          path: `/${note.noteId}`,
          query: `color=${colorId}`,
        });
      }
    }
  }
}

export class NoteTreeProvider implements vscode.TreeDataProvider<NoteItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<NoteItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private client: EtapiClient | undefined;
  private _logger: ((msg: string) => void) | undefined;
  private filter = '';

  constructor(initialClient?: EtapiClient) {
    this.client = initialClient;
  }

  setLogger(fn: (msg: string) => void): void {
    this._logger = fn;
  }

  private log(msg: string): void {
    this._logger?.(msg);
  }

  setClient(client: EtapiClient): void {
    this.client = client;
    this.filter = '';
    this._onDidChangeTreeData.fire();
  }

  setFilter(query: string): void {
    this.filter = query;
    this._onDidChangeTreeData.fire();
  }

  clearFilter(): void {
    this.filter = '';
    this._onDidChangeTreeData.fire();
  }

  getFilter(): string {
    return this.filter;
  }

  getClient(): EtapiClient | undefined {
    return this.client;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: NoteItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: NoteItem): Promise<NoteItem[]> {
    if (!this.client) {
      return [];
    }

    // Filter mode: show a flat, single-level list of search results.
    if (this.filter) {
      if (element !== undefined) { return []; }
      try {
        const { results } = await this.client.searchNotes(this.filter, { limit: 100 });
        return results.map((n) => {
          const item = new NoteItem(n);
          item.collapsibleState = vscode.TreeItemCollapsibleState.None;
          return item;
        });
      } catch (err) {
        vscode.window.showErrorMessage(`Trilium: Tree filter search failed: ${err}`);
        return [];
      }
    }

    const rootNoteId = getRootNoteId();
    const noteId = element?.note.noteId ?? rootNoteId;
    // parentPath is the fragment path used to build the Trilium browser URL.
    // root-level items: "root/childId"; deeper: "root/a/b/childId"
    const parentPath = element?.path ?? rootNoteId;

    try {
      const parent = await this.client.getNote(noteId);

      if (parent.childNoteIds.length === 0) {
        return [];
      }

      const children = await Promise.all(
        parent.childNoteIds.map((id) => this.client!.getNote(id)),
      );

      const items = children.map((n, i) => new NoteItem(n, `${parentPath}/${n.noteId}`, parent.childBranchIds[i]));
      this.log(`getChildren(${noteId}): ${items.length} items`);
      items.forEach((item) =>
        this.log(`  ${item.note.noteId} "${item.note.title}" type=${item.note.type} contextValue="${item.contextValue}"`),
      );
      return items;
    } catch (err) {
      vscode.window.showErrorMessage(`Trilium: Failed to load children of "${noteId}": ${err}`);
      return [];
    }
  }
}

export class NoteTreeDecorationProvider {
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== 'trilium-note') { return undefined; }
    const colorId = new URLSearchParams(uri.query).get('color');
    if (!colorId) { return undefined; }
    return { color: new vscode.ThemeColor(colorId) };
  }
}
