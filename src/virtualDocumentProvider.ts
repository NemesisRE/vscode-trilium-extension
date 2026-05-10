import * as vscode from 'vscode';
import { EtapiClient } from './etapiClient';

/**
 * TextDocumentContentProvider for virtual trilium-text:// URIs.
 *
 * This provider creates virtual documents for Trilium text notes that can be
 * opened with the custom CKEditor provider without creating temp files.
 *
 * URI format: trilium-text://trilium/noteId?title=Note+Title
 */
export class VirtualDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this._onDidChange.event;

  // Cache of note content by URI
  private readonly contentCache = new Map<string, string>();

  constructor(private readonly getClient: () => EtapiClient | undefined) {}

  private static getNoteIdFromUri(uri: vscode.Uri): string | undefined {
    const query = new URLSearchParams(uri.query);
    const fromQuery = query.get('noteId');
    if (fromQuery) {
      return fromQuery;
    }

    // Some legacy URIs were serialized with the full query encoded into one key.
    // Try decoding once and parsing again to recover noteId.
    if (uri.query.includes('%3D') || uri.query.includes('%26')) {
      try {
        const decodedQuery = decodeURIComponent(uri.query);
        const decoded = new URLSearchParams(decodedQuery);
        const decodedNoteId = decoded.get('noteId');
        if (decodedNoteId) {
          return decodedNoteId;
        }
      } catch {
        // Fall through to path fallback.
      }
    }

    const fromPath = uri.path.substring(1);
    return fromPath || undefined;
  }

  private disconnectedPlaceholder(noteId: string): string {
    return [
      '<p><strong>Trilium is not connected.</strong></p>',
      `<p>This restored editor tab (noteId: <code>${noteId}</code>) will load automatically after you reconnect.</p>`,
    ].join('');
  }

  /**
   * Provide the initial content for a virtual document.
   * Content is fetched from Trilium via ETAPI.
   */
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const cached = this.contentCache.get(uri.toString());
    if (cached !== undefined) {
      return cached;
    }

    const client = this.getClient();
    if (!client) {
      const noteId = VirtualDocumentProvider.getNoteIdFromUri(uri);
      return this.disconnectedPlaceholder(noteId || 'unknown');
    }

    const noteId = VirtualDocumentProvider.getNoteIdFromUri(uri);
    if (!noteId) {
      throw new Error('Trilium: Invalid URI - missing noteId.');
    }

    try {
      const content = await client.getNoteContent(noteId);
      this.contentCache.set(uri.toString(), content);
      return content;
    } catch (err) {
      throw new Error(`Trilium: Failed to fetch note content: ${err}`);
    }
  }

  /**
   * Update the cached content for a URI and notify VS Code.
   * This allows external changes to be reflected in the editor.
   */
  updateContent(uri: vscode.Uri, content: string): void {
    this.contentCache.set(uri.toString(), content);
    this._onDidChange.fire(uri);
  }

  /**
   * Clear cached content for a URI.
   */
  clearCache(uri: vscode.Uri): void {
    this.contentCache.delete(uri.toString());
  }

  /**
   * Clear all cached content.
   */
  clearAllCache(): void {
    this.contentCache.clear();
  }
}

/**
 * Create a virtual document URI for a Trilium text note.
 *
 * @param noteId - The Trilium note ID
 * @param title - The note title (for display in editor tab)
 * @returns A trilium-text:// URI
 */
export function createVirtualDocumentUri(noteId: string, title: string): vscode.Uri {
  const safeTitle = (title || noteId).trim() || noteId;
  const query = new URLSearchParams({
    noteId,
    title: safeTitle,
  }).toString();

  // Use title-like path segment for better tab labels while keeping noteId in query.
  return vscode.Uri.from({
    scheme: 'trilium-text',
    authority: 'trilium',
    path: `/${safeTitle}`,
    query,
  });
}
