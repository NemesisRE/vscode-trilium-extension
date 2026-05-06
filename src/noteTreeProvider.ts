import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { EtapiClient, Note } from './etapiClient';
import { getRootNoteId } from './settings';

// ---------------------------------------------------------------------------
// Icon helpers: BoxIcons (used by Trilium's #iconClass label) → Codicons
// ---------------------------------------------------------------------------

const BOXICON_TO_CODICON: Record<string, string> = {
  // Content
  note: 'note', notepad: 'note', book: 'book', 'book-open': 'book',
  'home-alt-2': 'home',
  'file-find': 'search',
  selection: 'symbol-misc',
  widget: 'symbol-misc',
  sitemap: 'type-hierarchy-sub',
  'network-chart': 'references',
  'globe-alt': 'globe',
  'message-square-dots': 'comment-discussion',
  'file-doc': 'file',
  'file-pdf': 'file',
  'file-gif': 'file-media',
  'file-archive': 'archive',
  'file-image': 'file-media',
  music: 'unmute',
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

const TYPE_LABEL: Partial<Record<Note['type'], string>> = {
  mindMap: 'mind map',
  relationMap: 'relation map',
  noteMap: 'note map',
  webView: 'web view',
  contentWidget: 'content widget',
};

const TRILIUM_TYPE_ICON_CLASS: Partial<Record<Note['type'], string>> = {
  file: 'bx bx-file',
  image: 'bx bx-image',
  code: 'bx bx-code',
  render: 'bx bx-extension',
  search: 'bx bx-file-find',
  relationMap: 'bx bxs-network-chart',
  book: 'bx bx-book',
  noteMap: 'bx bxs-network-chart',
  mermaid: 'bx bx-selection',
  canvas: 'bx bx-pen',
  webView: 'bx bx-globe-alt',
  launcher: 'bx bx-link',
  doc: 'bx bxs-file-doc',
  contentWidget: 'bx bxs-widget',
  mindMap: 'bx bx-sitemap',
};

const FILE_MIME_ICON_CLASS: Record<string, string> = {
  'application/pdf': 'bx bxs-file-pdf',
  'image/gif': 'bx bxs-file-gif',
  'application/zip': 'bx bxs-file-archive',
  'application/x-zip-compressed': 'bx bxs-file-archive',
  'application/x-7z-compressed': 'bx bxs-file-archive',
  'application/x-rar-compressed': 'bx bxs-file-archive',
  'application/msword': 'bx bxs-file-doc',
  'application/vnd.oasis.opendocument.text': 'bx bxs-file-doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'bx bxs-file-doc',
  'image/jpeg': 'bx bxs-file-image',
  'image/jpg': 'bx bxs-file-image',
  'image/png': 'bx bxs-file-image',
  'image/webp': 'bx bxs-file-image',
  'image/svg+xml': 'bx bxs-file-image',
};

function normalizeMimeForIcon(mime: string): string {
  return mime.split(';', 1)[0].trim().toLowerCase();
}

type BoxiconStyle = 'regular' | 'solid' | 'logos';

interface ParsedBoxicon {
  style: BoxiconStyle;
  fileName: string;
  iconName: string;
}

const BOXICONS_SVG_RELATIVE_ROOT = path.join('node_modules', 'boxicons', 'svg');
const THEMED_BOXICONS_CACHE_DIR = path.join(os.tmpdir(), 'vscode-trilium', 'themed-boxicons');
const NOTE_TREE_MIME = 'application/vnd.code.tree.triliumnotetree';

interface DraggedNotePayload {
  noteId: string;
  path: string;
  branchId?: string;
}

function defaultThemeIconColor(kind: vscode.ColorThemeKind): string {
  switch (kind) {
    case vscode.ColorThemeKind.Light:
      return '#444444';
    case vscode.ColorThemeKind.HighContrastLight:
      return '#111111';
    case vscode.ColorThemeKind.HighContrast:
      return '#f0f0f0';
    case vscode.ColorThemeKind.Dark:
    default:
      return '#c6c6c6';
  }
}

function normalizeSvgColor(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/.test(trimmed)) {
    return trimmed;
  }
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(\s*,\s*(0|1|0?\.\d+))?\s*\)$/.test(trimmed)) {
    return trimmed;
  }
  if (/^hsla?\(\s*\d{1,3}(\.\d+)?\s*,\s*\d{1,3}(\.\d+)?%\s*,\s*\d{1,3}(\.\d+)?%(\s*,\s*(0|1|0?\.\d+))?\s*\)$/.test(trimmed)) {
    return trimmed;
  }
  if (/^[a-z][a-z-]*$/.test(trimmed)) {
    return trimmed;
  }

  return undefined;
}

