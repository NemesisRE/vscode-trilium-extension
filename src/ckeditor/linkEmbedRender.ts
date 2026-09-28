import { extractYouTubeVideoId, safeHostname } from './linkEmbedShared.js';

/** Every piece of fetched metadata a linkEmbed/linkMention element stores as a model attribute. */
export interface LinkEmbedRenderMetadata {
  url: string;
  embedType?: string;
  title?: string;
  description?: string;
  favicon?: string;
  siteName?: string;
  image?: string;
}

/**
 * Local reimplementation of Trilium's own `apps/client/src/services/link_embed.tsx` renderers.
 * Upstream builds these with Preact; this extension has no Preact dependency, so the same DOM
 * shape and CSS classes (see trilium-parity.css) are built by hand instead — pure presentation,
 * reading only the attributes already stored on the element, no host round-trip.
 */
export function renderLinkEmbed(container: HTMLElement, metadata: LinkEmbedRenderMetadata, editable?: boolean): void {
  container.innerHTML = '';

  // Only show the YouTube iframe embed when embedType isn't explicitly "opengraph" (Card mode
  // forces opengraph even for a YouTube URL) — lets the user choose player vs. static card.
  const videoId = metadata.embedType !== 'opengraph' ? extractYouTubeVideoId(metadata.url) : null;

  if (videoId) {
    container.append(buildVideoEmbed(videoId));
    return;
  }

  container.append(buildCard(metadata, editable));
}

export function renderLinkMention(
  container: HTMLElement,
  metadata: Pick<LinkEmbedRenderMetadata, 'url' | 'title' | 'favicon'>,
  editable?: boolean,
): void {
  container.innerHTML = '';
  container.append(buildMention(metadata, editable));
}

function buildVideoEmbed(videoId: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'link-embed-video';

  const iframe = document.createElement('iframe');
  // No `origin` param: it's only needed for the postMessage-based IFrame Player API
  // (enablejsapi=1), which this plain unscripted embed doesn't use. Including it anyway
  // breaks playback with "Error configuring video player" (YouTube error 153) inside a VS
  // Code webview, whose origin YouTube doesn't recognize/whitelist the same way a normal
  // https:// site's origin would.
  iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`;
  iframe.frameBorder = '0';
  iframe.allowFullscreen = true;
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.loading = 'lazy';

  wrapper.append(iframe);
  return wrapper;
}

function buildCard(metadata: LinkEmbedRenderMetadata, editable?: boolean): HTMLAnchorElement {
  const card = document.createElement('a');
  card.className = 'link-embed-card';
  card.href = metadata.url;
  // In editing mode, target is omitted so this extension's own link-click handling (double-click/
  // Ctrl+click inside the editable) still applies, mirroring the native link's own convention.
  if (!editable) {
    card.target = '_blank';
  }
  card.rel = 'noopener noreferrer';

  const imageWrapper = document.createElement('div');
  imageWrapper.className = 'link-embed-card-image-wrapper';
  imageWrapper.append(buildCardImage(metadata.image));

  const content = document.createElement('div');
  content.className = 'link-embed-card-content';

  if (metadata.title) {
    const title = document.createElement('div');
    title.className = 'link-embed-card-title';
    title.textContent = metadata.title;
    content.append(title);
  }
  if (metadata.description) {
    const description = document.createElement('div');
    description.className = 'link-embed-card-description';
    description.textContent = metadata.description;
    content.append(description);
  }

  const urlLine = document.createElement('div');
  urlLine.className = 'link-embed-card-url';
  urlLine.textContent = metadata.siteName || safeHostname(metadata.url);
  content.append(urlLine);

  card.append(imageWrapper, content);
  return card;
}

function buildCardImage(src: string | undefined): HTMLElement {
  if (!src) {
    return buildCardImagePlaceholder();
  }

  const img = document.createElement('img');
  img.className = 'link-embed-card-image';
  img.src = src;
  img.alt = '';
  img.loading = 'lazy';
  img.addEventListener('error', () => img.replaceWith(buildCardImagePlaceholder()));
  return img;
}

function buildCardImagePlaceholder(): HTMLElement {
  const placeholder = document.createElement('div');
  placeholder.className = 'link-embed-card-image-placeholder';
  placeholder.textContent = '\u{1F517}';
  return placeholder;
}

function buildMention(
  metadata: Pick<LinkEmbedRenderMetadata, 'url' | 'title' | 'favicon'>,
  editable?: boolean,
): HTMLAnchorElement {
  const mention = document.createElement('a');
  mention.className = 'link-embed-mention';
  mention.href = metadata.url;
  if (!editable) {
    mention.target = '_blank';
  }
  mention.rel = 'noopener noreferrer';

  mention.append(buildFavicon(metadata.favicon));

  const title = document.createElement('span');
  title.className = 'link-embed-mention-title';
  title.textContent = metadata.title || safeHostname(metadata.url);
  mention.append(title);

  return mention;
}

function buildFavicon(src: string | undefined): HTMLElement {
  if (!src) {
    return buildFaviconDot();
  }

  const img = document.createElement('img');
  img.className = 'link-embed-mention-favicon';
  img.src = src;
  img.width = 16;
  img.height = 16;
  img.addEventListener('error', () => img.replaceWith(buildFaviconDot()));
  return img;
}

function buildFaviconDot(): HTMLElement {
  const dot = document.createElement('span');
  dot.className = 'link-embed-mention-dot';
  return dot;
}
