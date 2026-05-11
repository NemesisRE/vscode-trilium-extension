import { strict as assert } from 'assert';
import { protectedNoteToolError, protectedNoteWarningMessage } from '../../src/protectedNoteUtils';

describe('protectedNoteUtils', () => {
  it('builds a title-aware protected note warning', () => {
    assert.strictEqual(
      protectedNoteWarningMessage('Daily Journal'),
      'Trilium: "Daily Journal" is a protected note. Unlock it in Trilium first (Options → Protected Session).',
    );
  });

  it('builds a generic protected note warning when title is missing', () => {
    assert.strictEqual(
      protectedNoteWarningMessage(),
      'Trilium: Note is protected. Unlock it in Trilium first (Options → Protected Session).',
    );
  });

  it('builds a protected read tool error with unlock guidance', () => {
    assert.strictEqual(
      protectedNoteToolError('abc123', 'read'),
      'Error: Note "abc123" is protected and cannot be read. Unlock it in Trilium first (Options → Protected Session).',
    );
  });

  it('builds a protected modify tool error with unlock guidance', () => {
    assert.strictEqual(
      protectedNoteToolError('abc123', 'modified'),
      'Error: Note "abc123" is protected and cannot be modified. Unlock it in Trilium first (Options → Protected Session).',
    );
  });
});
