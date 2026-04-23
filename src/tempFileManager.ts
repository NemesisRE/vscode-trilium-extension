import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import TurndownService from 'turndown';
import { marked } from 'marked';
import { Note } from './etapiClient';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

/**
 * Maps Trilium MIME types to VS Code language identifiers.
 * Language IDs are the internal identifiers used by VS Code's language services.
 */
const MIME_TO_LANGUAGE_ID: ReadonlyMap<string, string> = new Map([
  ['text/html', 'html'],
  ['text/javascript', 'javascript'],
  ['application/javascript', 'javascript'],
  ['text/typescript', 'typescript'],
  ['application/typescript', 'typescript'],
  ['text/x-python', 'python'],
  ['text/markdown', 'markdown'],
  ['text/css', 'css'],
  ['application/json', 'json'],
  ['text/xml', 'xml'],
  ['application/xml', 'xml'],
  ['text/x-c', 'c'],
  ['text/x-c++', 'cpp'],
  ['text/x-java', 'java'],
  ['text/x-ruby', 'ruby'],
  ['text/x-sh', 'shellscript'],
  ['text/x-sql', 'sql'],
  ['text/x-kotlin', 'kotlin'],
  ['text/x-go', 'go'],
  ['text/x-rust', 'rust'],
  ['text/x-yaml', 'yaml'],
  ['application/x-yaml', 'yaml'],
]);

const MIME_TO_EXT: ReadonlyMap<string, string> = new Map([
  ['text/html', '.html'],
  ['text/javascript', '.js'],
  ['application/javascript', '.js'],
  ['text/typescript', '.ts'],
  ['application/typescript', '.ts'],
  ['text/x-python', '.py'],
  ['text/markdown', '.md'],
  ['text/css', '.css'],
  ['application/json', '.json'],
  ['text/xml', '.xml'],
  ['application/xml', '.xml'],
  ['text/x-c', '.c'],
  ['text/x-c++', '.cpp'],
  ['text/x-java', '.java'],
  ['text/x-ruby', '.rb'],
  ['text/x-sh', '.sh'],
  ['text/x-sql', '.sql'],
  ['text/x-kotlin', '.kt'],
  ['text/x-go', '.go'],
  ['text/x-rust', '.rs'],
  ['text/x-yaml', '.yaml'],
  ['application/x-yaml', '.yaml'],
]);

interface MindElixirNode {
  id: string;
  topic: string;
  children?: MindElixirNode[];
  [key: string]: unknown;
}

/**
 * Manages temporary files used to surface Trilium note content in VS Code's
 * native text editor. Files live in os.tmpdir()/vscode-trilium/ and are
 * cleaned up on extension deactivation.
 */
export class TempFileManager {
  private readonly tempDir: string;
  private readonly noteIdByPath = new Map<string, string>();
  private readonly pathByNoteId = new Map<string, string>();
  private readonly noteTypeByNoteId = new Map<string, string>();
  private readonly htmlTempPaths = new Set<string>();
  private readonly textEditorPathByNoteId = new Map<string, string>();
  private readonly textEditorNoteIdByPath = new Map<string, string>();

  constructor() {
    this.tempDir = path.join(os.tmpdir(), 'vscode-trilium');
    fs.mkdirSync(this.tempDir, { recursive: true });
    // Suppress markdownlint (and markdownlint-cli2) for all temp files.
    // The extension traverses upward from each file to find ignore/config files,
    // so placing one here disables linting for everything in this directory.
    fs.writeFileSync(path.join(this.tempDir, '.markdownlintignore'), '**\n', 'utf8');
  }

  /** Normalize to lowercase so Windows drive-letter casing never mismatches. */
  private normalize(p: string): string {
    return p.toLowerCase();
  }

