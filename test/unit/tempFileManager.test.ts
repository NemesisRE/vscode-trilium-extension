import { strict as assert } from 'assert';
import * as os from 'os';
import * as path from 'path';
import { TempFileManager } from '../../src/tempFileManager';
import type { Note } from '../../src/etapiClient';

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    noteId: 'note123',
    title: 'My Note',
    type: 'text',
    mime: 'text/html',
    isProtected: false,
    blobId: 'blobId',
    childNoteIds: [],
    parentNoteIds: ['root'],
    childBranchIds: [],
    parentBranchIds: [],
    dateCreated: '2024-01-01 00:00:00+0000',
    dateModified: '2024-01-01 00:00:00+0000',
    utcDateCreated: '2024-01-01T00:00:00Z',
    utcDateModified: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('TempFileManager', () => {
  let manager: TempFileManager;

  beforeEach(() => {
    manager = new TempFileManager();
  });

  afterEach(() => {
    manager.cleanup();
  });

  describe('getTempPath', () => {
    it('returns a .md path for text notes', () => {
      const p = manager.getTempPath(makeNote({ type: 'text' }));
      assert.ok(p.endsWith('.md'), `Expected .md extension, got: ${p}`);
    });

    it('returns a .mmd path for mermaid notes', () => {
      const p = manager.getTempPath(makeNote({ type: 'mermaid' }));
      assert.ok(p.endsWith('.mmd'), `Expected .mmd extension, got: ${p}`);
    });

    it('returns a .excalidraw path for canvas notes', () => {
      const p = manager.getTempPath(makeNote({ type: 'canvas' }));
      assert.ok(p.endsWith('.excalidraw'), `Expected .excalidraw extension, got: ${p}`);
    });

    it('returns a .md path for mindMap notes', () => {
      const p = manager.getTempPath(makeNote({ type: 'mindMap' }));
      assert.ok(p.endsWith('.md'), `Expected .md extension, got: ${p}`);
    });

    it('returns a .js path for javascript code notes', () => {
      const p = manager.getTempPath(makeNote({ type: 'code', mime: 'text/javascript' }));
      assert.ok(p.endsWith('.js'), `Expected .js extension, got: ${p}`);
    });

    it('returns the same path on subsequent calls for the same note', () => {
      const note = makeNote();
      assert.strictEqual(manager.getTempPath(note), manager.getTempPath(note));
    });

    it('includes the noteId in the filename', () => {
      const p = manager.getTempPath(makeNote({ noteId: 'abc99' }));
      assert.ok(path.basename(p).includes('abc99'));
    });

    it('places the file inside os.tmpdir()/vscode-trilium', () => {
      const p = manager.getTempPath(makeNote());
      const expected = path.join(os.tmpdir(), 'vscode-trilium');
      assert.ok(p.startsWith(expected));
    });
  });

  describe('getNoteIdForPath', () => {
    it('returns the noteId for a registered path', () => {
      const note = makeNote({ noteId: 'xyz42' });
      const p = manager.getTempPath(note);
      assert.strictEqual(manager.getNoteIdForPath(p), 'xyz42');
    });

    it('returns undefined for an unregistered path', () => {
      assert.strictEqual(manager.getNoteIdForPath('/tmp/unknown.md'), undefined);
    });

    it('matches regardless of drive-letter casing on Windows', () => {
      const note = makeNote({ noteId: 'caseTest' });
      const p = manager.getTempPath(note);
      // Flip the case of the first character (drive letter on Windows, or just a char on Unix)
      const flipped = p[0] === p[0].toUpperCase()
        ? p[0].toLowerCase() + p.slice(1)
        : p[0].toUpperCase() + p.slice(1);
      assert.strictEqual(manager.getNoteIdForPath(flipped), 'caseTest');
    });
  });

  describe('getLanguageId', () => {
    it('returns markdown for text notes', () => {
      assert.strictEqual(manager.getLanguageId(makeNote({ type: 'text' })), 'markdown');
    });

    it('returns mermaid for mermaid notes', () => {
      assert.strictEqual(manager.getLanguageId(makeNote({ type: 'mermaid' })), 'mermaid');
    });

    it('returns json for canvas notes', () => {
      assert.strictEqual(manager.getLanguageId(makeNote({ type: 'canvas' })), 'json');
    });

    it('returns markdown for mindMap notes', () => {
      assert.strictEqual(manager.getLanguageId(makeNote({ type: 'mindMap' })), 'markdown');
    });

    it('returns python for text/x-python code notes', () => {
      assert.strictEqual(
        manager.getLanguageId(makeNote({ type: 'code', mime: 'text/x-python' })),
        'python',
      );
    });

    it('returns plaintext for unknown mimes', () => {
      assert.strictEqual(
        manager.getLanguageId(makeNote({ type: 'code', mime: 'application/x-unknown' })),
        'plaintext',
      );
    });
  });

  describe('isTextNote', () => {
    it('returns true for a text note after getTempPath', () => {
      const note = makeNote({ noteId: 'tn1', type: 'text' });
      manager.getTempPath(note);
      assert.strictEqual(manager.isTextNote('tn1'), true);
    });

    it('returns false for a code note', () => {
      const note = makeNote({ noteId: 'cn1', type: 'code', mime: 'text/javascript' });
      manager.getTempPath(note);
      assert.strictEqual(manager.isTextNote('cn1'), false);
    });

    it('returns false for an unknown noteId', () => {
      assert.strictEqual(manager.isTextNote('does-not-exist'), false);
    });
  });

  describe('isMindMapNote', () => {
    it('returns true for a mindMap note after getTempPath', () => {
      const note = makeNote({ noteId: 'mm1', type: 'mindMap' });
      manager.getTempPath(note);
      assert.strictEqual(manager.isMindMapNote('mm1'), true);
    });

    it('returns false for a text note', () => {
      const note = makeNote({ noteId: 'tx1', type: 'text' });
      manager.getTempPath(note);
      assert.strictEqual(manager.isMindMapNote('tx1'), false);
    });

    it('returns false for an unknown noteId', () => {
      assert.strictEqual(manager.isMindMapNote('does-not-exist'), false);
    });
  });

  describe('getHtmlTempPath', () => {
    it('returns a .html path', () => {
      const p = manager.getHtmlTempPath(makeNote({ noteId: 'html1' }));
      assert.ok(p.endsWith('.html'), `Expected .html extension, got: ${p}`);
    });

    it('includes the noteId in the filename', () => {
      const p = manager.getHtmlTempPath(makeNote({ noteId: 'myHtmlNote' }));
      assert.ok(path.basename(p).includes('myHtmlNote'));
    });

    it('is tracked for save-back (getNoteIdForPath returns the source noteId)', () => {
      const note = makeNote({ noteId: 'rawHtml1' });
      const p = manager.getHtmlTempPath(note);
      assert.strictEqual(manager.getNoteIdForPath(p), 'rawHtml1');
    });

    it('is recognized as an HTML temp path', () => {
      const note = makeNote({ noteId: 'rawHtml2' });
      const p = manager.getHtmlTempPath(note);
      assert.strictEqual(manager.isHtmlTempPath(p), true);
    });
  });

  describe('htmlToMarkdown', () => {
    it('converts a simple paragraph', () => {
      const md = manager.htmlToMarkdown('<p>Hello world</p>');
      assert.strictEqual(md.trim(), 'Hello world');
    });

    it('converts headings', () => {
      const md = manager.htmlToMarkdown('<h1>Title</h1>');
      assert.ok(md.trim().startsWith('# Title'));
    });

    it('converts bold text', () => {
      const md = manager.htmlToMarkdown('<strong>bold</strong>');
      assert.ok(md.includes('**bold**'));
    });

    it('converts unordered lists', () => {
      const md = manager.htmlToMarkdown('<ul><li>one</li><li>two</li></ul>');
      assert.ok(md.includes('*   one') || md.includes('- one') || md.includes('*  one'));
      assert.ok(md.includes('two'));
    });
  });

  describe('markdownToHtml', () => {
    it('converts a paragraph', () => {
      const html = manager.markdownToHtml('Hello world');
      assert.ok(html.includes('<p>Hello world</p>'));
    });

    it('converts a heading', () => {
      const html = manager.markdownToHtml('# Title');
      assert.ok(html.includes('<h1>Title</h1>'));
    });

    it('converts bold text', () => {
      const html = manager.markdownToHtml('**bold**');
      assert.ok(html.includes('<strong>bold</strong>'));
    });

    it('round-trips content through HTML→MD→HTML without data loss', () => {
      const original = '<p>Some <strong>important</strong> content</p>';
      const md = manager.htmlToMarkdown(original);
      const back = manager.markdownToHtml(md);
      // The round-trip may add a newline; the key is the content is preserved
      assert.ok(back.includes('important'));
      assert.ok(back.includes('strong'));
    });
  });

  describe('mindMapJsonToMarkdown', () => {
    it('converts a root node to a level-1 heading', () => {
      const json = JSON.stringify({ nodeData: { id: 'root', topic: 'Root', children: [] } });
      const md = manager.mindMapJsonToMarkdown(json);
      assert.ok(md.includes('# Root'), `Expected "# Root" in: ${md}`);
    });

    it('converts children to deeper headings', () => {
      const json = JSON.stringify({
        nodeData: {
          id: 'root', topic: 'Root',
          children: [
            { id: 'c1', topic: 'Child', children: [
              { id: 'c2', topic: 'Grandchild', children: [] }
            ] }
          ],
        },
      });
      const md = manager.mindMapJsonToMarkdown(json);
      assert.ok(md.includes('## Child'), `Expected "## Child" in: ${md}`);
      assert.ok(md.includes('### Grandchild'), `Expected "### Grandchild" in: ${md}`);
    });

    it('falls back to "# Mind Map" for invalid JSON', () => {
      const md = manager.mindMapJsonToMarkdown('not json');
      assert.strictEqual(md, '# Mind Map\n');
    });
  });

  describe('markdownToMindMapJson', () => {
    it('converts a level-1 heading to the root node topic', () => {
      const data = JSON.parse(manager.markdownToMindMapJson('# My Root\n'));
      assert.strictEqual(data.nodeData.topic, 'My Root');
    });

    it('converts nested headings to child nodes', () => {
      const md = '# Root\n## Child\n### Grandchild\n';
      const data = JSON.parse(manager.markdownToMindMapJson(md));
      assert.strictEqual(data.nodeData.children[0].topic, 'Child');
      assert.strictEqual(data.nodeData.children[0].children[0].topic, 'Grandchild');
    });

    it('round-trips topics through JSON→MD→JSON', () => {
      const original = JSON.stringify({
        nodeData: {
          id: 'root', topic: 'Project',
          children: [
            { id: 'a1', topic: 'Area 1', children: [] },
            { id: 'a2', topic: 'Area 2', children: [] },
          ],
        },
      });
      const md = manager.mindMapJsonToMarkdown(original);
      const back = JSON.parse(manager.markdownToMindMapJson(md));
      assert.strictEqual(back.nodeData.topic, 'Project');
      assert.strictEqual(back.nodeData.children[0].topic, 'Area 1');
      assert.strictEqual(back.nodeData.children[1].topic, 'Area 2');
    });
  });
});

