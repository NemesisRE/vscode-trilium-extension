// The vendored Trilium CKEditor package declares these same augmentations itself, in
// vendor/ckeditor5/src/index.ts - but that file also pulls in Tier-3 plugins (snippets, the AI
// assistant) this extension doesn't use, and this project's tsconfig only compiles src/**, not
// vendor/**, so those declarations never reach our program anyway. Duplicated here instead,
// trimmed to just what the plugins this extension actually registers need. Import this file
// for its side effects only (no runtime code) from wherever those plugins are wired up.
declare global {
  /** Every piece of fetched metadata a linkEmbed/linkMention element stores as a model
   * attribute. Set by link_embed_commands.ts and link_embed_autodetect.ts. */
  interface LinkEmbedMetadata {
    url: string;
    embedType: string;
    title?: string;
    description?: string;
    favicon?: string;
    siteName?: string;
    image?: string;
    /** The video's width/height ratio (e.g. "16/9"), for the embeddable providers that have one. */
    aspectRatio?: string;
    /** True when the host could not read the page at all (network error, timeout, non-HTML
     * response, blocked by the SSRF guard) - the URL is then left as a plain link rather than
     * becoming a preview that shows less than the URL itself did. */
    unresolved?: boolean;
  }

  /** A button that the content of an embed adds to the toolbar of the embed. */
  interface ContentEmbedTool {
    id: string;
    label: string;
    text?: string;
    icon?: string;
    isOn?: boolean;
    isEnabled?: boolean;
    group?: string;
    keystroke?: string;
    children?: ContentEmbedTool[];
    opensMenu?: boolean;
    class?: string;
  }

  /** An item of the embed toolbar that the content of an embed can hide. */
  type ContentEmbedToolbarItem =
    'contentEmbedBoxSizeDropdown' | 'contentEmbedPositionDropdown' | 'toggleContentEmbedEditable';

  /** The buttons that the content of an embed, such as a canvas drawing, adds to its toolbar.
   * content_embed.ts's `ContentEmbedHost.getTools()` returns one (or `null`). */
  interface ContentEmbedToolProvider {
    getTools(): ContentEmbedTool[];
    execute(id: string): void;
    openMenu?(id: string, anchor: HTMLElement): void;
    subscribe(callback: () => void): () => void;
    toolbarTitle?: string;
    hiddenToolbarItems?: readonly ContentEmbedToolbarItem[];
    hiddenToolbarItemsWhileEditable?: readonly ContentEmbedToolbarItem[];
    boxSizeIcon?: string;
    hasEditableFlag?: boolean;
    hasDisplayModes?: boolean;
    hasPositions?: boolean;
  }
}

declare module 'ckeditor5' {
  interface Editor {
    /** Set by cuttonote.ts's CutToNotePlugin. Serializes the current selection to HTML. */
    getSelectedHtml(): string;
    /** Set by cuttonote.ts's CutToNotePlugin. Serializes the current selection to indented
     * plain text, the same way the native copy's `text/plain` clipboard flavor does. */
    getSelectedPlainText(): string;
    /** Set by cuttonote.ts's CutToNotePlugin. Pastes `html` (or `text` as a fallback) at the
     * current selection, through the normal clipboard-paste pipeline. */
    pasteContent(html: string, text: string): void;
    /** Set by cuttonote.ts's CutToNotePlugin. Pins the current selection as live ranges for a
     * paste whose content arrives asynchronously (e.g. from `navigator.clipboard.read()`). */
    capturePasteTarget(): {
      /** Pastes at the pinned selection, then releases it. Does nothing when the pinned
       * content is gone. */
      paste(html: string, text: string): void;
      /** Moves the selection back onto the pinned ranges and releases them. Returns `false`
       * when the pinned content is gone. */
      restore(): boolean;
      /** Detaches the pinned ranges without pasting. Safe to call more than once. */
      release(): void;
    };
    /** Set by cuttonote.ts's CutToNotePlugin. Deletes the current selection. */
    removeSelection(): Promise<void>;
  }

  interface EditorConfig {
    /** Read by copy_link_url.ts and copy_to_clipboard_button.ts. */
    clipboard?: {
      copy(text: string): void;
      /** Read by copy_anchor_link.ts. Copies rich HTML, with `plainText` as the fallback. */
      copyHtml?(html: string, plainText: string): void;
    };

    /** Read by cuttonote.ts's CutToNotePlugin. */
    cutToNote?: {
      /** Moves the selection into a new child note of the note the editor holds. */
      cut(): void;
      /** Saves the note now, once the selection is removed, rather than after the usual delay. */
      saveNow(): Promise<void>;
    };

    /** Read by copy_anchor_link.ts. The current note's own id/title (a bookmark is always an
     * anchor within the note being edited). */
    copyAnchorLink?: {
      noteId?: string;
      noteTitle?: string;
    };

    /** Read by markdownimport.ts's MarkdownImportPlugin. */
    markdownImport?: {
      /** Opens the dialog that converts Markdown into the note at the selection. */
      open(): void;
    };

    // linkEmbed is declared by link_embed_commands.ts itself now (as `Partial<LinkEmbedHost>`);
    // this extension only ever sets `fetchMetadata` on it, which that shape still allows.
  }
}

export {};
