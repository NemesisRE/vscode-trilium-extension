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
    /** True when the host could not read the page at all (network error, timeout, non-HTML
     * response, blocked by the SSRF guard) - the URL is then left as a plain link rather than
     * becoming a preview that shows less than the URL itself did. */
    unresolved?: boolean;
  }
}

declare module 'ckeditor5' {
  interface Editor {
    /** Set by cuttonote.ts's CutToNotePlugin. Serializes the current selection to HTML. */
    getSelectedHtml(): string;
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
      /** Creates a sub-note from the given HTML/text preview; resolves to whether it was created. */
      execute(html: string, textPreview: string): Promise<boolean>;
    };

    /** Read by copy_anchor_link.ts. The current note's own id/title (a bookmark is always an
     * anchor within the note being edited). */
    copyAnchorLink?: {
      noteId?: string;
      noteTitle?: string;
    };

    /** Read by markdownimport.ts's MarkdownImportPlugin. */
    markdownImport?: {
      /** Reads the system clipboard and converts Markdown to HTML; resolves to the HTML to insert. */
      execute(): Promise<string | undefined>;
    };

    /** Read by link_embed_commands.ts and link_embed_autodetect.ts. */
    linkEmbed?: {
      /** Fetches a URL's preview metadata through the extension host (outside the webview's
       * CSP). Never rejects: any failure resolves as `{ unresolved: true }`. */
      fetchMetadata(url: string): Promise<LinkEmbedMetadata>;
    };
  }
}

export {};
