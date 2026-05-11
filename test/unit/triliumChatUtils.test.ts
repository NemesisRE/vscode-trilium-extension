import { strict as assert } from 'assert';
import { EtapiClient, Note } from '../../src/etapiClient';
import {
  buildNoteContext,
  formatNoteContextForLm,
  stripHtmlForLm,
} from '../../src/triliumChatUtils';

function makeNote(overrides: Partial<Note> & Pick<Note, 'noteId' | 'title'>): Note {
  return {
    noteId: overrides.noteId,
    title: overrides.title,
    type: overrides.type ?? 'text',
    mime: overrides.mime ?? 'text/html',
    isProtected: overrides.isProtected ?? false,
    blobId: overrides.blobId ?? '',
    childNoteIds: overrides.childNoteIds ?? [],
    parentNoteIds: overrides.parentNoteIds ?? [],
    childBranchIds: overrides.childBranchIds ?? [],
    parentBranchIds: overrides.parentBranchIds ?? [],
    dateCreated: overrides.dateCreated ?? '2026-01-01 00:00:00+0000',
    dateModified: overrides.dateModified ?? '2026-01-01 00:00:00+0000',
    utcDateCreated: overrides.utcDateCreated ?? '2026-01-01T00:00:00Z',
    utcDateModified: overrides.utcDateModified ?? '2026-01-01T00:00:00Z',
    attributes: overrides.attributes,
  };
}

describe('triliumChatUtils', () => {
  it('strips script, style, and HTML markup for LM-safe plain text', () => {
    const raw = '<style>.x{color:red}</style><script>alert(1)</script><h1>Hello</h1><p>World &amp; friends</p>';
    assert.strictEqual(stripHtmlForLm(raw), 'Hello World & friends');
  });

  it('builds note context with ancestor path, attributes, and limited children', async () => {
    const notes = new Map<string, Note>([
      ['root', makeNote({ noteId: 'root', title: 'Root', childNoteIds: ['homelab'], childBranchIds: ['b1'] })],
      ['homelab', makeNote({
        noteId: 'homelab',
        title: 'Homelab',
        parentNoteIds: ['root'],
        childNoteIds: ['gpu', 'llm'],
        childBranchIds: ['b2', 'b3'],
        attributes: [
          {
            attributeId: 'a1',
            noteId: 'homelab',
            type: 'label',
            name: 'section',
            value: 'infra',
            position: 10,
            isInheritable: true,
          },
        ],
      })],
      ['gpu', makeNote({ noteId: 'gpu', title: 'GPU Hosts', parentNoteIds: ['homelab'] })],
      ['llm', makeNote({ noteId: 'llm', title: 'Local LLMs', parentNoteIds: ['homelab'] })],
    ]);

    const client = {
      async getNote(noteId: string): Promise<Note> {
        const note = notes.get(noteId);
        if (!note) {
          throw new Error(`Missing note ${noteId}`);
        }
        return note;
      },
    } as unknown as EtapiClient;

    const context = await buildNoteContext(client, 'homelab', 1);

    assert.deepEqual(context.pathTitles, ['Root', 'Homelab']);
    assert.deepEqual(context.pathNoteIds, ['root', 'homelab']);
    assert.strictEqual(context.children.length, 1);
    assert.strictEqual(context.children[0].noteId, 'gpu');
    assert.strictEqual(context.hasMoreChildren, true);

    const formatted = formatNoteContextForLm(context);
    assert.match(formatted, /Path: Root \/ Homelab/);
    assert.match(formatted, /label:section = infra \(inheritable\)/);
    assert.match(formatted, /GPU Hosts/);
    assert.match(formatted, /more child note\(s\)/);
  });
});
