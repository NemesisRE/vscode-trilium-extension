import * as vscode from 'vscode';

export interface DraftNoteEntry {
  noteId: string;
  sessionId: string;
  parentNoteId: string;
  title: string;
  type: 'text';
  uri: vscode.Uri;
  serverContent: string;
  localContent: string;
}

export interface DraftSession {
  sessionId: string;
  parentNoteId: string;
  parentTitle: string;
  noteIds: string[];
}

export class DraftNoteManager {
  private readonly draftsByNoteId = new Map<string, DraftNoteEntry>();
  private readonly sessionsById = new Map<string, DraftSession>();

  createSession(parentNoteId: string, parentTitle: string): DraftSession {
    const session: DraftSession = {
      sessionId: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      parentNoteId,
      parentTitle,
      noteIds: [],
    };
    this.sessionsById.set(session.sessionId, session);
    return session;
  }

  registerDraft(entry: DraftNoteEntry): void {
    this.draftsByNoteId.set(entry.noteId, entry);
    const session = this.sessionsById.get(entry.sessionId);
    if (session && !session.noteIds.includes(entry.noteId)) {
      session.noteIds.push(entry.noteId);
    }
  }

  isDraft(noteId: string): boolean {
    return this.draftsByNoteId.has(noteId);
  }

  getDraft(noteId: string): DraftNoteEntry | undefined {
    return this.draftsByNoteId.get(noteId);
  }

  updateDraftContent(noteId: string, content: string): void {
    const entry = this.draftsByNoteId.get(noteId);
    if (!entry) {
      return;
    }
    entry.localContent = content;
  }

  getSession(sessionId: string): DraftSession | undefined {
    return this.sessionsById.get(sessionId);
  }

  listSessionDrafts(sessionId: string): DraftNoteEntry[] {
    const session = this.sessionsById.get(sessionId);
    if (!session) {
      return [];
    }
    return session.noteIds
      .map((noteId) => this.draftsByNoteId.get(noteId))
      .filter((entry): entry is DraftNoteEntry => !!entry);
  }

  removeDraft(noteId: string): void {
    const entry = this.draftsByNoteId.get(noteId);
    if (!entry) {
      return;
    }

    this.draftsByNoteId.delete(noteId);
    const session = this.sessionsById.get(entry.sessionId);
    if (!session) {
      return;
    }

    session.noteIds = session.noteIds.filter((id) => id !== noteId);
    if (session.noteIds.length === 0) {
      this.sessionsById.delete(entry.sessionId);
    }
  }

  removeSession(sessionId: string): void {
    const session = this.sessionsById.get(sessionId);
    if (!session) {
      return;
    }

    for (const noteId of session.noteIds) {
      this.draftsByNoteId.delete(noteId);
    }
    this.sessionsById.delete(sessionId);
  }
}
