import * as dns from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';

import { detectEmbedType, extractYouTubeVideoId } from './ckeditor/linkEmbedShared.js';

const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_FAVICON_BYTES = 64 * 1024;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'vscode-trilium-extension/link-preview (+https://github.com/NemesisRE/vscode-trilium-extension)';

/**
 * True when `ip` (already in the canonical dotted-decimal / colon-hex form `dns.lookup()`
 * returns) is a private, loopback, link-local or otherwise non-public address that a
 * user-pasted URL must never be allowed to reach.
 *
 * Trilium's own link-preview endpoint had exactly this class of bug (GHSA-8h94-9q2r-jhqp): it
 * validated the resolved IP, then handed the *hostname* to `fetch()`, which re-resolved it
 * independently — a DNS answer that differs between the two lookups (DNS rebinding) slips
 * straight past the check. This module closes that gap structurally instead of just
 * classifying ranges correctly: {@link resolveValidatedAddress} is the only place a hostname is
 * ever resolved, and {@link pinnedRequest} connects to that exact address and never resolves
 * the hostname again (see its `servername`/`Host` handling).
 */
export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    return isBlockedIpv4(ip);
  }
  if (net.isIPv6(ip)) {
    return isBlockedIpv6(ip);
  }
  // Not a recognizable IP literal at all - treat as blocked rather than let it through unchecked.
  return true;
}

function isBlockedIpv4(ip: string): boolean {
  const octets = ip.split('.').map(Number);
  const [a, b] = octets;

  if (a === 0) return true; // 0.0.0.0/8 - "this network"
  if (a === 10) return true; // 10.0.0.0/8 - private
  if (a === 127) return true; // 127.0.0.0/8 - loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 - CGNAT
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 - link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 - private
  if (a === 192 && b === 0 && octets[2] === 0) return true; // 192.0.0.0/24 - IETF protocol assignments
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 - private
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 - benchmarking
  if (a >= 224) return true; // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, 255.255.255.255 broadcast

  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = normalizeIpv6(ip);

  if (normalized === '::' || normalized === '::1') return true; // unspecified / loopback
  if (normalized.startsWith('fe80:') || hasIpv6Prefix(normalized, 'fe8', 'febf')) return true; // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // fc00::/7 unique local
  if (normalized.startsWith('ff')) return true; // ff00::/8 multicast

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses carry an IPv4
  // address that must be checked in its own right - an IPv6 socket can still reach it.
  const mapped = extractMappedIpv4(ip);
  if (mapped) return isBlockedIpv4(mapped);

  return false;
}

function normalizeIpv6(ip: string): string {
  return ip.toLowerCase();
}

function hasIpv6Prefix(normalized: string, _lowBound: string, _highBound: string): boolean {
  // fe80::/10 covers fe80: through febf: - checked with a direct hextet comparison instead of
  // string bounds, which don't sort correctly for hex nibbles.
  const firstHextet = parseInt(normalized.split(':')[0] || '0', 16);
  return firstHextet >= 0xfe80 && firstHextet <= 0xfebf;
}

function extractMappedIpv4(ip: string): string | null {
  const match = ip.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/i);
  return match ? match[1] : null;
}

class BlockedUrlError extends Error {
  constructor(url: string) {
    super(`URL points to a private/internal address: ${url}`);
  }
}

/**
 * Resolves `hostname` and validates that every address it resolves to is public. Returns the
 * first validated address - the one {@link pinnedRequest} will actually connect to, so the
 * validation and the connection are guaranteed to agree (no second, independent lookup).
 */
async function resolveValidatedAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new BlockedUrlError(hostname);
    }
    return { address: hostname, family: net.isIPv6(hostname) ? 6 : 4 };
  }

  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`Could not resolve hostname: ${hostname}`);
  }

  if (addresses.length === 0) {
    throw new Error(`Could not resolve hostname: ${hostname}`);
  }

  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new BlockedUrlError(hostname);
    }
  }

  return { address: addresses[0].address, family: addresses[0].family as 4 | 6 };
}

