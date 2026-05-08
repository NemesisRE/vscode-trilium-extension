import { strict as assert } from 'assert';
import { VirtualDocumentProvider, createVirtualDocumentUri } from '../../src/virtualDocumentProvider';
import type { EtapiClient } from '../../src/etapiClient';

describe('VirtualDocumentProvider', () => {
  it('returns placeholder content when disconnected instead of throwing', async () => {
    const provider = new VirtualDocumentProvider(() => undefined);
    const uri = createVirtualDocumentUri('note-1', 'Restored Note');

    const content = await provider.provideTextDocumentContent(uri);

    assert.ok(content.includes('Trilium is not connected.'));
    assert.ok(content.includes('note-1'));
  });

  it('returns cached content before querying client', async () => {
    let calls = 0;
    const client = {
      getNoteContent: async (_noteId: string) => {
        calls += 1;
        return '<p>server</p>';
      },
    } as unknown as EtapiClient;
    const provider = new VirtualDocumentProvider(() => client);
    const uri = createVirtualDocumentUri('note-2', 'Cached Note');

    provider.updateContent(uri, '<p>cached</p>');
    const content = await provider.provideTextDocumentContent(uri);

    assert.strictEqual(content, '<p>cached</p>');
    assert.strictEqual(calls, 0);
  });

  it('fetches note content from client and caches it when connected', async () => {
    let calls = 0;
    const client = {
      getNoteContent: async (noteId: string) => {
        calls += 1;
        return `<p>${noteId}</p>`;
      },
    } as unknown as EtapiClient;
    const provider = new VirtualDocumentProvider(() => client);
    const uri = createVirtualDocumentUri('note-3', 'Connected Note');

    const first = await provider.provideTextDocumentContent(uri);
    const second = await provider.provideTextDocumentContent(uri);

    assert.strictEqual(first, '<p>note-3</p>');
    assert.strictEqual(second, '<p>note-3</p>');
    assert.strictEqual(calls, 1);
  });

  it('throws for invalid URI with missing noteId when connected', async () => {
    const client = {
      getNoteContent: async (_noteId: string) => '<p>x</p>',
    } as unknown as EtapiClient;
    const provider = new VirtualDocumentProvider(() => client);

    await assert.rejects(
      provider.provideTextDocumentContent({
        scheme: 'trilium-text',
        authority: 'trilium',
        path: '/',
        query: '',
        fragment: '',
        toString: () => 'trilium-text://trilium/',
      } as any),
      /Invalid URI - missing noteId/,
    );
  });
});