  /**
   * Returns the temp file path for a given note, creating the mapping if it
   * does not already exist.
   * Text notes use .md so they open with VS Code's built-in Markdown support.
   */
  getTempPath(note: Note): string {
    const existing = this.pathByNoteId.get(note.noteId);
    if (existing) {
      return existing;
    }

    let ext: string;
    if (note.type === 'text') {
      ext = '.md';
    } else if (note.type === 'mermaid') {
      ext = '.mmd';
    } else if (note.type === 'canvas') {
      ext = '.excalidraw';
    } else if (note.type === 'mindMap') {
      ext = '.md';
    } else {
      ext = MIME_TO_EXT.get(note.mime) ?? '.txt';
    }

    const safeName = note.title.replace(/[^a-zA-Z0-9_\-.]/g, '_').slice(0, 40);
    const filePath = path.join(this.tempDir, `${safeName}-${note.noteId}${ext}`);

    this.noteIdByPath.set(this.normalize(filePath), note.noteId);
    this.pathByNoteId.set(note.noteId, filePath);
    this.noteTypeByNoteId.set(note.noteId, note.type);
    return filePath;
  }

  getNoteIdForPath(filePath: string): string | undefined {
    return this.noteIdByPath.get(this.normalize(filePath));
  }

  getLanguageId(note: Note): string {
    if (note.type === 'text' || note.type === 'mindMap') { return 'markdown'; }
    if (note.type === 'mermaid') { return 'mermaid'; }
    if (note.type === 'canvas') { return 'json'; }
    return MIME_TO_LANGUAGE_ID.get(note.mime) ?? 'plaintext';
  }

  /**
   * Returns true when the note with the given path is a 'text' note
   * (i.e. content is stored as HTML and must be converted via Markdown).
   */
  isTextNote(noteId: string): boolean {
    return this.noteTypeByNoteId.get(noteId) === 'text';
  }

  isMindMapNote(noteId: string): boolean {
    return this.noteTypeByNoteId.get(noteId) === 'mindMap';
  }

  /**
   * Returns a temp file path for viewing raw HTML content.
   * This path is intentionally NOT registered in the noteId map so saves
   * to this file do not sync back to Trilium.
   */
  getHtmlTempPath(note: Note): string {
    const safeName = note.title.replace(/[^a-zA-Z0-9_\-.]/g, '_').slice(0, 40);
    const filePath = path.join(this.tempDir, `${safeName}-${note.noteId}-raw.html`);
    this.htmlTempPaths.add(this.normalize(filePath));
    return filePath;
  }

  /**
   * Returns a dedicated temp file path for the CKEditor custom text editor.
   * These files are tracked for cleanup but intentionally excluded from the
   * Markdown round-trip save pipeline.
   */
  getTextEditorTempPath(note: Note): string {
    const existing = this.textEditorPathByNoteId.get(note.noteId);
    if (existing) {
      return existing;
    }
    const safeName = note.title.replace(/[^a-zA-Z0-9_\-.]/g, '_').slice(0, 40);
    const filePath = path.join(this.tempDir, `${safeName}-${note.noteId}-editor.html`);
    const normalized = this.normalize(filePath);
    this.textEditorPathByNoteId.set(note.noteId, filePath);
    this.textEditorNoteIdByPath.set(normalized, note.noteId);
    return filePath;
  }

  isTextEditorTempPath(filePath: string): boolean {
    return this.textEditorNoteIdByPath.has(this.normalize(filePath));
  }

  removeTextEditorTempFile(noteId: string): string | undefined {
    const filePath = this.textEditorPathByNoteId.get(noteId);
    if (!filePath) {
      return undefined;
    }
    try {
      fs.unlinkSync(filePath);
    } catch {
      // best-effort
    }
    const normalized = this.normalize(filePath);
    this.textEditorPathByNoteId.delete(noteId);
    this.textEditorNoteIdByPath.delete(normalized);
    return filePath;
  }

  /** Returns true when a path is managed by this temp manager. */
  isManagedTempPath(filePath: string): boolean {
    const normalized = this.normalize(filePath);
    return this.noteIdByPath.has(normalized)
      || this.htmlTempPaths.has(normalized)
      || this.textEditorNoteIdByPath.has(normalized);
  }

  /**
   * Remove a managed temp file by path (tracked note files and raw HTML files).
   * Returns true if the path belonged to this manager.
   */
  removeTempFileByPath(filePath: string): boolean {
    const normalized = this.normalize(filePath);

    const noteId = this.noteIdByPath.get(normalized);
    if (noteId) {
      this.removeTempFile(noteId);
      return true;
    }

    if (this.htmlTempPaths.has(normalized)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // best-effort
      }
      this.htmlTempPaths.delete(normalized);
      return true;
    }

