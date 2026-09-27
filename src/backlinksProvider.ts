import * as vscode from 'vscode';
import { EtapiClient } from './etapiClient';

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
  private _logger: ((msg: string) => void) | undefined;

  constructor(private readonly getClient: () => EtapiClient | undefined) {}

  setLogger(fn: (msg: string) => void): void {
    this._logger = fn;
  }

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

      // Get all notes that have relations pointing to this note. ETAPI's search
      // results already include each note's full `attributes` array (same mapper
      // as a direct getNote() call), so no per-result re-fetch is needed here -
      // we search broadly for note.targetRelationCount > 0 (Trilium's search
      // syntax has no "any relation, any name, pointing at X" predicate) and then
      // filter client-side using the attributes already on hand.
      const { results } = await client.searchNotes(`note.targetRelationCount > 0`, {
        limit: 100,
      });

      const backlinkNotes = results.filter((n) =>
        n.attributes?.some((attr) => attr.type === 'relation' && attr.value === noteId) ?? false,
      );

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
      this._logger?.(`Failed to load backlinks for ${noteId}: ${error}`);
      this.backlinks = [];
      this.refresh();
    }
  }

  getBacklinkCount(): number {
    return this.backlinks.length;
  }
}