function themedBoxiconSvg(svg: string, color: string): string {
  // Force icon paths to a readable color while preserving explicit "none" fills/strokes.
  const withRootFill = svg.replace(/<svg\b([^>]*)>/i, (_m, attrs) => {
    const attrsWithoutFill = String(attrs).replace(/\sfill="[^"]*"/gi, '');
    return `<svg${attrsWithoutFill} fill="${color}">`;
  });

  return withRootFill
    .replace(/\sfill="(?!none\b)[^"]*"/gi, ` fill="${color}"`)
    .replace(/\sstroke="(?!none\b)[^"]*"/gi, ` stroke="${color}"`);
}

function boxiconToThemedSvgUri(
  iconClass: string,
  boxiconsSvgRoot: string | undefined,
  color: string,
): vscode.Uri | undefined {
  if (!boxiconsSvgRoot) {
    return undefined;
  }

  const parsed = parseBoxiconClass(iconClass);
  if (!parsed) {
    return undefined;
  }

  const sourcePath = path.join(boxiconsSvgRoot, parsed.style, parsed.fileName);
  if (!fs.existsSync(sourcePath)) {
    return undefined;
  }

  fs.mkdirSync(THEMED_BOXICONS_CACHE_DIR, { recursive: true });

  const key = `${sourcePath}|${color}`;
  const digest = createHash('sha1').update(key).digest('hex').slice(0, 10);
  const targetFile = `${parsed.fileName.replace(/\.svg$/i, '')}-${digest}.svg`;
  const targetPath = path.join(THEMED_BOXICONS_CACHE_DIR, targetFile);

  if (!fs.existsSync(targetPath)) {
    const rawSvg = fs.readFileSync(sourcePath, 'utf8');
    fs.writeFileSync(targetPath, themedBoxiconSvg(rawSvg, color), 'utf8');
  }

  return vscode.Uri.file(targetPath);
}

/** Parse Trilium #iconClass values like "bx bx-home" / "bx bxs-lock" / "bx bxl-github". */
export function parseBoxiconClass(iconClass: string): ParsedBoxicon | undefined {
  for (const token of iconClass.trim().split(/\s+/)) {
    const m = /^(bx|bxs|bxl)-([a-z0-9-]+)$/i.exec(token);
    if (!m) {
      continue;
    }

    const prefix = m[1].toLowerCase();
    const name = m[2].toLowerCase();
    const style: BoxiconStyle =
      prefix === 'bxs' ? 'solid' :
      prefix === 'bxl' ? 'logos' :
      'regular';

    return {
      style,
      fileName: `${prefix}-${name}.svg`,
      iconName: name,
    };
  }

  return undefined;
}

/** Convert a BoxIcon class string (e.g. "bx bx-home") to a VS Code Codicon ID. */
export function boxiconToCodeicon(iconClass: string): string | undefined {
  const parsed = parseBoxiconClass(iconClass);
  return parsed ? BOXICON_TO_CODICON[parsed.iconName] : undefined;
}

