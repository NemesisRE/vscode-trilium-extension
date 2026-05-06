import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { strict as assert } from 'assert';
import {
  NoteItem,
  NoteTreeDecorationProvider,
  NoteTreeProvider,
  boxiconToCodeicon,
  cssColorToThemeColorId,
  noteTypeToLabel,
  parseBoxiconClass,
  preferredCodiconForNote,
} from '../../src/noteTreeProvider';
import type { Note, Attribute } from '../../src/etapiClient';
import type { EtapiClient } from '../../src/etapiClient';

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    noteId: 'testId',
    title: 'Test Note',
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

function makeClient(notes: Record<string, Note>): EtapiClient {
  return {
    getNote: async (id: string) => {
      const note = notes[id];
      if (!note) {
        throw new Error(`Note not found: ${id}`);
      }
      return note;
    },
    // Unused methods stubbed to satisfy the type.
    getAppInfo: async () => ({ appVersion: '', dbVersion: 0, syncVersion: 0, buildDate: '', buildRevision: '', dataDirectory: '', utcDateTime: '' }),
    patchNote: async () => makeNote(),
    getNoteContent: async () => '',
    putNoteContent: async () => undefined,
  } as unknown as EtapiClient;
}

describe('NoteItem', () => {
  it('has None collapsible state for leaf notes', () => {
    const item = new NoteItem(makeNote({ childNoteIds: [] }));
    // TreeItemCollapsibleState.None = 0 (from vscode stub)
    assert.strictEqual(item.collapsibleState, 0);
  });

  it('has Collapsed state for notes with children', () => {
    const item = new NoteItem(makeNote({ childNoteIds: ['c1', 'c2'] }));
    // TreeItemCollapsibleState.Collapsed = 1 (from vscode stub)
    assert.strictEqual(item.collapsibleState, 1);
  });

  it('uses the note title as the label', () => {
    const item = new NoteItem(makeNote({ title: 'My Important Note' }));
    assert.strictEqual(item.label, 'My Important Note');
  });

  it('sets item id to path when branch is not provided', () => {
    const item = new NoteItem(makeNote({ noteId: 'abc123' }));
    assert.strictEqual(item.id, 'abc123');
  });

  it('sets item id to noteId@branchId for cloned locations', () => {
    const item = new NoteItem(makeNote({ noteId: 'abc123' }), 'root/abc123', 'branch-9');
    assert.strictEqual(item.id, 'abc123@branch-9');
  });

  it('shows note type as description for non-text notes', () => {
    const item = new NoteItem(makeNote({ type: 'code' }));
    assert.strictEqual(item.description, 'code');
  });

  it('has no description for text notes', () => {
    const item = new NoteItem(makeNote({ type: 'text' }));
    assert.strictEqual(item.description, undefined);
  });

  it('shows protected marker in description for protected notes', () => {
    const item = new NoteItem(makeNote({ type: 'text', isProtected: true }));
    assert.strictEqual(item.description, 'protected');
  });

  it('attaches an open command to notes', () => {
    const item = new NoteItem(makeNote({ childNoteIds: [] }));
    assert.ok(item.command, 'note should have a command');
    assert.strictEqual((item.command as { command: string }).command, 'trilium.openNote');
  });

  it('attaches openInBrowser command to leaf external notes', () => {
    const item = new NoteItem(makeNote({ type: 'book', childNoteIds: [] }));
    assert.ok(item.command, 'leaf external note should have a command');
    assert.strictEqual((item.command as { command: string }).command, 'trilium.openInBrowser');
  });

  it('attaches openFile command to file notes', () => {
    const item = new NoteItem(makeNote({ type: 'file', childNoteIds: [] }));
    assert.ok(item.command, 'file note should have a command');
    assert.strictEqual((item.command as { command: string }).command, 'trilium.openFile');
  });

  it('attaches openFile command to image notes', () => {
    const item = new NoteItem(makeNote({ type: 'image', childNoteIds: [] }));
    assert.ok(item.command, 'image note should have a command');
    assert.strictEqual((item.command as { command: string }).command, 'trilium.openFile');
  });

  it('attaches a command to collapsible section notes', () => {
    const item = new NoteItem(makeNote({ childNoteIds: ['child1'] }));
    assert.ok(item.command, 'collapsible note should have a command');
    assert.strictEqual((item.command as { command: string }).command, 'trilium.openNote');
  });

  it('contextValue is noteText for text notes', () => {
    assert.strictEqual(new NoteItem(makeNote({ type: 'text' })).contextValue, 'noteText');
  });

  it('contextValue is noteCode for code notes', () => {
    assert.strictEqual(new NoteItem(makeNote({ type: 'code' })).contextValue, 'noteCode');
  });

  it('contextValue is noteCode for mermaid notes', () => {
    assert.strictEqual(new NoteItem(makeNote({ type: 'mermaid' })).contextValue, 'noteCode');
  });

  it('contextValue is noteCode for canvas notes', () => {
    assert.strictEqual(new NoteItem(makeNote({ type: 'canvas' })).contextValue, 'noteCode');
  });

  it('contextValue is noteCode for mindMap notes', () => {
    assert.strictEqual(new NoteItem(makeNote({ type: 'mindMap' })).contextValue, 'noteCode');
  });

  it('contextValue is noteFile for file notes', () => {
    assert.strictEqual(new NoteItem(makeNote({ type: 'file' })).contextValue, 'noteFile');
  });

  it('contextValue is noteFile for image notes', () => {
    assert.strictEqual(new NoteItem(makeNote({ type: 'image' })).contextValue, 'noteFile');
  });

  it('contextValue is noteExternal for non-editable non-file note types', () => {
    for (const type of ['book', 'noteMap', 'doc', 'contentWidget', 'webView'] as const) {
      assert.strictEqual(
        new NoteItem(makeNote({ type })).contextValue,
        'noteExternal',
        `expected noteExternal for type ${type}`,
      );
    }
  });

  it('uses the type-default icon when no #iconClass attribute is present', () => {
    const item = new NoteItem(makeNote({ type: 'text' }));
    // iconPath is a ThemeIcon from the stub
    assert.ok(item.iconPath);
    assert.strictEqual((item.iconPath as { id: string }).id, 'note');
  });

  it('uses folder icon for section text notes (default Trilium behavior)', () => {
    const item = new NoteItem(makeNote({ type: 'text', childNoteIds: ['c1'] }));
    assert.ok(item.iconPath);
    assert.strictEqual((item.iconPath as { id: string }).id, 'folder');
  });

  it('uses home icon for the root note default', () => {
    const item = new NoteItem(makeNote({ noteId: 'root', type: 'text' }));
    assert.ok(item.iconPath);
    assert.strictEqual((item.iconPath as { id: string }).id, 'home');
  });

  it('uses share icon for the _share note default', () => {
    const item = new NoteItem(makeNote({ noteId: '_share', type: 'text' }));
    assert.ok(item.iconPath);
    assert.strictEqual((item.iconPath as { id: string }).id, 'share');
  });

  it('uses PDF-specific default icon for file notes', () => {
    const item = new NoteItem(makeNote({ type: 'file', mime: 'application/pdf' }));
    assert.ok(item.iconPath);
    assert.strictEqual((item.iconPath as { id: string }).id, 'file');
  });

  it('uses archive-specific default icon for compressed file notes', () => {
    const item = new NoteItem(makeNote({ type: 'file', mime: 'application/zip' }));
    assert.ok(item.iconPath);
    assert.strictEqual((item.iconPath as { id: string }).id, 'archive');
  });

  it('uses video default icon for video file notes', () => {
    const item = new NoteItem(makeNote({ type: 'file', mime: 'video/mp4' }));
    assert.ok(item.iconPath);
    assert.strictEqual((item.iconPath as { id: string }).id, 'device-camera-video');
  });

  it('uses audio default icon for audio file notes', () => {
    const item = new NoteItem(makeNote({ type: 'file', mime: 'audio/mpeg' }));
    assert.ok(item.iconPath);
    assert.strictEqual((item.iconPath as { id: string }).id, 'unmute');
  });

  it('uses image MIME specific default for image notes', () => {
    const item = new NoteItem(makeNote({ type: 'image', mime: 'image/png' }));
    assert.ok(item.iconPath);
    assert.strictEqual((item.iconPath as { id: string }).id, 'file-media');
  });

  it('uses the mapped codicon when #iconClass attribute is present', () => {
    const attr: Attribute = {
      attributeId: 'a1', noteId: 'testId', type: 'label', name: 'iconClass',
      value: 'bx bx-home', position: 0, isInheritable: false,
    };
    const item = new NoteItem(makeNote({ attributes: [attr] }));
    assert.strictEqual((item.iconPath as { id: string }).id, 'home');
  });

  it('uses a themed Boxicon SVG when icon assets are available', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trilium-boxicons-test-'));
    const boxiconsRoot = path.join(tempRoot, 'svg');
    const regularDir = path.join(boxiconsRoot, 'regular');
    fs.mkdirSync(regularDir, { recursive: true });
    fs.writeFileSync(
      path.join(regularDir, 'bx-home.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h10v10H0z"/></svg>',
      'utf8',
    );

    const iconAttr: Attribute = {
      attributeId: 'a1', noteId: 'testId', type: 'label', name: 'iconClass',
      value: 'bx bx-home', position: 0, isInheritable: false,
    };
    const colorAttr: Attribute = {
      attributeId: 'a2', noteId: 'testId', type: 'label', name: 'color',
      value: 'red', position: 1, isInheritable: false,
    };

    const item = new NoteItem(makeNote({ attributes: [iconAttr, colorAttr] }), 'testId', undefined, boxiconsRoot);
    const uri = item.iconPath as { scheme?: string; path?: string };
    assert.strictEqual(uri.scheme, 'file');
    assert.ok(uri.path, 'expected a file path for themed boxicon');

    const themedSvg = fs.readFileSync(uri.path as string, 'utf8');
    assert.ok(themedSvg.includes('fill="red"'));

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('falls back to type icon when #iconClass maps to an unknown boxicon', () => {
    const attr: Attribute = {
      attributeId: 'a1', noteId: 'testId', type: 'label', name: 'iconClass',
      value: 'bx bx-totally-unknown-icon', position: 0, isInheritable: false,
    };
    const item = new NoteItem(makeNote({ type: 'code', attributes: [attr] }));
    assert.strictEqual((item.iconPath as { id: string }).id, 'file-code');
  });

  it('tints ThemeIcon when #color maps to a theme color', () => {
    const attr: Attribute = {
      attributeId: 'a2', noteId: 'testId', type: 'label', name: 'color',
      value: 'red', position: 0, isInheritable: false,
    };
    const item = new NoteItem(makeNote({ attributes: [attr] }));
    assert.strictEqual((item.iconPath as { id: string }).id, 'note');
    assert.strictEqual((item.iconPath as { color?: { id: string } }).color?.id, 'charts.red');
  });

  it('does not tint ThemeIcon when #color is achromatic', () => {
    const attr: Attribute = {
      attributeId: 'a4', noteId: 'testId', type: 'label', name: 'color',
      value: '#808080', position: 0, isInheritable: false,
    };
    const item = new NoteItem(makeNote({ attributes: [attr] }));
    assert.strictEqual((item.iconPath as { color?: { id: string } }).color, undefined);
  });

  it('sets resourceUri with color query when #color attribute is a named color', () => {
    const attr: Attribute = {
      attributeId: 'a2', noteId: 'testId', type: 'label', name: 'color',
      value: 'red', position: 0, isInheritable: false,
    };
    const item = new NoteItem(makeNote({ attributes: [attr] }));
    assert.ok(item.resourceUri, 'resourceUri should be set for a color attribute');
    assert.strictEqual((item.resourceUri as { scheme: string }).scheme, 'trilium-note');
    assert.ok((item.resourceUri as { query: string }).query.includes('charts.red'));
  });

  it('sets resourceUri with color query when #color is a hex value', () => {
    const attr: Attribute = {
      attributeId: 'a3', noteId: 'testId', type: 'label', name: 'color',
      value: '#1e91bf', position: 0, isInheritable: false,
    };
    const item = new NoteItem(makeNote({ attributes: [attr] }));
    assert.ok(item.resourceUri);
    assert.ok((item.resourceUri as { query: string }).query.includes('charts.blue'));
  });

  it('does not set resourceUri when #color is achromatic (gray/white)', () => {
    const attr: Attribute = {
      attributeId: 'a4', noteId: 'testId', type: 'label', name: 'color',
      value: '#808080', position: 0, isInheritable: false,
    };
    const item = new NoteItem(makeNote({ attributes: [attr] }));
    assert.strictEqual(item.resourceUri, undefined);
  });

  it('sets resourceUri when note is protected', () => {
    const item = new NoteItem(makeNote({ isProtected: true }));
    assert.ok(item.resourceUri, 'resourceUri should be set for protected note');
    assert.ok((item.resourceUri as { query: string }).query.includes('protected=1'));
  });
});

describe('NoteTreeDecorationProvider', () => {
  it('returns protected badge decoration', () => {
    const provider = new NoteTreeDecorationProvider();
    const uri = { scheme: 'trilium-note', query: 'protected=1' } as unknown as import('vscode').Uri;
    const decoration = provider.provideFileDecoration(uri);
    assert.ok(decoration);
    assert.strictEqual(decoration?.badge, 'L');
    assert.strictEqual(decoration?.tooltip, 'Protected note');
  });

  it('returns color-only decoration when only color is provided', () => {
    const provider = new NoteTreeDecorationProvider();
    const uri = { scheme: 'trilium-note', query: 'color=charts.red' } as unknown as import('vscode').Uri;
    const decoration = provider.provideFileDecoration(uri);
    assert.ok(decoration);
    assert.strictEqual(decoration?.badge, undefined);
    assert.ok(decoration?.color);
  });
});

describe('boxiconToCodeicon', () => {
  it('maps "bx bx-home" to "home"', () => {
    assert.strictEqual(boxiconToCodeicon('bx bx-home'), 'home');
  });

  it('maps solid variant "bx bxs-star" to "star"', () => {
    assert.strictEqual(boxiconToCodeicon('bx bxs-star'), 'star');
  });

  it('maps "bx bx-calendar" to "calendar"', () => {
    assert.strictEqual(boxiconToCodeicon('bx bx-calendar'), 'calendar');
  });

  it('returns undefined for unknown icon names', () => {
    assert.strictEqual(boxiconToCodeicon('bx bx-totally-unknown'), undefined);
  });

  it('returns undefined for non-boxicon class strings', () => {
    assert.strictEqual(boxiconToCodeicon('fa fa-home'), undefined);
  });
});

describe('parseBoxiconClass', () => {
  it('parses regular boxicon classes', () => {
    const parsed = parseBoxiconClass('bx bx-home');
    assert.ok(parsed);
    assert.strictEqual(parsed?.style, 'regular');
    assert.strictEqual(parsed?.fileName, 'bx-home.svg');
    assert.strictEqual(parsed?.iconName, 'home');
  });

  it('parses solid boxicon classes', () => {
    const parsed = parseBoxiconClass('bx bxs-lock');
    assert.ok(parsed);
    assert.strictEqual(parsed?.style, 'solid');
    assert.strictEqual(parsed?.fileName, 'bxs-lock.svg');
    assert.strictEqual(parsed?.iconName, 'lock');
  });

  it('parses logo boxicon classes', () => {
    const parsed = parseBoxiconClass('bx bxl-github');
    assert.ok(parsed);
    assert.strictEqual(parsed?.style, 'logos');
    assert.strictEqual(parsed?.fileName, 'bxl-github.svg');
    assert.strictEqual(parsed?.iconName, 'github');
  });

  it('returns undefined for icon classes without an icon token', () => {
    assert.strictEqual(parseBoxiconClass('bx'), undefined);
  });
});

describe('noteTypeToLabel', () => {
  it('formats camel-case note types for presentation', () => {
    assert.strictEqual(noteTypeToLabel('mindMap'), 'mind map');
    assert.strictEqual(noteTypeToLabel('webView'), 'web view');
    assert.strictEqual(noteTypeToLabel('relationMap'), 'relation map');
  });

  it('keeps simple lowercase types unchanged', () => {
    assert.strictEqual(noteTypeToLabel('code'), 'code');
    assert.strictEqual(noteTypeToLabel('text'), 'text');
  });
});

describe('preferredCodiconForNote', () => {
  it('prefers iconClass mapping over default type icon', () => {
    const note = makeNote({
      type: 'book',
      attributes: [{
        attributeId: 'a1',
        noteId: 'testId',
        type: 'label',
        name: 'iconClass',
        value: 'bx bx-home',
        position: 0,
        isInheritable: false,
      }],
    });
    assert.strictEqual(preferredCodiconForNote(note), 'home');
  });

  it('falls back to type icon when iconClass is not mapped', () => {
    const note = makeNote({
      type: 'book',
      attributes: [{
        attributeId: 'a1',
        noteId: 'testId',
        type: 'label',
        name: 'iconClass',
        value: 'bx bx-not-real',
        position: 0,
        isInheritable: false,
      }],
    });
    assert.strictEqual(preferredCodiconForNote(note), 'book');
  });
});

describe('cssColorToThemeColorId', () => {
  it('maps named color "red" to "charts.red"', () => {
    assert.strictEqual(cssColorToThemeColorId('red'), 'charts.red');
  });

  it('maps named color "blue" to "charts.blue"', () => {
    assert.strictEqual(cssColorToThemeColorId('blue'), 'charts.blue');
  });

  it('maps named color "green" to "charts.green"', () => {
    assert.strictEqual(cssColorToThemeColorId('green'), 'charts.green');
  });

  it('maps named color "purple" to "charts.purple"', () => {
    assert.strictEqual(cssColorToThemeColorId('purple'), 'charts.purple');
  });

  it('maps a pure-red hex color to "charts.red"', () => {
    assert.strictEqual(cssColorToThemeColorId('#ff0000'), 'charts.red');
  });

  it('maps a blue hex color to "charts.blue"', () => {
    assert.strictEqual(cssColorToThemeColorId('#1e91bf'), 'charts.blue');
  });

  it('maps an orange hex to "charts.orange"', () => {
    assert.strictEqual(cssColorToThemeColorId('#ff8c00'), 'charts.orange');
  });

  it('maps a yellow hex to "charts.yellow"', () => {
    assert.strictEqual(cssColorToThemeColorId('#ffee00'), 'charts.yellow');
  });

  it('maps a green hex to "charts.green"', () => {
    assert.strictEqual(cssColorToThemeColorId('#36b030'), 'charts.green');
  });

  it('maps a purple hex to "charts.purple"', () => {
    assert.strictEqual(cssColorToThemeColorId('#8000ff'), 'charts.purple');
  });

  it('maps shorthand 3-digit hex', () => {
    assert.strictEqual(cssColorToThemeColorId('#f00'), 'charts.red');
  });

  it('maps rgb() color', () => {
    assert.strictEqual(cssColorToThemeColorId('rgb(255, 0, 0)'), 'charts.red');
  });

  it('returns undefined for gray (achromatic)', () => {
    assert.strictEqual(cssColorToThemeColorId('#808080'), undefined);
  });

  it('returns undefined for white', () => {
    assert.strictEqual(cssColorToThemeColorId('#ffffff'), undefined);
  });

  it('returns undefined for unrecognized strings', () => {
    assert.strictEqual(cssColorToThemeColorId('notacolor'), undefined);
  });
});

describe('NoteTreeProvider', () => {
  it('returns empty array when no client is set', async () => {
    const provider = new NoteTreeProvider();
    const children = await provider.getChildren();
    assert.deepStrictEqual(children, []);
  });

  it('loads the root note when called with no element and expands it by default', async () => {
    const root = makeNote({ noteId: 'root', childNoteIds: ['c1', 'c2'] });
    const child1 = makeNote({ noteId: 'c1', title: 'Child One' });
    const child2 = makeNote({ noteId: 'c2', title: 'Child Two' });

    const provider = new NoteTreeProvider(makeClient({ root, c1: child1, c2: child2 }));
    const topLevel = await provider.getChildren();

    assert.strictEqual(topLevel.length, 1);
    assert.strictEqual(topLevel[0].note.noteId, 'root');
    assert.strictEqual(topLevel[0].collapsibleState, 2);

    const children = await provider.getChildren(topLevel[0]);
    assert.strictEqual(children.length, 2);
    assert.strictEqual(children[0].note.noteId, 'c1');
    assert.strictEqual(children[1].note.noteId, 'c2');
  });

  it('loads children of a given NoteItem element', async () => {
    const parent = makeNote({ noteId: 'parent', childNoteIds: ['kid1'] });
    const kid = makeNote({ noteId: 'kid1', title: 'Kid' });

    const provider = new NoteTreeProvider(makeClient({ parent, kid1: kid }));
    const parentItem = new NoteItem(parent);
    const children = await provider.getChildren(parentItem);

    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0].note.title, 'Kid');
  });

  it('returns empty array for leaf notes', async () => {
    const leaf = makeNote({ noteId: 'leaf', childNoteIds: [] });

    const provider = new NoteTreeProvider(makeClient({ leaf }));
    const leafItem = new NoteItem(leaf);
    const children = await provider.getChildren(leafItem);

    assert.deepStrictEqual(children, []);
  });

  it('exposes the client via getClient', () => {
    const client = makeClient({});
    const provider = new NoteTreeProvider(client);
    assert.strictEqual(provider.getClient(), client);
  });

  it('updates the client and fires a tree refresh when setClient is called', () => {
    const provider = new NoteTreeProvider();
    let fired = false;
    provider.onDidChangeTreeData(() => { fired = true; });

    const client = makeClient({});
    provider.setClient(client);

    assert.strictEqual(provider.getClient(), client);
    assert.ok(fired, 'onDidChangeTreeData should have fired');
  });

  it('moves a note to a different parent on drop', async () => {
    const calls: string[] = [];
    const client = {
      createBranch: async (noteId: string, parentNoteId: string) => {
        calls.push(`create:${noteId}:${parentNoteId}`);
        return { branchId: 'newb', noteId, parentNoteId };
      },
      deleteBranch: async (branchId: string) => {
        calls.push(`delete:${branchId}`);
      },
      refreshNoteOrdering: async (parentNoteId: string) => {
        calls.push(`refresh:${parentNoteId}`);
      },
    } as unknown as EtapiClient;

    const provider = new NoteTreeProvider(client);
    const target = new NoteItem(makeNote({ noteId: 'parentB', childNoteIds: ['childX'] }), 'root/parentB', 'branch-parentB');
    const payload = [{ noteId: 'childA', path: 'root/parentA/childA', branchId: 'branch-childA' }];
    const transfer = {
      get: (mime: string) => mime === 'application/vnd.code.tree.triliumnotetree'
        ? { value: payload, asString: async () => JSON.stringify(payload) }
        : undefined,
    } as unknown as import('vscode').DataTransfer;

    await provider.handleDrop(target, transfer);

    assert.ok(calls.includes('create:childA:parentB'));
    assert.ok(calls.includes('delete:branch-childA'));
    assert.ok(calls.includes('refresh:parentA'));
    assert.ok(calls.includes('refresh:parentB'));
  });

  it('does not move when dropped onto same parent', async () => {
    const calls: string[] = [];
    const client = {
      createBranch: async () => { calls.push('create'); return { branchId: 'new' }; },
      deleteBranch: async () => { calls.push('delete'); },
      refreshNoteOrdering: async () => { calls.push('refresh'); },
    } as unknown as EtapiClient;

    const provider = new NoteTreeProvider(client);
    const target = new NoteItem(makeNote({ noteId: 'parentA' }), 'root/parentA', 'branch-parentA');
    const payload = [{ noteId: 'childA', path: 'root/parentA/childA', branchId: 'branch-childA' }];
    const transfer = {
      get: (mime: string) => mime === 'application/vnd.code.tree.triliumnotetree'
        ? { value: payload, asString: async () => JSON.stringify(payload) }
        : undefined,
    } as unknown as import('vscode').DataTransfer;

    await provider.handleDrop(target, transfer);

    assert.deepStrictEqual(calls, []);
  });

  it('does not move when dropping a parent onto its own descendant', async () => {
    const calls: string[] = [];
    const client = {
      createBranch: async () => { calls.push('create'); return { branchId: 'new' }; },
      deleteBranch: async () => { calls.push('delete'); },
      refreshNoteOrdering: async () => { calls.push('refresh'); },
    } as unknown as EtapiClient;

    const provider = new NoteTreeProvider(client);
    const target = new NoteItem(makeNote({ noteId: 'childA' }), 'root/parentA/childA', 'branch-childA');
    const payload = [{ noteId: 'parentA', path: 'root/parentA', branchId: 'branch-parentA' }];
    const transfer = {
      get: (mime: string) => mime === 'application/vnd.code.tree.triliumnotetree'
        ? { value: payload, asString: async () => JSON.stringify(payload) }
        : undefined,
    } as unknown as import('vscode').DataTransfer;

    await provider.handleDrop(target, transfer);

    assert.deepStrictEqual(calls, []);
  });
});
