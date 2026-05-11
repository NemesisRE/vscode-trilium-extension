const PROTECTED_SESSION_HINT = 'Unlock it in Trilium first (Options → Protected Session).';

export function protectedNoteWarningMessage(noteTitle?: string): string {
  if (noteTitle && noteTitle.trim()) {
    return `Trilium: "${noteTitle}" is a protected note. ${PROTECTED_SESSION_HINT}`;
  }
  return `Trilium: Note is protected. ${PROTECTED_SESSION_HINT}`;
}

export function protectedNoteToolError(noteId: string, operation: 'read' | 'modified'): string {
  return `Error: Note "${noteId}" is protected and cannot be ${operation}. ${PROTECTED_SESSION_HINT}`;
}
