/**
 * Local port of the pieces of `@triliumnext/commons` that vendor's link_embed plugin imports
 * (isHttpUrl, chooseLinkPreviewKind, isUrlAloneInBlock, BlockChildLike, YOUTUBE_REGEX,
 * extractYouTubeVideoId) — that package isn't shipped with this standalone extension (same
 * situation as triliumCommons.ts). Ported from packages/commons/src/lib/link_embed.ts and
 * utils.ts at the Trilium commit this repo's vendor/ was downloaded from, so the auto-detect
 * gesture (isUrlAloneInBlock/chooseLinkPreviewKind) and the href-sanitizing check (isHttpUrl)
 * match upstream's behavior exactly.
 */

export const YOUTUBE_REGEX = /(?:youtube\.com\/watch\?[^\s#]*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;

export function extractYouTubeVideoId(url: string): string | null {
  const match = url.match(YOUTUBE_REGEX);
  return match ? match[1] : null;
}

/**
 * True when the URL is one a link preview may ever point at. A preview's URL reaches the
 * renderers as a `data-url` attribute of the stored note HTML, and this extension's HTML
 * sanitizer passes `data-*` values through untouched, so a note carrying
 * `data-url="javascript:…"` (import, hand-edited HTML) would otherwise render as a live
 * `<a href="javascript:…">`. The host-side fetch only ever produces http(s) URLs, so anything
 * else is illegitimate by construction.
 */
export function isHttpUrl(url: string | undefined | null): boolean {
  if (!url) {
    return false;
  }

  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * A runtime-neutral view of a block's child node, decoupled from CKEditor's model types so this
 * logic can be unit-tested with plain objects.
 */
export interface BlockChildLike {
  /** True for a text node; false for any element (image, soft break, widget, …). */
  isText: boolean;
  /** Text contents when `isText`; ignored otherwise. */
  data?: string;
}

/**
 * True when `url` is the sole content of a block — its only non-whitespace text is the URL and
 * it holds no other elements. Surrounding whitespace (such as the trailing space that triggers
 * auto-linking) is ignored.
 */
export function isUrlAloneInBlock(children: Iterable<BlockChildLike>, url: string): boolean {
  let text = '';
  for (const child of children) {
    if (!child.isText) {
      return false;
    }
    text += child.data ?? '';
  }
  return text.trim() === url;
}

export type LinkPreviewKind = 'embed' | 'card' | 'mention';

/** Where an auto-detected URL sits, and what the user did right after typing it. */
export interface LinkPreviewPlacement {
  /** The URL is the block's only content (see {@link isUrlAloneInBlock}). */
  urlAloneInBlock: boolean;
  /**
   * The block is a plain top-level paragraph — not a list item, table cell, quote or heading.
   * A block-level preview inside those reads as a layout accident, so they stay inline.
   */
  blockIsStandalone: boolean;
  /**
   * The caret has left the block, which is what pressing Enter does. While the caret is still
   * there the user is plausibly mid-sentence, so the URL has not (yet) been *left* alone.
   */
  caretLeftBlock: boolean;
}

/**
 * Chooses how an auto-detected URL should be previewed: only a URL deliberately left alone on
 * its own line (sole content of a plain paragraph, then Enter) becomes a block-level preview —
 * a player for an embeddable URL (YouTube), a card otherwise. Anything else yields an
 * unobtrusive inline mention.
 */
export function chooseLinkPreviewKind(embedType: string, placement: LinkPreviewPlacement): LinkPreviewKind {
  if (!placement.urlAloneInBlock || !placement.blockIsStandalone || !placement.caretLeftBlock) {
    return 'mention';
  }

  return embedType !== 'opengraph' ? 'embed' : 'card';
}

/** The only two shapes the host-side metadata fetch (and this local detector) ever produces. */
export type EmbedType = 'youtube' | 'opengraph';

/** Which kind of player/card a URL supports — pure URL-pattern matching, no network needed. */
export function detectEmbedType(url: string): EmbedType {
  return YOUTUBE_REGEX.test(url) ? 'youtube' : 'opengraph';
}
