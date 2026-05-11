import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import { DraftNoteManager } from '../../src/draftNoteManager';

describe('DraftNoteManager', () => {
  it('tracks drafts by session and note id', () => {
    const manager = new DraftNoteManager();
    const session = manager.createSession('parent1', 'Homelab');
    const uri = vscode.Uri.file('/tmp/draft-a.trilium-text');

    manager.registerDraft({
      noteId: 'noteA',
      sessionId: session.sessionId,
      parentNoteId: 'parent1',
      title: 'Local AI Overview',
      type: 'text',
      uri,
      serverContent: '<p></p>',
      localContent: '<h1>Overview</h1>',
    });

    assert.strictEqual(manager.isDraft('noteA'), true);
    assert.strictEqual(manager.getDraft('noteA')?.title, 'Local AI Overview');
    assert.deepEqual(manager.getSession(session.sessionId)?.noteIds, ['noteA']);
    assert.strictEqual(manager.listSessionDrafts(session.sessionId).length, 1);
  });

  it('updates content and removes empty sessions automatically', () => {
    const manager = new DraftNoteManager();
    const session = manager.createSession('parent1', 'Homelab');

    manager.registerDraft({
      noteId: 'noteA',
      sessionId: session.sessionId,
      parentNoteId: 'parent1',
      title: 'Local AI Overview',
      type: 'text',
      uri: vscode.Uri.file('/tmp/draft-a.trilium-text'),
      serverContent: '<p></p>',
      localContent: '<h1>Overview</h1>',
    });

    manager.updateDraftContent('noteA', '<p>Updated</p>');
    assert.strictEqual(manager.getDraft('noteA')?.localContent, '<p>Updated</p>');

    manager.removeDraft('noteA');
    assert.strictEqual(manager.isDraft('noteA'), false);
    assert.strictEqual(manager.getSession(session.sessionId), undefined);
  });
});
