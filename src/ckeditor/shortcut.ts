import type { Editor } from 'ckeditor5';

export type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

const MAC_KEY_MAP: Record<string, string> = {
  ctrl: '⌃',
  control: '⌃',
  shift: '⇧',
  alt: '⌥',
  option: '⌥',
  cmd: '⌘',
  command: '⌘',
  meta: '⌘',
  enter: '↩',
};

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

export function formatShortcut(
  shortcut: string,
  translate: TranslateFn = (key) => key,
  isMac = false,
): string[] {
  return shortcut
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      if (isMac) {
        const mapped = MAC_KEY_MAP[normalizeToken(part)];
        if (mapped) {
          return mapped;
        }
      }
      const key = part.length === 1 ? part.toUpperCase() : part;
      return translate(key);
    });
}

export function joinShortcut(parts: string[], isMac = false): string {
  return isMac ? parts.join('') : parts.join('+');
}

export function renderShortcut(editor: Editor, shortcut: string): string {
  const translate = (editor.config.get('translate') as TranslateFn | undefined) ?? ((key: string) => key);
  const platform = (editor as unknown as { locale?: { uiLanguage?: string } }).locale?.uiLanguage;
  const isMac = typeof navigator !== 'undefined'
    ? /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
    : platform?.toLowerCase().includes('mac') ?? false;
  const tokens = formatShortcut(shortcut, translate, isMac).map((token) => `<kbd>${token}</kbd>`);
  return joinShortcut(tokens, isMac);
}
