/**
 * Overrides CKEditor core's built-in MediaEmbed providers so the four that render a live
 * `<iframe>` preview (dailymotion, spotify, youtube, vimeo — see the matching list in
 * `@ckeditor/ckeditor5-media-embed`'s `MediaEmbedEditing`) render a click-to-open facade instead,
 * for the same reason `linkEmbedRender.ts`'s own video widget does: a live iframe never plays
 * inside a VS Code webview (its sandbox lacks `allow-presentation` and there's no extension-facing
 * way to add it — microsoft/vscode#196975, closed as not planned), surfacing to the user as the
 * provider's own player-configuration error instead of anything this extension can catch.
 *
 * `config.mediaEmbed.providers` *replaces* the whole default list rather than patching it (per
 * CKEditor's own docs), so every provider is reproduced here — the five with no `html` (instagram,
 * twitter, googleMaps, flickr, facebook) already render as a plain non-preview placeholder and are
 * carried over unchanged; only the four preview-capable ones' `html` is swapped for a facade.
 *
 * The regexes themselves are copied verbatim from that package's default config so this stays a
 * pure rendering change: any URL that already auto-embedded still does, just safely.
 */

type MediaMatch = RegExpMatchArray & { input: string };

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Reconstructs a full https URL from a provider match, regardless of which normalization stage
 * (as-is, protocol-stripped, or protocol+www-stripped — see `MediaRegistry#_getUrlMatches`)
 * matched it. */
function toExternalUrl(match: MediaMatch): string {
  const raw = match.input.replace(/^https?:\/\//, '').replace(/^www\./, '');
  return `https://${raw}`;
}

function videoFacadeHtml(href: string, title: string, thumbnailSrc?: string): string {
  const thumbnail = thumbnailSrc
    ? `<img class="link-embed-video-thumbnail" src="${escapeHtmlAttr(thumbnailSrc)}" alt="" loading="lazy">`
    : '';
  // No target="_blank" here: VS Code's webview host script auto-intercepts a plain <a href> click
  // (bubble-phase listener on the webview window) and opens it via the workbench, but that only
  // fires for plain anchors — target="_blank" instead goes through the browser's native
  // window.open(), which the webview's sandboxed iframe blocks (no allow-popups permission), so the
  // click silently does nothing. linkEmbedRender.ts's own video facade already follows this same
  // rule (it only sets target="_blank" for the non-editable/"card" rendering, never inside the
  // editor); this one is only ever rendered inside the live editing view, so it must never set it.
  //
  // data-cke-ignore-events: CKEditor's own widget system listens for mousedown/click through its
  // view-document event pipeline and, unlike our own vendored linkEmbed widget, this raw provider
  // HTML has no chance to run preventCKEditorHandling()-style JS against the constructed DOM node
  // (see widget_utils.ts) to opt out of it. This attribute is the one opt-out CKEditor's engine
  // itself recognizes from markup alone — an event is never dispatched to the view at all when its
  // target sits inside an element carrying it — so it stops CKEditor's own widget-selection gesture
  // from getting there first.
  return `<div class="link-embed-video"><a class="link-embed-video-facade" href="${escapeHtmlAttr(href)}" rel="noopener noreferrer" title="${escapeHtmlAttr(title)}" data-cke-ignore-events="true">${thumbnail}<span class="link-embed-video-play"></span></a></div>`;
}

export const mediaEmbedProviders = [
  {
    name: 'dailymotion',
    url: [/^dailymotion\.com\/video\/(\w+)/, /^dai\.ly\/(\w+)/],
    html: (match: MediaMatch) => videoFacadeHtml(toExternalUrl(match), 'Open on Dailymotion'),
  },
  {
    name: 'spotify',
    url: [
      /^open\.spotify\.com\/(artist\/\w+)/,
      /^open\.spotify\.com\/(album\/\w+)/,
      /^open\.spotify\.com\/(track\/\w+)/,
    ],
    html: (match: MediaMatch) => videoFacadeHtml(toExternalUrl(match), 'Open on Spotify'),
  },
  {
    name: 'youtube',
    url: [
      /^(?:m\.)?youtube\.com\/watch\?v=([\w-]+)(?:&t=(\d+))?/,
      /^(?:m\.)?youtube\.com\/shorts\/([\w-]+)(?:\?t=(\d+))?/,
      /^(?:m\.)?youtube\.com\/v\/([\w-]+)(?:\?t=(\d+))?/,
      /^youtube\.com\/embed\/([\w-]+)(?:\?start=(\d+))?/,
      /^youtu\.be\/([\w-]+)(?:\?t=(\d+))?/,
    ],
    html: (match: MediaMatch) =>
      videoFacadeHtml(toExternalUrl(match), 'Watch on YouTube', `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg`),
  },
  {
    name: 'vimeo',
    url: [
      /^vimeo\.com\/(\d+)/,
      /^vimeo\.com\/[^/]+\/[^/]+\/video\/(\d+)/,
      /^vimeo\.com\/album\/[^/]+\/video\/(\d+)/,
      /^vimeo\.com\/channels\/[^/]+\/(\d+)/,
      /^vimeo\.com\/groups\/[^/]+\/videos\/(\d+)/,
      /^vimeo\.com\/ondemand\/[^/]+\/(\d+)/,
      /^player\.vimeo\.com\/video\/(\d+)/,
    ],
    html: (match: MediaMatch) => videoFacadeHtml(toExternalUrl(match), 'Open on Vimeo'),
  },
  {
    name: 'instagram',
    url: [/^instagram\.com\/p\/(\w+)/, /^instagram\.com\/reel\/(\w+)/],
  },
  {
    name: 'twitter',
    url: [/^twitter\.com/, /^x\.com/],
  },
  {
    name: 'googleMaps',
    url: [/^google\.com\/maps/, /^goo\.gl\/maps/, /^maps\.google\.com/, /^maps\.app\.goo\.gl/],
  },
  {
    name: 'flickr',
    url: /^flickr\.com/,
  },
  {
    name: 'facebook',
    url: /^facebook\.com/,
  },
];