export function noteTypeToLabel(type: Note['type']): string {
  const explicit = TYPE_LABEL[type];
  if (explicit) {
    return explicit;
  }
  return type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function defaultBoxiconClassForNote(note: Note): string {
  if (note.noteId === 'root') {
    return 'bx bx-home-alt-2';
  }
  if (note.noteId === '_share') {
    return 'bx bx-share-alt';
  }

  if (note.type === 'text') {
    return note.childNoteIds.length > 0 ? 'bx bx-folder' : 'bx bx-note';
  }

  if (note.type === 'code') {
    const mime = normalizeMimeForIcon(note.mime);
    if (mime === 'text/markdown' || mime === 'text/x-markdown') {
      return 'bx bxl-markdown';
    }
    return TRILIUM_TYPE_ICON_CLASS.code ?? 'bx bx-code';
  }

  if (note.type === 'file') {
    const mime = normalizeMimeForIcon(note.mime);
    if (mime.startsWith('video/')) {
      return 'bx bx-video';
    }
    if (mime.startsWith('audio/')) {
      return 'bx bx-music';
    }
    return FILE_MIME_ICON_CLASS[mime] ?? TRILIUM_TYPE_ICON_CLASS.file ?? 'bx bx-file';
  }

  if (note.type === 'image') {
    const mime = normalizeMimeForIcon(note.mime);
    return FILE_MIME_ICON_CLASS[mime] ?? TRILIUM_TYPE_ICON_CLASS.image ?? 'bx bx-image';
  }

  return TRILIUM_TYPE_ICON_CLASS[note.type] ?? 'bx bx-file';
}

export function preferredCodiconForNote(note: Note): string {
  const iconAttr = (note.attributes ?? []).find(a => a.type === 'label' && a.name === 'iconClass');
  const effectiveIconClass = iconAttr?.value ?? defaultBoxiconClassForNote(note);
  const codiconId = boxiconToCodeicon(effectiveIconClass);
  return codiconId ?? TYPE_ICON[note.type] ?? 'file';
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

const MIME_TO_FENCE_LANG: Record<string, string> = {
  'text/javascript': 'javascript',
  'application/javascript': 'javascript',
  'text/typescript': 'typescript',
  'application/typescript': 'typescript',
  'text/x-python': 'python',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'application/json': 'json',
  'text/xml': 'xml',
  'application/xml': 'xml',
  'text/css': 'css',
  'text/x-sh': 'bash',
  'text/x-sql': 'sql',
  'text/x-java': 'java',
  'text/x-csrc': 'c',
  'text/x-c': 'c',
  'text/x-c++src': 'cpp',
};

function mimeToCodeFenceLang(mime: string): string {
  return MIME_TO_FENCE_LANG[mime.split(';', 1)[0].trim().toLowerCase()] ?? '';
}

// ---------------------------------------------------------------------------

export class NoteItem extends vscode.TreeItem {
  constructor(
    public readonly note: Note,
    public readonly path: string = note.noteId,
    public readonly branchId: string | undefined = undefined,
    boxiconsSvgRoot?: string,
  ) {
    super(
      note.title,
      note.childNoteIds.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );

    // Note IDs are not unique in the tree when notes are cloned.
    // Use a location-specific ID so VS Code can distinguish original/clone entries.
    this.id = branchId ? `${note.noteId}@${branchId}` : this.path;
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
      this.description = noteTypeToLabel(type);
    }
    if (note.isProtected) {
      this.description = this.description ? `${this.description} · protected` : 'protected';
    }

    // Open all notes on click, including section notes with children.
    // Collapsing/expanding remains available via the disclosure arrow.
    let commandId: string;
    if (type === 'text' || type === 'code' || type === 'mermaid' || type === 'canvas' || type === 'mindMap') {
      commandId = 'trilium.openNote';
    } else if (type === 'file' || type === 'image') {
      commandId = 'trilium.openFile';
    } else {
      commandId = 'trilium.openInBrowser';
    }
    this.command = { command: commandId, title: 'Open', arguments: [this] };

    const colorAttr = (note.attributes ?? []).find(a => a.type === 'label' && a.name === 'color');
    const colorId = colorAttr?.value ? cssColorToThemeColorId(colorAttr.value) : undefined;
    const svgColor =
      normalizeSvgColor(colorAttr?.value) ??
      defaultThemeIconColor(vscode.window.activeColorTheme.kind);

    // Icon: use real Trilium Boxicons when available, recolored for current theme.
    // Fallback to codicons when no matching icon asset is present.
    const iconAttr = (note.attributes ?? []).find(a => a.type === 'label' && a.name === 'iconClass');
    const effectiveIconClass = iconAttr?.value ?? defaultBoxiconClassForNote(note);
    const themedBoxiconUri = boxiconToThemedSvgUri(effectiveIconClass, boxiconsSvgRoot, svgColor);
    if (themedBoxiconUri) {
      this.iconPath = themedBoxiconUri;
    } else {
      const codiconId = boxiconToCodeicon(effectiveIconClass);
      this.iconPath = new vscode.ThemeIcon(
        codiconId ?? TYPE_ICON[note.type] ?? 'file',
        colorId ? new vscode.ThemeColor(colorId) : undefined,
      );
    }

    // Color/protected markers: FileDecoration applied via synthetic resourceUri
    if (colorId || note.isProtected) {
      const query = new URLSearchParams();
      if (colorId) {
        query.set('color', colorId);
      }
      if (note.isProtected) {
        query.set('protected', '1');
      }
      this.resourceUri = vscode.Uri.from({
        scheme: 'trilium-note',
        path: `/${note.noteId}`,
        query: query.toString(),
      });
    }
  }
}

export class NoteTreeProvider implements vscode.TreeDataProvider<NoteItem>, vscode.TreeDragAndDropController<NoteItem> {
  readonly dragMimeTypes: readonly string[] = [NOTE_TREE_MIME];
  readonly dropMimeTypes: readonly string[] = [NOTE_TREE_MIME];

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<NoteItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private client: EtapiClient | undefined;
  private _logger: ((msg: string) => void) | undefined;
  private filter = '';
  private boxiconsSvgRoot: string | undefined;

  constructor(initialClient?: EtapiClient, extensionPath?: string) {
    this.client = initialClient;
    if (extensionPath) {
      this.boxiconsSvgRoot = path.join(extensionPath, BOXICONS_SVG_RELATIVE_ROOT);
    }
  }

  setExtensionPath(extensionPath: string): void {
    this.boxiconsSvgRoot = path.join(extensionPath, BOXICONS_SVG_RELATIVE_ROOT);
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

  handleDrag(
    source: readonly NoteItem[],
    dataTransfer: vscode.DataTransfer,
  ): void {
    const payload: DraggedNotePayload[] = source.map((item) => ({
      noteId: item.note.noteId,
      path: item.path,
      branchId: item.branchId,
    }));
    dataTransfer.set(NOTE_TREE_MIME, new vscode.DataTransferItem(payload));
  }

  private async getDraggedPayload(dataTransfer: vscode.DataTransfer): Promise<DraggedNotePayload[]> {
    const item = dataTransfer.get(NOTE_TREE_MIME);
    if (!item) {
      return [];
    }

    const value = item.value as unknown;
    if (Array.isArray(value)) {
      return value.filter((entry): entry is DraggedNotePayload => {
        return !!entry
          && typeof entry === 'object'
          && typeof (entry as { noteId?: unknown }).noteId === 'string'
          && typeof (entry as { path?: unknown }).path === 'string';
      });
    }

    const text = await item.asString();
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is DraggedNotePayload => {
      return !!entry
        && typeof entry === 'object'
        && typeof (entry as { noteId?: unknown }).noteId === 'string'
        && typeof (entry as { path?: unknown }).path === 'string';
    });
  }

  private parentIdFromPath(itemPath: string): string | undefined {
    const parts = itemPath.split('/').filter(Boolean);
    if (parts.length < 2) {
      return undefined;
    }
    return parts[parts.length - 2];
  }

  private filterDescendants(payload: DraggedNotePayload[]): DraggedNotePayload[] {
    return payload.filter((item) => {
      return !payload.some((other) => {
        if (other === item) {
          return false;
        }
        return item.path.startsWith(`${other.path}/`);
      });
    });
  }

  async handleDrop(
    target: NoteItem | undefined,
    dataTransfer: vscode.DataTransfer,
  ): Promise<void> {
    if (!this.client) {
      return;
    }

    const targetParentId = target?.note.noteId ?? getRootNoteId();
    const payload = this.filterDescendants(await this.getDraggedPayload(dataTransfer));
    if (payload.length === 0) {
      return;
    }

    let movedCount = 0;
    let skippedCount = 0;
    const touchedParents = new Set<string>([targetParentId]);

    for (const dragged of payload) {
      if (dragged.noteId === targetParentId) {
        skippedCount += 1;
        continue;
      }

      if (target && (target.path === dragged.path || target.path.startsWith(`${dragged.path}/`))) {
        skippedCount += 1;
        continue;
      }

      const sourceParentId = this.parentIdFromPath(dragged.path);
      if (sourceParentId === targetParentId) {
        skippedCount += 1;
        continue;
      }

      if (!dragged.branchId) {
        skippedCount += 1;
        continue;
      }

      await this.client.createBranch(dragged.noteId, targetParentId);
      await this.client.deleteBranch(dragged.branchId);
      if (sourceParentId) {
        touchedParents.add(sourceParentId);
      }
      movedCount += 1;
    }

    if (movedCount === 0) {
      if (skippedCount > 0) {
        void vscode.window.showInformationMessage('Trilium: Nothing to move for this drop target.');
      }
      return;
    }

    await Promise.all(
      Array.from(touchedParents).map(async (parentId) => {
        try {
          await this.client!.refreshNoteOrdering(parentId);
        } catch {
          // Best-effort ordering refresh; tree refresh below still reflects moved branches.
        }
      }),
    );

    this.refresh();
  }

  getTreeItem(element: NoteItem): vscode.TreeItem {
    return element;
  }

  async resolveTreeItem(
    item: vscode.TreeItem,
    element: NoteItem,
    token: vscode.CancellationToken,
  ): Promise<vscode.TreeItem | undefined> {
    if (!this.client) {
      return undefined;
    }

    const { note } = element;
    const previewTypes = new Set<Note['type']>(['text', 'code', 'mermaid']);

    if (!previewTypes.has(note.type)) {
      return undefined;
    }

    let content: string;
    try {
      content = await this.client.getNoteContent(note.noteId);
    } catch {
      return undefined;
    }

    if (token.isCancellationRequested) {
      return undefined;
    }

    const md = new vscode.MarkdownString('', true);
    md.isTrusted = false;
    md.supportHtml = false;

    const typeLabel = noteTypeToLabel(note.type);
    const childCount = note.childNoteIds.length;
    const childPart = childCount > 0 ? `, ${childCount} child${childCount === 1 ? '' : 'ren'}` : '';
    md.appendMarkdown(`**${typeLabel}${childPart}**\n\n`);

    if (note.type === 'text') {
      const plain = content
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
      if (plain.length > 0) {
        const preview = plain.length > 300 ? `${plain.slice(0, 300)}…` : plain;
        md.appendMarkdown(preview);
      }
    } else {
      // code / mermaid
      const lang = mimeToCodeFenceLang(note.mime);
      const preview = content.length > 300 ? `${content.slice(0, 300)}…` : content;
      md.appendCodeblock(preview, lang);
    }

    item.tooltip = md;
    return item;
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
          const item = new NoteItem(n, n.noteId, undefined, this.boxiconsSvgRoot);
          item.collapsibleState = vscode.TreeItemCollapsibleState.None;
          return item;
        });
      } catch (err) {
        vscode.window.showErrorMessage(`Trilium: Tree filter search failed: ${err}`);
        return [];
      }
    }

    const rootNoteId = getRootNoteId();
    if (!element) {
      try {
        const root = await this.client.getNote(rootNoteId);
        const rootItem = new NoteItem(root, rootNoteId, undefined, this.boxiconsSvgRoot);
        if (root.childNoteIds.length > 0) {
          rootItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        }
        return [rootItem];
      } catch (err) {
        vscode.window.showErrorMessage(`Trilium: Failed to load root note "${rootNoteId}": ${err}`);
        return [];
      }
    }

    const noteId = element.note.noteId;
    // parentPath is the fragment path used to build the Trilium browser URL.
    // root-level items: "root/childId"; deeper: "root/a/b/childId"
    const parentPath = element.path;

    try {
      const parent = await this.client.getNote(noteId);

      if (parent.childNoteIds.length === 0) {
        return [];
      }

      const children = await Promise.all(
        parent.childNoteIds.map((id) => this.client!.getNote(id)),
      );

      const items = children.map((n, i) =>
        new NoteItem(n, `${parentPath}/${n.noteId}`, parent.childBranchIds[i], this.boxiconsSvgRoot));
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
    const params = new URLSearchParams(uri.query);
    const colorId = params.get('color');
    const isProtected = params.get('protected') === '1';
    if (!colorId && !isProtected) { return undefined; }
    return {
      color: colorId ? new vscode.ThemeColor(colorId) : undefined,
      badge: isProtected ? 'L' : undefined,
      tooltip: isProtected ? 'Protected note' : undefined,
    };
  }
}
