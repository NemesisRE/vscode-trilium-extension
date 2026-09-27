import { strict as assert } from 'assert';
import * as http from 'http';
import { fetchLinkMetadata, isBlockedIp, parseOpenGraphHead } from '../../src/linkMetadataFetch';

describe('linkMetadataFetch', () => {
  describe('isBlockedIp', () => {
    it('blocks IPv4 loopback, private and link-local ranges', () => {
      for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.5', '172.31.255.255', '192.168.1.1',
        '169.254.169.254', '0.0.0.0', '100.64.0.1', '192.0.0.1', '198.18.0.1', '224.0.0.1', '240.0.0.1']) {
        assert.equal(isBlockedIp(ip), true, `expected ${ip} to be blocked`);
      }
    });

    it('allows public IPv4 addresses', () => {
      for (const ip of ['93.184.216.34', '8.8.8.8', '1.1.1.1']) {
        assert.equal(isBlockedIp(ip), false, `expected ${ip} to be allowed`);
      }
    });

    it('blocks IPv6 loopback, unique-local and link-local ranges', () => {
      for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1']) {
        assert.equal(isBlockedIp(ip), true, `expected ${ip} to be blocked`);
      }
    });

    it('blocks an IPv4-mapped IPv6 address whose embedded IPv4 is private', () => {
      assert.equal(isBlockedIp('::ffff:127.0.0.1'), true);
      assert.equal(isBlockedIp('::ffff:10.0.0.1'), true);
    });

    it('allows a public IPv6 address', () => {
      assert.equal(isBlockedIp('2606:4700:4700::1111'), false);
    });
  });

  describe('fetchLinkMetadata SSRF guard', () => {
    it('never connects to a loopback IP literal, even with a listening server there', async () => {
      const server = http.createServer((_req, res) => {
        res.end('should never be reached');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as { port: number }).port;

      try {
        const metadata = await fetchLinkMetadata(`http://127.0.0.1:${port}/`);
        assert.equal(metadata.unresolved, true);
      } finally {
        server.close();
      }
    });

    it('blocks a non-standard numeric hostname that resolves to a loopback address', async function () {
      this.timeout(10000);
      const metadata = await fetchLinkMetadata('http://2130706433/');
      assert.equal(metadata.unresolved, true);
    });

    it('rejects non-http(s) schemes without throwing', async () => {
      const metadata = await fetchLinkMetadata('file:///etc/passwd');
      assert.equal(metadata.unresolved, true);
    });
  });

  describe('parseOpenGraphHead', () => {
    it('prefers og: tags over their plain fallbacks', () => {
      const html = `<html><head>
        <title>Fallback Title</title>
        <meta name="description" content="Fallback description">
        <meta property="og:title" content="OG Title">
        <meta property="og:description" content="OG description">
        <meta property="og:image" content="https://example.com/image.png">
        <meta property="og:site_name" content="Example Site">
        <link rel="icon" href="/favicon.png">
      </head><body></body></html>`;

      const parsed = parseOpenGraphHead(html);
      assert.equal(parsed.title, 'OG Title');
      assert.equal(parsed.description, 'OG description');
      assert.equal(parsed.image, 'https://example.com/image.png');
      assert.equal(parsed.siteName, 'Example Site');
      assert.equal(parsed.iconHref, '/favicon.png');
    });

    it('falls back to <title> and the plain description meta when no og: tags exist', () => {
      const html = '<html><head><title>Plain Title</title><meta name="description" content="Plain description"></head></html>';

      const parsed = parseOpenGraphHead(html);
      assert.equal(parsed.title, 'Plain Title');
      assert.equal(parsed.description, 'Plain description');
      assert.equal(parsed.image, undefined);
    });

    it('decodes HTML entities in extracted text', () => {
      const html = '<html><head><meta property="og:title" content="Fish &amp; Chips &mdash; caf&#39;e"></head></html>';
      assert.equal(parseOpenGraphHead(html).title, "Fish & Chips &mdash; caf'e");
    });

    it('falls back to shortcut icon or apple-touch-icon when rel="icon" is absent', () => {
      const html = '<html><head><link rel="apple-touch-icon" href="/apple-icon.png"></head></html>';
      assert.equal(parseOpenGraphHead(html).iconHref, '/apple-icon.png');
    });

    it('returns nothing when the page has no head metadata at all', () => {
      const parsed = parseOpenGraphHead('<html><body><p>No metadata here.</p></body></html>');
      assert.equal(parsed.title, undefined);
      assert.equal(parsed.image, undefined);
      assert.equal(parsed.iconHref, undefined);
    });
  });
});
