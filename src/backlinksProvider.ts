import * as vscode from 'vscode';
import { EtapiClient, Note } from './etapiClient';

interface BacklinkItem extends vscode.TreeItem {
  noteId: string;
}

/**
 * Displays notes that link to the currently viewed note via relations.
 * This is a lightweight implementation that shows relation-based backlinks.
 */
export class BacklinksProvider implements vscode.TreeDataProvider<BacklinkItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<BacklinkItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private backlinks: BacklinkItem[] = [];
  private currentNoteId: string | null = null;

  constructor(private readonly getClient: () => EtapiClient | undefined) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: BacklinkItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: BacklinkItem): Promise<BacklinkItem[]> {
    if (element) {
      return [];
    }

    if (!this.currentNoteId) {
      return [];
    }

    return this.backlinks;
  }

  async updateBacklinks(noteId: string): Promise<void> {
    this.currentNoteId = noteId;
    this.backlinks = [];

    const client = this.getClient();
    if (!client) {
      this.refresh();
      return;
    }

    try {
      await client.getNote(noteId);

      // Get all notes that have relations pointing to this note
      // We search for notes with targetRelationCount > 0, then filter client-side
      const { results } = await client.searchNotes(`note.targetRelationCount > 0`, {
        limit: 100,
      });

      // Filter to notes that actually have a relation pointing to current noteId
      const backlinkPromises = results.map(async (n) => {
        try {
          const fullNote = await client.getNote(n.noteId);
          const pointsToCurrentNote = fullNote.attributes?.some(
            (attr) => attr.type === 'relation' && attr.value === noteId,
          ) ?? false;
          return pointsToCurrentNote ? fullNote : null;
        } catch {
          return null;
        }
      });

      const backlinkNotes = (await Promise.all(backlinkPromises)).filter(
        (n) => n !== null,
      ) as Note[];

      this.backlinks = backlinkNotes
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((n) => {
          const item = new vscode.TreeItem(
            n.title,
            vscode.TreeItemCollapsibleState.None,
          ) as BacklinkItem;
          item.noteId = n.noteId;
          item.command = {
            title: 'Open Note',
            command: 'trilium.openNoteById',
            arguments: [n.noteId],
          };
          item.iconPath = new vscode.ThemeIcon('link');
          item.tooltip = `Links to this note via relation`;
          return item;
        });

      this.refresh();
    } catch (error) {
      // Silently fail if backlinks cannot be loaded
      this.backlinks = [];
      this.refresh();
    }
  }

  getBacklinkCount(): number {
    return this.backlinks.length;
  }
}
