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

  // Only show the YouTube facade when embedType isn't explicitly "opengraph" (Card mode forces
  // opengraph even for a YouTube URL) — lets the user choose player vs. static card.
  const videoId = metadata.embedType !== 'opengraph' ? extractYouTubeVideoId(metadata.url) : null;

  if (videoId) {
    container.append(buildVideoEmbed(metadata, editable));
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

/**
 * A YouTube thumbnail with a play button that opens the video in the user's default browser,
 * rather than a live `<iframe>` player — VS Code's own webview sandbox has no working path to one
 * (see the CSS comment above `.link-embed-video-facade`). The note's stored HTML only ever holds
 * `data-url`/`data-embed-type="youtube"`, so this is purely how *this extension* displays it; the
 * same note opened in actual Trilium still gets Trilium's own live player, unaffected.
 */
function buildVideoEmbed(metadata: LinkEmbedRenderMetadata, editable?: boolean): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'link-embed-video';

  const facade = document.createElement('a');
  facade.className = 'link-embed-video-facade';
  facade.href = metadata.url;
  // Same convention as the card link: in editing mode, omit target so this extension's own
  // link-click handling (double-click/Ctrl+click inside the editable) still applies.
  if (!editable) {
    facade.target = '_blank';
  }
  facade.rel = 'noopener noreferrer';
  facade.title = 'Watch on YouTube';

  if (metadata.image) {
    const thumbnail = document.createElement('img');
    thumbnail.className = 'link-embed-video-thumbnail';
    thumbnail.src = metadata.image;
    thumbnail.alt = '';
    thumbnail.loading = 'lazy';
    facade.append(thumbnail);
  }

  const playButton = document.createElement('span');
  playButton.className = 'link-embed-video-play';
  facade.append(playButton);

  wrapper.append(facade);
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
