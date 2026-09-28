import { strict as assert } from 'assert';
import { mediaEmbedProviders } from '../../src/ckeditor/mediaEmbedFacade';

function provider(name: string) {
  const found = mediaEmbedProviders.find((p) => p.name === name);
  assert.ok(found, `expected a "${name}" provider`);
  return found;
}

function match(pattern: RegExp, url: string): RegExpMatchArray & { input: string } {
  const result = url.match(pattern);
  assert.ok(result, `expected ${pattern} to match "${url}"`);
  return result as RegExpMatchArray & { input: string };
}

describe('mediaEmbedFacade', () => {
  it('carries over every default provider name unchanged', () => {
    const names = mediaEmbedProviders.map((p) => p.name);
    assert.deepEqual(names, ['dailymotion', 'spotify', 'youtube', 'vimeo', 'instagram', 'twitter', 'googleMaps', 'flickr', 'facebook']);
  });

  it('leaves the five non-preview providers without an html renderer', () => {
    for (const name of ['instagram', 'twitter', 'googleMaps', 'flickr', 'facebook']) {
      assert.equal('html' in provider(name), false, `expected "${name}" to have no html renderer`);
    }
  });

  describe('youtube', () => {
    const youtube = provider('youtube');

    it('renders a facade with the real thumbnail, not a live iframe', () => {
      const m = match((youtube.url as RegExp[])[0], 'youtube.com/watch?v=dQw4w9WgXcQ');
      const html = youtube.html!(m);
      assert.equal(html.includes('<iframe'), false);
      assert.match(html, /class="link-embed-video-facade"/);
      assert.match(html, /href="https:\/\/youtube\.com\/watch\?v=dQw4w9WgXcQ"/);
      assert.match(html, /src="https:\/\/img\.youtube\.com\/vi\/dQw4w9WgXcQ\/hqdefault\.jpg"/);
      assert.match(html, /target="_blank"/);
      // Without this, CKEditor's own widget system swallows the click as a "select this widget"
      // gesture instead of letting the anchor navigate - see the comment above videoFacadeHtml().
      assert.match(html, /data-cke-ignore-events="true"/);
    });

    it('reconstructs the external URL whether the match kept its protocol or not', () => {
      const withProtocol = match((youtube.url as RegExp[])[0], 'https://www.youtube.com/watch?v=abc'.replace('https://www.', ''));
      assert.match(youtube.html!(withProtocol), /href="https:\/\/youtube\.com\/watch\?v=abc"/);
    });
  });

  describe('providers with no public thumbnail (vimeo, dailymotion, spotify)', () => {
    it('render a facade with no <img>, just the play button', () => {
      const vimeo = provider('vimeo');
      const m = match((vimeo.url as RegExp[])[0], 'vimeo.com/12345');
      const html = vimeo.html!(m);
      assert.equal(html.includes('<iframe'), false);
      assert.equal(html.includes('<img'), false);
      assert.match(html, /class="link-embed-video-facade"/);
      assert.match(html, /href="https:\/\/vimeo\.com\/12345"/);
      assert.match(html, /data-cke-ignore-events="true"/);
    });
  });

  it('HTML-escapes the reconstructed URL used as an href attribute', () => {
    const youtube = provider('youtube');
    // A crafted match.input containing a double quote must not break out of the href attribute.
    const m = ['youtube.com/watch?v=x"onmouseover="alert(1)', 'x"onmouseover="alert(1)'] as unknown as RegExpMatchArray & { input: string };
    m.input = 'youtube.com/watch?v=x"onmouseover="alert(1)';
    const html = youtube.html!(m);
    assert.equal(html.includes('"onmouseover="'), false);
  });
});
