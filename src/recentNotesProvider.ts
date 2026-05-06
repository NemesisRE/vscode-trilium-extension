import * as vscode from 'vscode';
import { Note } from './etapiClient';
import { NoteItem } from './noteTreeProvider';

const GLOBAL_STATE_KEY = 'trilium.recentNotes';

interface StoredNote {
  noteId: string;
  title: string;
  type: Note['type'];
  mime: string;
  isProtected: boolean;
  attributes: Note['attributes'];
}

export class RecentNotesProvider implements vscode.TreeDataProvider<NoteItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly boxiconsSvgRoot?: string,
  ) {}

  trackNote(note: Note): void {
    const maxCount = vscode.workspace
      .getConfiguration('trilium')
      .get<number>('recentNotesMaxCount', 10);
    const stored = this.getStored();
    const entry: StoredNote = {
      noteId: note.noteId,
      title: note.title,
      type: note.type,
      mime: note.mime,
      isProtected: note.isProtected,
      attributes: note.attributes ?? [],
    };
    const filtered = stored.filter((e) => e.noteId !== note.noteId);
    const updated = [entry, ...filtered].slice(0, maxCount);
    void this.context.globalState.update(GLOBAL_STATE_KEY, updated);
    this._onDidChangeTreeData.fire();
  }

  clear(): void {
    void this.context.globalState.update(GLOBAL_STATE_KEY, []);
    this._onDidChangeTreeData.fire();
  }

  private getStored(): StoredNote[] {
    return this.context.globalState.get<StoredNote[]>(GLOBAL_STATE_KEY, []);
  }

  getTreeItem(element: NoteItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: NoteItem): NoteItem[] {
    if (element !== undefined) {
      return [];
    }
    return this.getStored().map((entry) => {
      const syntheticNote: Note = {
        noteId: entry.noteId,
        title: entry.title,
        type: entry.type,
        mime: entry.mime,
        isProtected: entry.isProtected,
        blobId: '',
        childNoteIds: [],
        parentNoteIds: [],
        childBranchIds: [],
        parentBranchIds: [],
        dateCreated: '',
        dateModified: '',
        utcDateCreated: '',
        utcDateModified: '',
        attributes: entry.attributes ?? [],
      };
      return new NoteItem(syntheticNote, entry.noteId, undefined, this.boxiconsSvgRoot);
    });
  }
}
