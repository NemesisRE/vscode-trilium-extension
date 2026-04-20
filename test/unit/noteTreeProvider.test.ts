import { strict as assert } from 'assert';
import { NoteItem, NoteTreeProvider, boxiconToCodeicon, cssColorToThemeColorId } from '../../src/noteTreeProvider';
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

  it('sets item id to noteId', () => {
    const item = new NoteItem(makeNote({ noteId: 'abc123' }));
    assert.strictEqual(item.id, 'abc123');
  });

  it('shows note type as description for non-text notes', () => {
    const item = new NoteItem(makeNote({ type: 'code' }));
    assert.strictEqual(item.description, 'code');
  });

  it('has no description for text notes', () => {
    const item = new NoteItem(makeNote({ type: 'text' }));
    assert.strictEqual(item.description, undefined);
  });

  it('attaches an open command to leaf notes', () => {
    const item = new NoteItem(makeNote({ childNoteIds: [] }));
    assert.ok(item.command, 'leaf note should have a command');
    assert.strictEqual((item.command as { command: string }).command, 'trilium.openNote');
  });

  it('attaches openInBrowser command to leaf external notes', () => {
    const item = new NoteItem(makeNote({ type: 'book', childNoteIds: [] }));
    assert.ok(item.command, 'leaf external note should have a command');
    assert.strictEqual((item.command as { command: string }).command, 'trilium.openInBrowser');
  });

  it('attaches downloadFile command to leaf file notes', () => {
    const item = new NoteItem(makeNote({ type: 'file', childNoteIds: [] }));
    assert.ok(item.command, 'leaf file note should have a command');
    assert.strictEqual((item.command as { command: string }).command, 'trilium.downloadFile');
  });

  it('attaches downloadFile command to leaf image notes', () => {
    const item = new NoteItem(makeNote({ type: 'image', childNoteIds: [] }));
    assert.ok(item.command, 'leaf image note should have a command');
    assert.strictEqual((item.command as { command: string }).command, 'trilium.downloadFile');
  });

  it('does not attach a command to collapsible notes', () => {
    const item = new NoteItem(makeNote({ childNoteIds: ['child1'] }));
    assert.strictEqual(item.command, undefined);
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
    assert.strictEqual((item.iconPath as { id: string }).id, 'file-text');
  });

  it('uses the mapped codicon when #iconClass attribute is present', () => {
    const attr: Attribute = {
      attributeId: 'a1', noteId: 'testId', type: 'label', name: 'iconClass',
      value: 'bx bx-home', position: 0, isInheritable: false,
    };
    const item = new NoteItem(makeNote({ attributes: [attr] }));
    assert.strictEqual((item.iconPath as { id: string }).id, 'home');
  });

  it('falls back to type icon when #iconClass maps to an unknown boxicon', () => {
    const attr: Attribute = {
      attributeId: 'a1', noteId: 'testId', type: 'label', name: 'iconClass',
      value: 'bx bx-totally-unknown-icon', position: 0, isInheritable: false,
    };
    const item = new NoteItem(makeNote({ type: 'code', attributes: [attr] }));
    assert.strictEqual((item.iconPath as { id: string }).id, 'file-code');
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

  it('loads children of the root note when called with no element', async () => {
    const root = makeNote({ noteId: 'root', childNoteIds: ['c1', 'c2'] });
    const child1 = makeNote({ noteId: 'c1', title: 'Child One' });
    const child2 = makeNote({ noteId: 'c2', title: 'Child Two' });

    const provider = new NoteTreeProvider(makeClient({ root, c1: child1, c2: child2 }));
    const children = await provider.getChildren();

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
});
