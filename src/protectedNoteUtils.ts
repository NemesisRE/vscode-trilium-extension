import * as vscode from 'vscode';

const PROTECTED_SESSION_HINT = 'Unlock it in Trilium first (Options → Protected Session).';

export function protectedNoteWarningMessage(noteTitle?: string): string {
  const hint = vscode.l10n.t(PROTECTED_SESSION_HINT);
  if (noteTitle && noteTitle.trim()) {
    return vscode.l10n.t('Trilium: "{0}" is a protected note. {1}', noteTitle, hint);
  }
  return vscode.l10n.t('Trilium: Note is protected. {0}', hint);
}

export function protectedNoteToolError(noteId: string, operation: 'read' | 'modified'): string {
  return `Error: Note "${noteId}" is protected and cannot be ${operation}. ${PROTECTED_SESSION_HINT}`;
}