    const textEditorNoteId = this.textEditorNoteIdByPath.get(normalized);
    if (textEditorNoteId) {
      this.removeTextEditorTempFile(textEditorNoteId);
      return true;
    }

    return false;
  }

  /**
   * Convert MindElixir JSON (Trilium mindMap note content) to a Markdown
   * heading hierarchy compatible with the mark-elixir VS Code extension.
   */
  mindMapJsonToMarkdown(json: string): string {
    try {
      const data = JSON.parse(json) as { nodeData?: MindElixirNode };
      if (!data?.nodeData) {
        return '# Mind Map\n';
      }
      const lines: string[] = [];
      const traverse = (node: MindElixirNode, depth: number): void => {
        lines.push(`${'#'.repeat(depth)} ${node.topic ?? ''}`);
        for (const child of (node.children ?? [])) {
          traverse(child, depth + 1);
        }
      };
      traverse(data.nodeData, 1);
      return lines.join('\n') + '\n';
    } catch {
      return '# Mind Map\n';
    }
  }

  /**
   * Convert a Markdown heading hierarchy back to MindElixir JSON for saving
   * to Trilium. Node IDs are regenerated on each save; structural content
   * (topics and hierarchy) is fully preserved.
   */
  markdownToMindMapJson(md: string): string {
    const lines = md.split('\n');
    let rootNode: MindElixirNode | null = null;
    const stack: Array<{ node: MindElixirNode; depth: number }> = [];

    for (const line of lines) {
      const match = /^(#+)\s+(.+)/.exec(line);
      if (!match) { continue; }
      const depth = match[1].length;
      const topic = match[2].trim();
      const node: MindElixirNode = {
        id: Math.random().toString(36).slice(2, 10),
        topic,
        children: [],
      };

      if (!rootNode || depth === 1) {
        node.id = 'root';
        rootNode = node;
        stack.length = 0;
        stack.push({ node, depth });
      } else {
        while (stack.length > 1 && stack[stack.length - 1].depth >= depth) {
          stack.pop();
        }
        (stack[stack.length - 1].node.children as MindElixirNode[]).push(node);
        stack.push({ node, depth });
      }
    }

    const nodeData: MindElixirNode = rootNode ?? { id: 'root', topic: 'Mind Map', children: [] };
    return JSON.stringify({ nodeData }, null, 2);
  }

  /** Convert CKEditor HTML received from Trilium to Markdown for editing. */
  htmlToMarkdown(html: string): string {
    return turndown.turndown(html);
  }

  /** Convert Markdown back to HTML before saving to Trilium. */
  markdownToHtml(markdown: string): string {
    const result = marked.parse(markdown);
    if (typeof result !== 'string') {
      // marked.parse returns string when not async; narrow the type
      throw new Error('Unexpected async result from marked.parse');
    }
    return result;
  }

  removeTempFile(noteId: string): string | undefined {
    const filePath = this.pathByNoteId.get(noteId);
    if (!filePath) {
      return undefined;
    }
    try {
      fs.unlinkSync(filePath);
    } catch {
      // best-effort
    }
    this.noteIdByPath.delete(this.normalize(filePath));
    this.pathByNoteId.delete(noteId);
    this.noteTypeByNoteId.delete(noteId);
    return filePath;
  }

  cleanup(): void {
    for (const filePath of this.noteIdByPath.keys()) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // best-effort cleanup
      }
    }
    for (const filePath of this.htmlTempPaths) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // best-effort cleanup
      }
    }
    for (const filePath of this.textEditorPathByNoteId.values()) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // best-effort cleanup
      }
    }
    try {
      fs.rmdirSync(this.tempDir);
    } catch {
      // best-effort cleanup — directory may not be empty if other processes wrote there
    }
    this.noteIdByPath.clear();
    this.pathByNoteId.clear();
    this.noteTypeByNoteId.clear();
    this.htmlTempPaths.clear();
    this.textEditorPathByNoteId.clear();
    this.textEditorNoteIdByPath.clear();
  }
}
