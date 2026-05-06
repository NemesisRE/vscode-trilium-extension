/**
 * Minimal stub for the `vscode` module used in unit tests that run outside of
 * the VS Code extension host. Only the surface area exercised by the unit tests
 * needs to be stubbed here — not the full API.
 */

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  label: string;
  collapsibleState: TreeItemCollapsibleState;
  id?: string;
  command?: unknown;
  contextValue?: string;
  description?: string | boolean;
  tooltip?: string | unknown;
  iconPath?: ThemeIcon | Uri | { light: Uri; dark: Uri };
  resourceUri?: Uri;

  constructor(label: string, collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export class ThemeColor {
  constructor(public readonly id: string) {}
}

export class ThemeIcon {
  constructor(
    public readonly id: string,
    public readonly color?: ThemeColor,
  ) {}
}

export class Uri {
  private constructor(
    public readonly scheme: string,
    public readonly authority: string,
    public readonly path: string,
    public readonly query: string,
    public readonly fragment: string,
  ) {}

  static from(components: {
    scheme: string;
    authority?: string;
    path?: string;
    query?: string;
    fragment?: string;
  }): Uri {
    return new Uri(
      components.scheme,
      components.authority ?? '',
      components.path ?? '',
      components.query ?? '',
      components.fragment ?? '',
    );
  }

  static parse(value: string): Uri {
    const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(value);
    if (m) {
      return new Uri(m[1] ?? '', m[2] ?? '', m[3] ?? '', m[4] ?? '', m[5] ?? '');
    }
    return new Uri('file', '', value, '', '');
  }

  static file(fsPath: string): Uri {
    return new Uri('file', '', fsPath, '', '');
  }
}

export class FileDecoration {
  constructor(
    public badge?: string,
    public tooltip?: string,
    public color?: ThemeColor,
  ) {}
}

export class EventEmitter<T> {
  private readonly listeners: Array<(e: T) => unknown> = [];

  get event() {
    return (listener: (e: T) => unknown): { dispose: () => void } => {
      this.listeners.push(listener);
      return { dispose: () => this.listeners.splice(this.listeners.indexOf(listener), 1) };
    };
  }

  fire(data: T): void {
    for (const l of this.listeners) {
      l(data);
    }
  }
}

export const window = {
  activeColorTheme: { kind: 2 },
  showErrorMessage: (_message: string) => Promise.resolve(undefined),
  showWarningMessage: (_message: string) => Promise.resolve(undefined),
  showInformationMessage: (_message: string) => Promise.resolve(undefined),
  setStatusBarMessage: (_message: string, _timeout?: number) => ({ dispose: () => undefined }),
  onDidChangeActiveColorTheme: (_listener: unknown) => ({ dispose: () => undefined }),
  showInputBox: (_options?: unknown) => Promise.resolve(undefined as string | undefined),
  createTreeView: (_id: string, _options?: unknown) => ({
    onDidChangeSelection: () => ({ dispose: () => undefined }),
    dispose: () => undefined,
  }),
  registerFileDecorationProvider: (_provider: unknown) => ({ dispose: () => undefined }),
};

export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: <T>(_key: string, defaultValue: T): T => defaultValue,
    update: (_key: string, _value: unknown, _target?: unknown) => Promise.resolve(),
  }),
  openTextDocument: (_path: string) => Promise.resolve({ getText: () => '' }),
  onDidSaveTextDocument: () => ({ dispose: () => undefined }),
};

export const languages = {
  setTextDocumentLanguage: (_doc: unknown, _languageId: string) => Promise.resolve({}),
};

export const commands = {
  registerCommand: (_id: string, _handler: unknown) => ({ dispose: () => undefined }),
  executeCommand: (_id: string, ..._args: unknown[]) => Promise.resolve(undefined),
};

export enum UIKind {
  Desktop = 1,
  Web = 2,
}

export enum ColorThemeKind {
  Light = 1,
  Dark = 2,
  HighContrast = 3,
  HighContrastLight = 4,
}

export const env = {
  uiKind: UIKind.Desktop,
};

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}