interface FetchedResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/**
 * Performs one HTTP(S) request, connecting to the already-validated `address` rather than
 * `url`'s hostname - `Host`/SNI still carry the real hostname, so routing and certificate
 * validation work exactly as they would for a normal request to that host. This is the one
 * seam that has to hold for the whole module to be safe: nothing downstream re-resolves the
 * hostname, so a DNS answer that changes after {@link resolveValidatedAddress} returned can
 * never redirect the actual connection.
 */
function pinnedRequest(url: URL, address: string, maxBytes: number): Promise<FetchedResponse> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const req = transport.request({
      protocol: url.protocol,
      hostname: address,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      timeout: FETCH_TIMEOUT_MS,
      headers: {
        Host: url.host,
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      // TLS certificate validation (and SNI) must check the real hostname, not the IP we
      // actually connect to.
      ...(isHttps ? { servername: url.hostname } : {}),
    }, (res) => {
      const chunks: Buffer[] = [];
      let total = 0;

      res.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          res.destroy();
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
      });

      res.on('error', reject);
    });

    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * Fetches one URL with SSRF protection, following redirects up to {@link MAX_REDIRECTS} - each
 * hop is independently resolved and validated (a redirect to an internal target is rejected
 * exactly like a direct request to one would be).
 */
async function safeFetch(urlString: string, maxBytes: number): Promise<FetchedResponse> {
  let currentUrl = new URL(urlString);

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    if (currentUrl.protocol !== 'http:' && currentUrl.protocol !== 'https:') {
      throw new Error(`Unsupported URL scheme: ${currentUrl.protocol}`);
    }

    const { address } = await resolveValidatedAddress(currentUrl.hostname);
    const response = await pinnedRequest(currentUrl, address, maxBytes);

    if (response.statusCode >= 300 && response.statusCode < 400) {
      const location = response.headers.location;
      if (!location) throw new Error('Redirect without Location header');
      currentUrl = new URL(location, currentUrl);
      continue;
    }

    return response;
  }

  throw new Error('Too many redirects');
}

function getHeadHtml(html: string): string {
  const match = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  return match ? match[1] : html.slice(0, 8192);
}

/** Reads one `<meta property="…">` or `<meta name="…">` tag's `content`, whichever comes first. */
function readMetaContent(head: string, key: string): string | undefined {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = head.match(pattern);
    if (match) return decodeHtmlEntities(match[1]);
  }
  return undefined;
}

function readTitleTag(head: string): string | undefined {
  const match = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(match[1].trim()) : undefined;
}

