import * as vscode from 'vscode';
import { EtapiClient, Note } from './etapiClient';
import { sanitizeIncludedNoteHtml } from './triliumTextEditorProvider';

function buildHtml(webview: vscode.Webview, title: string, sanitizedHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:;">
  <title>${title}</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 24px 32px;
      line-height: 1.5;
    }
    .content { max-width: 900px; margin: 0 auto; }
    .content img { max-width: 100%; }
    .content pre { overflow-x: auto; background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; }
    .content a { color: var(--vscode-textLink-foreground); }
    .content table { border-collapse: collapse; }
    .content table, .content th, .content td { border: 1px solid var(--vscode-editorWidget-border); padding: 4px 8px; }
  </style>
</head>
<body>
  <div class="content">${sanitizedHtml}</div>
</body>
</html>`;
}

/**
 * Read-only preview for `doc` notes (e.g. Trilium's own built-in help/release-notes
 * pages): they carry static, server-authored HTML with no editing affordances in
 * Trilium's own UI either, so this only ever renders - it never becomes an editor.
 */
export async function openDocNotePanel(client: EtapiClient, note: Note): Promise<void> {
  const rawHtml = await client.getNoteContent(note.noteId);
  const sanitizedHtml = sanitizeIncludedNoteHtml(rawHtml);

  const panel = vscode.window.createWebviewPanel(
    'triliumDocPreview',
    note.title,
    vscode.ViewColumn.Active,
    { enableScripts: false },
  );

  panel.webview.html = buildHtml(panel.webview, note.title, sanitizedHtml);
}