function readIconHref(head: string): string | undefined {
  const patterns = [/rel=["']icon["'][^>]*href=["']([^"']*)["']/i, /href=["']([^"']*)["'][^>]*rel=["']icon["']/i,
    /rel=["']shortcut icon["'][^>]*href=["']([^"']*)["']/i, /href=["']([^"']*)["'][^>]*rel=["']shortcut icon["']/i,
    /rel=["']apple-touch-icon["'][^>]*href=["']([^"']*)["']/i, /href=["']([^"']*)["'][^>]*rel=["']apple-touch-icon["']/i];
  for (const pattern of patterns) {
    const match = head.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

async function downloadFaviconAsDataUri(faviconUrl: string): Promise<string | undefined> {
  try {
    const response = await safeFetch(faviconUrl, MAX_FAVICON_BYTES);
    if (response.statusCode < 200 || response.statusCode >= 300) return undefined;

    const contentType = (response.headers['content-type'] || 'image/x-icon').split(';')[0].trim();
    return `data:${contentType};base64,${response.body.toString('base64')}`;
  } catch {
    return undefined;
  }
}

async function resolveFaviconHref(iconHref: string | undefined, pageUrl: string): Promise<string | undefined> {
  let faviconUrl: string | undefined;

  if (iconHref) {
    try { faviconUrl = new URL(iconHref, pageUrl).toString(); } catch { /* fall through to default */ }
  }
  if (!faviconUrl) {
    try { faviconUrl = `${new URL(pageUrl).origin}/favicon.ico`; } catch { return undefined; }
  }

  return downloadFaviconAsDataUri(faviconUrl);
}

export interface ParsedOpenGraphHead {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  iconHref?: string;
}

/**
 * Pure HTML-head parsing, split out from {@link fetchOpenGraphMetadata} so it can be unit-tested
 * against crafted markup without a network round-trip. Only ever looks at `<head>...</head>` (or
 * the first 8KB when there is no closing tag) - the response body itself is already capped at
 * {@link MAX_RESPONSE_BYTES}, and OG/meta tags are always in the head by spec.
 */
export function parseOpenGraphHead(html: string): ParsedOpenGraphHead {
  const head = getHeadHtml(html);

  return {
    title: readMetaContent(head, 'og:title') || readTitleTag(head) || undefined,
    description: readMetaContent(head, 'og:description') || readMetaContent(head, 'description') || undefined,
    image: readMetaContent(head, 'og:image') || undefined,
    siteName: readMetaContent(head, 'og:site_name') || undefined,
    iconHref: readIconHref(head),
  };
}

async function fetchOpenGraphMetadata(url: string): Promise<LinkEmbedMetadata> {
  const response = await safeFetch(url, MAX_RESPONSE_BYTES);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`HTTP ${response.statusCode}`);
  }

  const contentType = (response.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    throw new Error(`Unexpected Content-Type: ${contentType}`);
  }

  const parsed = parseOpenGraphHead(response.body.toString('utf8'));

  return {
    url,
    embedType: 'opengraph',
    title: parsed.title,
    description: parsed.description,
    image: parsed.image,
    siteName: parsed.siteName,
    favicon: await resolveFaviconHref(parsed.iconHref, url),
  };
}

async function fetchYouTubeMetadata(url: string, videoId: string): Promise<LinkEmbedMetadata> {
  const metadata: LinkEmbedMetadata = {
    url,
    embedType: 'youtube',
    siteName: 'YouTube',
    image: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    favicon: await downloadFaviconAsDataUri('https://www.youtube.com/favicon.ico'),
  };

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = await safeFetch(oembedUrl, MAX_RESPONSE_BYTES);
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`HTTP ${response.statusCode}`);

    const data = JSON.parse(response.body.toString('utf8')) as { title?: string; author_name?: string; thumbnail_url?: string };
    if (data.title) metadata.title = data.title;
    if (data.author_name) metadata.description = data.author_name;
    if (data.thumbnail_url) metadata.image = data.thumbnail_url;
  } catch {
    metadata.title = 'YouTube Video';
  }

  return metadata;
}

/**
 * Fetches a URL's link-preview metadata (title, description, image, favicon, siteName) through
 * a host-side request with SSRF protection - see {@link isBlockedIp}/{@link resolveValidatedAddress}
 * for the guard and {@link pinnedRequest} for why it can't be bypassed by DNS rebinding.
 *
 * Never rejects: matches the `EditorComponent.fetchLinkMetadata` contract the vendored CKEditor
 * plugin relies on (vendor/ckeditor5/src/augmentation.ts) - any failure resolves as
 * `{ unresolved: true }` with hostname-derived placeholders, so an auto-detected URL is left as
 * a plain link rather than becoming a preview that shows less than the URL itself did.
 */
export async function fetchLinkMetadata(rawUrl: string): Promise<LinkEmbedMetadata> {
  let url: URL;
  try {
    url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Only http and https URLs are supported');
    }
  } catch {
    return { url: rawUrl, embedType: 'opengraph', title: rawUrl, unresolved: true };
  }

  const videoId = extractYouTubeVideoId(url.toString());

  try {
    if (videoId) {
      return await fetchYouTubeMetadata(url.toString(), videoId);
    }
    return await fetchOpenGraphMetadata(url.toString());
  } catch {
    return {
      url: url.toString(),
      embedType: detectEmbedType(url.toString()),
      title: url.hostname,
      unresolved: true,
    };
  }
}
