import * as vscode from 'vscode';
import * as path from 'path';
import { EtapiClient } from './etapiClient';
import { getEditorFontSize, getEditorSpellcheck } from './settings';

/**
 * CustomTextEditorProvider for Trilium text notes using CKEditor 5.
 * 
 * This provider opens Trilium HTML notes in a WYSIWYG CKEditor webview instead
 * of converting to Markdown. Changes are synced bidirectionally:
 * - CKEditor → TextDocument (enables Undo/Redo)
 * - TextDocument.save() → ETAPI PUT
 * 
 * Virtual document URI format:
 * trilium-text://trilium/noteId?title=Note+Title
 */
export class TriliumTextEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'trilium.textEditor';

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly getClient: () => EtapiClient | undefined,
  ) {}

  /**
   * Called when VS Code needs to create a custom editor for a document.
   */
  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    // Configure webview
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        vscode.Uri.joinPath(this.context.extensionUri, 'out'),
      ],
    };

    // Show note title in the editor tab
    const tabTitle = new URLSearchParams(document.uri.query).get('title') ?? 'Trilium Note';
    webviewPanel.title = tabTitle;

    // Set initial HTML
    webviewPanel.webview.html = this.getHtmlForWebview(
      webviewPanel.webview,
      getEditorFontSize(),
      getEditorSpellcheck(),
    );

    // True while we are applying a CKEditor-originated edit to the document.
    // Prevents the onDidChangeTextDocument listener from echoing the change
    // back to the webview and creating an infinite update loop.
    let pendingWebviewUpdate = false;

    // Extract the note ID from the virtual document URI so the breadcrumb can
    // walk the parent chain once the webview is ready.
    const noteIdForBreadcrumb = new URLSearchParams(document.uri.query).get('noteId') ?? '';

    // Send initial content once webview is ready
    const sendContent = () => {
      webviewPanel.webview.postMessage({
        type: 'init',
        content: document.getText(),
      });
    };

    // Handle messages from webview
    const messageListener = webviewPanel.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        case 'ready':
          // Webview signals it's ready to receive content
          sendContent();
          if (noteIdForBreadcrumb) {
            void this.sendBreadcrumb(webviewPanel, noteIdForBreadcrumb);
          }
          break;

        case 'contentChanged':
          // CKEditor content changed - update the document
          pendingWebviewUpdate = true;
          void this.updateTextDocument(document, message.content).then(() => {
            pendingWebviewUpdate = false;
          }, () => {
            pendingWebviewUpdate = false;
          });
          break;

        case 'save':
          // User pressed Ctrl+S in webview - trigger document save
          void document.save();
          break;

        case 'fetchImage': {
          const { id, url } = message as { type: string; id: string; url: string };
          void this.fetchImageDataUri(url).then(dataUri => {
            void webviewPanel.webview.postMessage({ type: 'imageFetchResult', id, dataUri });
          }).catch(() => {
            void webviewPanel.webview.postMessage({ type: 'imageFetchResult', id, error: 'fetch failed' });
          });
          break;
        }
        case 'error':
          void vscode.window.showErrorMessage(`Trilium Editor: ${message.message}`);
          break;
      }
    });

    // Handle document changes from outside (e.g., undo/redo)
    const changeListener = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length > 0) {
        // Don't echo changes that originated from the webview itself
        if (pendingWebviewUpdate) {
          return;
        }
        webviewPanel.webview.postMessage({
          type: 'update',
          content: document.getText(),
        });
      }
    });

    // Handle document save - sync to Trilium
    const saveListener = vscode.workspace.onDidSaveTextDocument(async (savedDoc) => {
      if (savedDoc.uri.toString() === document.uri.toString()) {
        await this.saveToTrilium(document);
      }
    });

    // Clean up listeners when webview is closed
    webviewPanel.onDidDispose(() => {
      messageListener.dispose();
      changeListener.dispose();
      saveListener.dispose();
    });
  }

  /**
   * Update the TextDocument with new content from CKEditor.
   * This enables VS Code's native undo/redo stack.
   */
  private updateTextDocument(document: vscode.TextDocument, content: string): Thenable<boolean> {
    const edit = new vscode.WorkspaceEdit();
    const lastLine = document.lineAt(document.lineCount - 1);
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, lastLine.range.end.line, lastLine.range.end.character),
      content,
    );
    return vscode.workspace.applyEdit(edit);
  }

  /**
   * Save document content to Trilium via ETAPI.
   */
  private async saveToTrilium(document: vscode.TextDocument): Promise<void> {
    const client = this.getClient();
    if (!client) {
      void vscode.window.showErrorMessage('Trilium: Not connected.');
      return;
    }

    // Extract noteId from URI query
    const noteId = new URLSearchParams(document.uri.query).get('noteId');
    if (!noteId) {
      void vscode.window.showErrorMessage('Trilium: Invalid document URI.');
      return;
    }

    try {
      const content = document.getText();
      await client.putNoteContent(noteId, content);
      vscode.window.setStatusBarMessage('$(check) Trilium: Note saved', 3000);
    } catch (err) {
      void vscode.window.showErrorMessage(`Trilium: Failed to save note: ${err}`);
    }
  }

  private async fetchImageDataUri(relativeUrl: string): Promise<string> {
    const client = this.getClient();
    if (!client) { throw new Error('Not connected'); }

    // Trilium stores images in two URL patterns, both of which require session auth
    // when hit directly. Route them through the ETAPI endpoints instead which accept
    // the ETAPI token and don't have CORS restrictions.
    //
    // Pattern 1: api/attachments/{attachmentId}/image/{filename}
    const attachmentMatch = relativeUrl.match(/api\/attachments\/([A-Za-z0-9_-]+)\/image\//);
    // Pattern 2: api/images/{noteId}/{filename}  (image-type notes embedded in text)
    const imageNoteMatch = !attachmentMatch && relativeUrl.match(/api\/images\/([A-Za-z0-9_-]+)\//);

    let buffer: ArrayBuffer;
    let mime: string;

    if (attachmentMatch) {
      buffer = await client.getAttachmentContent(attachmentMatch[1]);
      mime = mimeFromPath(relativeUrl);
    } else if (imageNoteMatch) {
      buffer = await client.getNoteContentBuffer(imageNoteMatch[1]);
      mime = mimeFromPath(relativeUrl);
    } else {
      const result = await client.fetchRaw(relativeUrl);
      buffer = result.buffer;
      mime = result.contentType.split(';')[0].trim();
    }

    const base64 = Buffer.from(buffer).toString('base64');
    return `data:${mime};base64,${base64}`;
  }

  private async sendBreadcrumb(panel: vscode.WebviewPanel, noteId: string): Promise<void> {
    const client = this.getClient();
    if (!client) { return; }

    const parts: string[] = [];
    const visited = new Set<string>();
    let currentId: string = noteId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      try {
        const note = await client.getNote(currentId);
        parts.unshift(note.title);
        if (currentId === 'root' || note.parentNoteIds.length === 0) { break; }
        currentId = note.parentNoteIds[0];
      } catch {
        break;
      }
    }

    panel.webview.postMessage({ type: 'breadcrumb', path: parts.join(' › ') });
  }

  /**
   * Generate HTML for the webview with CKEditor 5.
   */
  private getHtmlForWebview(webview: vscode.Webview, fontSize: number, spellcheck: boolean): string {
    // Load CKEditor from out/ckeditor (CSS and JS are bundled separately by esbuild)
    const ckeditorUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        'out',
        'ckeditor',
        'ckeditor.js',
      ),
    );
    
    const ckeditorCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        'out',
        'ckeditor',
        'ckeditor.css',
      ),
    );

    // Generate a nonce for CSP
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="
      default-src 'none';
      style-src ${webview.cspSource} 'unsafe-inline' https://cdn.jsdelivr.net;
      script-src 'nonce-${nonce}' https://cdn.jsdelivr.net;
      font-src ${webview.cspSource} https://cdn.jsdelivr.net data:;
      img-src * data: blob:;
      connect-src ${webview.cspSource} https://cdn.jsdelivr.net;
    ">
    <title>Trilium Text Editor</title>
    <!-- Load CKEditor CSS (bundled by esbuild) -->
    <link rel="stylesheet" href="${ckeditorCssUri}">
    <style nonce="${nonce}">
      /*
       * Map VS Code theme tokens → CKEditor CSS variables so the editor
       * automatically follows the active VS Code theme (light, dark, or
       * high-contrast) without any JavaScript theme-detection logic.
       */
      :root {
        /* Base surfaces */
        --ck-color-base-background:          var(--vscode-editor-background, #fff);
        --ck-color-base-foreground:          var(--vscode-editorWidget-background, #f5f5f5);
        --ck-color-base-text:                var(--vscode-editor-foreground, #000);
        --ck-color-text:                     var(--vscode-editor-foreground, #000);
        --ck-color-base-border:              var(--vscode-editorWidget-border, #c8c8c8);

        /* Toolbar */
        --ck-color-toolbar-background:       var(--vscode-editorWidget-background, #f3f3f3);
        --ck-color-toolbar-border:           var(--vscode-editorWidget-border, #c8c8c8);

        /* Panels & dropdowns */
        --ck-color-panel-background:         var(--vscode-editorWidget-background, #f3f3f3);
        --ck-color-panel-border:             var(--vscode-editorWidget-border, #c8c8c8);
        --ck-color-dropdown-panel-background: var(--vscode-editorWidget-background, #f3f3f3);
        --ck-color-dropdown-panel-border:    var(--vscode-editorWidget-border, #c8c8c8);

        /* Dialogs */
        --ck-color-dialog-background:        var(--vscode-editorWidget-background, #f3f3f3);
        --ck-color-dialog-form-header-border: var(--vscode-editorWidget-border, #c8c8c8);
        --ck-color-labeled-field-label-background: var(--vscode-editorWidget-background, #f3f3f3);

        /* Buttons (toolbar icons) */
        --ck-color-button-default:           var(--vscode-editor-foreground, #000);
        --ck-color-button-default-background: transparent;
        --ck-color-button-default-hover-background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,.31));
        --ck-color-button-default-active-background: var(--vscode-toolbar-activeBackground, rgba(99,102,103,.31));
        --ck-color-button-on-background:     var(--vscode-inputOption-activeBackground, #007acc);
        --ck-color-button-on-color:          var(--vscode-inputOption-activeForeground, #fff);
        --ck-color-button-on-hover-background: var(--vscode-inputOption-activeBackground, #007acc);
        --ck-color-button-action-background: var(--vscode-button-background, #007acc);
        --ck-color-button-action-text:       var(--vscode-button-foreground, #fff);
        --ck-color-button-action-hover-background: var(--vscode-button-hoverBackground, #0062a3);

        /* Inputs */
        --ck-color-input-background:         var(--vscode-input-background, #fff);
        --ck-color-input-text:               var(--vscode-input-foreground, #000);
        --ck-color-input-border:             var(--vscode-input-border, #bebebe);
        --ck-color-input-disabled-background: var(--vscode-input-background, #eee);

        /* Lists */
        --ck-color-list-background:          var(--vscode-editorWidget-background, #f3f3f3);
        --ck-color-list-button-hover-background: var(--vscode-list-hoverBackground, rgba(90,93,94,.31));
        --ck-color-list-button-on-background: var(--vscode-list-activeSelectionBackground, #094771);
        --ck-color-list-button-on-background-focus: var(--vscode-list-activeSelectionBackground, #094771);
        --ck-color-list-button-on-text:      var(--vscode-list-activeSelectionForeground, #fff);

        /* Focus & shadows */
        --ck-color-focus-border:             var(--vscode-focusBorder, #007acc);
        --ck-color-shadow-drop:              var(--vscode-widget-shadow, rgba(0,0,0,.36));
        --ck-color-shadow-inner:             var(--vscode-widget-shadow, rgba(0,0,0,.2));

        /* Misc */
        --ck-color-engine-placeholder-text:  var(--vscode-input-placeholderForeground, #767676);
        --ck-color-link-default:             var(--vscode-textLink-foreground, #006ab1);
        --ck-color-image-caption-background: var(--vscode-editorWidget-background, #f3f3f3);
        --ck-color-image-caption-text:       var(--vscode-editor-foreground, #000);
      }

      /* Direct CKEditor element overrides — applied after CKEditor injects its own CSS */
      .ck.ck-toolbar, .ck.ck-toolbar_grouping {
        background: var(--vscode-editorWidget-background, #3c3c3c) !important;
        border: none !important;
      }
      .ck.ck-toolbar .ck.ck-toolbar__separator {
        background: var(--vscode-editorWidget-border, #454545) !important;
      }
      .ck.ck-editor__top { border: none !important; }
      .ck.ck-editor__top .ck-sticky-panel .ck-sticky-panel__content { border: none !important; }
      .ck.ck-editor {
        flex: 1 !important;
        min-height: 0 !important;
        display: flex !important;
        flex-direction: column !important;
      }
      .ck.ck-editor__main {
        flex: 1 !important;
        min-height: 0 !important;
        display: flex !important;
        flex-direction: column !important;
      }
      .ck.ck-editor__main>.ck-editor__editable {
        background: var(--vscode-editor-background, #1e1e1e) !important;
        color: var(--vscode-editor-foreground, #d4d4d4) !important;
        border: none !important;
        flex: 1 !important;
        min-height: 0 !important;
        overflow-y: auto !important;
      }
      .ck.ck-editor__editable.ck-focused {
        border: none !important;
        box-shadow: none !important;
        outline: none !important;
      }
      .ck.ck-button { color: var(--vscode-editor-foreground, #cccccc) !important; }
      .ck.ck-button:not(.ck-disabled):not(.ck-on):hover {
        background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,.31)) !important;
      }
      .ck.ck-button.ck-on {
        background: var(--vscode-inputOption-activeBackground, #007acc) !important;
        color: var(--vscode-inputOption-activeForeground, #fff) !important;
      }
      .ck.ck-dropdown__panel, .ck.ck-balloon-panel {
        background: var(--vscode-editorWidget-background, #3c3c3c) !important;
        border-color: var(--vscode-editorWidget-border, #454545) !important;
        box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0,0,0,.36)) !important;
      }
      .ck.ck-list { background: var(--vscode-editorWidget-background, #3c3c3c) !important; }
      .ck.ck-list__item>.ck-button { color: var(--vscode-editor-foreground, #cccccc) !important; }
      .ck.ck-list__item>.ck-button:hover {
        background: var(--vscode-list-hoverBackground, rgba(90,93,94,.31)) !important;
      }
      .ck.ck-list__item>.ck-button.ck-on {
        background: var(--vscode-list-activeSelectionBackground, #094771) !important;
        color: var(--vscode-list-activeSelectionForeground, #fff) !important;
      }
      .ck.ck-input {
        background: var(--vscode-input-background, #3c3c3c) !important;
        color: var(--vscode-input-foreground, #cccccc) !important;
        border-color: var(--vscode-input-border, transparent) !important;
      }
      .ck .ck-label, .ck.ck-labeled-field-view__label {
        color: var(--vscode-foreground, #cccccc) !important;
        background: var(--vscode-editorWidget-background, #3c3c3c) !important;
      }
      .ck.ck-tooltip .ck-tooltip__text {
        background: var(--vscode-editorHoverWidget-background, #252526) !important;
        color: var(--vscode-editorHoverWidget-foreground, #cccccc) !important;
        border-color: var(--vscode-editorHoverWidget-border, #454545) !important;
      }
      /* Remove "Powered by CKEditor" badge */
      .ck.ck-powered-by { display: none !important; }
      /* Fix hardcoded table colors */
      .ck-content table td, .ck-content table th {
        border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.4)) !important;
      }
      .ck-content table th {
        background: var(--vscode-editorWidget-background, rgba(128,128,128,.1)) !important;
        color: var(--vscode-editor-foreground) !important;
      }

      body {
        padding: 0;
        margin: 0;
        height: 100vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      #breadcrumb {
        flex-shrink: 0;
        font-size: 0.78em;
        padding: 3px 12px;
        color: var(--vscode-descriptionForeground);
        background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
        border-bottom: 1px solid var(--vscode-editorWidget-border, #444);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        user-select: none;
      }
      #editor-container {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      /* Match Trilium's content styles */
      .ck-content {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: ${fontSize}px;
        line-height: 1.6;
        padding: 20px;
      }
      /* Trilium uses h2–h6 (h1 is reserved for the note title) */
      .ck-content h2 { font-size: 1.6em; margin: 0.75em 0; }
      .ck-content h3 { font-size: 1.4em; margin: 0.83em 0; }
      .ck-content h4 { font-size: 1.2em; margin: 1em 0; }
      .ck-content h5 { font-size: 1.1em; margin: 1.12em 0; }
      .ck-content h6 { font-size: 1.0em; margin: 1.5em 0; }
      .ck-content code {
        background: var(--vscode-textCodeBlock-background, rgba(0,0,0,.06));
        border-radius: 3px;
        padding: 1px 4px;
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 0.9em;
      }
      .ck-content blockquote {
        border-left: 3px solid var(--vscode-editorWidget-border, #c8c8c8);
        margin: 0;
        padding-left: 16px;
        color: var(--vscode-descriptionForeground, #6a737d);
      }
      .ck-content table {
        border-collapse: collapse;
        width: 100%;
        margin: 1em 0;
      }
      .ck-content table td,
      .ck-content table th {
        border: 1px solid #ddd;
        padding: 8px;
      }
      .ck-content table th {
        background-color: #f2f2f2;
        font-weight: bold;
      }
      
      /* Admonition type-specific colors (uses aside.admonition.TYPE) */
      .ck-content aside.admonition {
        border-left: 4px solid;
        padding: 12px 16px;
        margin: 16px 0;
        border-radius: 4px;
      }
      .ck-content aside.admonition.note {
        border-left-color: #0969da;
        background-color: rgba(9, 105, 218, 0.1);
      }
      .ck-content aside.admonition.tip {
        border-left-color: #1a7f37;
        background-color: rgba(26, 127, 55, 0.1);
      }
      .ck-content aside.admonition.important {
        border-left-color: #8250df;
        background-color: rgba(130, 80, 223, 0.1);
      }
      .ck-content aside.admonition.caution {
        border-left-color: #d29922;
        background-color: rgba(210, 153, 34, 0.1);
      }
      .ck-content aside.admonition.warning {
        border-left-color: #cf222e;
        background-color: rgba(207, 34, 46, 0.1);
      }
      
      /* Dropdown preview colors for admonition types */
      .ck-tn-admonition-note .ck-button__label::before {
        content: "● ";
        color: #0969da;
        font-weight: bold;
        margin-right: 4px;
      }
      .ck-tn-admonition-tip .ck-button__label::before {
        content: "● ";
        color: #1a7f37;
        font-weight: bold;
        margin-right: 4px;
      }
      .ck-tn-admonition-important .ck-button__label::before {
        content: "● ";
        color: #8250df;
        font-weight: bold;
        margin-right: 4px;
      }
      .ck-tn-admonition-caution .ck-button__label::before {
        content: "● ";
        color: #d29922;
        font-weight: bold;
        margin-right: 4px;
      }
      .ck-tn-admonition-warning .ck-button__label::before {
        content: "● ";
        color: #cf222e;
        font-weight: bold;
        margin-right: 4px;
      }
      
      /* Background colors for admonition dropdown items */
      .ck-tn-admonition-note {
        background-color: rgba(9, 105, 218, 0.08) !important;
      }
      .ck-tn-admonition-note:hover {
        background-color: rgba(9, 105, 218, 0.15) !important;
      }
      .ck-tn-admonition-tip {
        background-color: rgba(26, 127, 55, 0.08) !important;
      }
      .ck-tn-admonition-tip:hover {
        background-color: rgba(26, 127, 55, 0.15) !important;
      }
      .ck-tn-admonition-important {
        background-color: rgba(130, 80, 223, 0.08) !important;
      }
      .ck-tn-admonition-important:hover {
        background-color: rgba(130, 80, 223, 0.15) !important;
      }
      .ck-tn-admonition-caution {
        background-color: rgba(210, 153, 34, 0.08) !important;
      }
      .ck-tn-admonition-caution:hover {
        background-color: rgba(210, 153, 34, 0.15) !important;
      }
      .ck-tn-admonition-warning {
        background-color: rgba(207, 34, 46, 0.08) !important;
      }
      .ck-tn-admonition-warning:hover {
        background-color: rgba(207, 34, 46, 0.15) !important;
      }
      
      /* Code block styling to match VS Code theme, including Trilium-style
         marker-based syntax highlighting in the editing view. */
      .ck-content pre {
        position: relative;
        background-color: var(--vscode-textCodeBlock-background, #f5f5f5);
        border: 1px solid var(--vscode-editorWidget-border, #c8c8c8);
        border-radius: 4px;
        padding: 28px 12px 12px;
        overflow-x: auto;
        font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
        font-size: var(--vscode-editor-font-size, 13px);
        line-height: 1.6;
      }
      .ck.ck-editor__editable pre[data-language]:after {
        content: none;
      }
      .ck-content pre::before {
        content: attr(data-language);
        position: absolute;
        top: 6px;
        right: 10px;
        font-size: 11px;
        line-height: 1;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--vscode-descriptionForeground, #6a737d);
        background: var(--vscode-editor-background, #fff);
        border: 1px solid var(--vscode-editorWidget-border, #c8c8c8);
        border-radius: 999px;
        padding: 3px 8px;
      }
      .ck-content pre:not([data-language])::before {
        content: 'Code';
      }
      .ck-content pre code {
        background: transparent;
        padding: 0;
        color: var(--vscode-editor-foreground, #000);
        font-family: inherit;
      }
      .ck-content .hljs-comment,
      .ck-content .hljs-quote {
        color: var(--vscode-editorCodeLens-foreground, #6a9955) !important;
      }
      .ck-content .hljs-keyword,
      .ck-content .hljs-selector-tag,
      .ck-content .hljs-literal,
      .ck-content .hljs-section,
      .ck-content .hljs-link {
        color: var(--vscode-symbolIcon-keywordForeground, #569cd6) !important;
      }
      .ck-content .hljs-string,
      .ck-content .hljs-regexp,
      .ck-content .hljs-addition,
      .ck-content .hljs-attribute,
      .ck-content .hljs-template-tag,
      .ck-content .hljs-template-variable {
        color: var(--vscode-debugTokenExpression-string, #ce9178) !important;
      }
      .ck-content .hljs-number,
      .ck-content .hljs-symbol,
      .ck-content .hljs-bullet,
      .ck-content .hljs-variable,
      .ck-content .hljs-built_in,
      .ck-content .hljs-type {
        color: var(--vscode-debugTokenExpression-number, #b5cea8) !important;
      }
      .ck-content .hljs-title,
      .ck-content .hljs-title.class_,
      .ck-content .hljs-title.function_,
      .ck-content .hljs-function {
        color: var(--vscode-symbolIcon-functionForeground, #dcdcaa) !important;
      }
      .ck-content .hljs-property,
      .ck-content .hljs-attr,
      .ck-content .hljs-selector-id,
      .ck-content .hljs-selector-class {
        color: var(--vscode-symbolIcon-propertyForeground, #9cdcfe) !important;
      }
      .ck-content .hljs-meta,
      .ck-content .hljs-meta .hljs-keyword,
      .ck-content .hljs-doctag {
        color: var(--vscode-symbolIcon-operatorForeground, #c586c0) !important;
      }
      .ck-content .hljs-deletion {
        color: var(--vscode-diffEditor-removedTextForeground, #f14c4c) !important;
      }
      .ck-content .hljs-emphasis {
        font-style: italic;
      }
      .ck-content .hljs-strong {
        font-weight: 700;
      }
    </style>
</head>
<body>
    <div id="breadcrumb"></div>
    <div id="editor-container"></div>
    
    <script type="module" nonce="${nonce}">
      import { TriliumEditor } from '${ckeditorUri}';
      
      (function() {
        const vscode = acquireVsCodeApi();
        let editor;
        let isUpdatingFromExtension = false;
        const pendingImageFetches = new Map();

        const triliumToLocalLanguageMap = {
          'text-plain': 'plaintext',
          'text-javascript': 'javascript',
          'application-javascript': 'javascript',
          'text-x-javascript': 'javascript',
          'application-x-javascript': 'javascript',
          'application-typescript': 'typescript',
          'text-typescript': 'typescript',
          'text-x-typescript': 'typescript',
          'text-x-python': 'python',
          'text-x-java': 'java',
          'text-x-csharp': 'csharp',
          'application-x-csharp': 'csharp',
          'text-x-c++src': 'cpp',
          'text-x-csrc': 'c',
          'application-x-httpd-php': 'php',
          'text-x-php': 'php',
          'text-x-ruby': 'ruby',
          'text-x-go': 'go',
          'text-x-rust': 'rust',
          'text-x-rustsrc': 'rust',
          'text-x-swift': 'swift',
          'text-x-kotlin': 'kotlin',
          'text-html': 'html',
          'application-xml': 'xml',
          'text-xml': 'xml',
          'text-css': 'css',
          'text-x-scss': 'scss',
          'text-x-sql': 'sql',
          'text-x-sh': 'bash',
          'text-x-shell': 'shell',
          'application-x-powershell': 'powershell',
          'application-json': 'json',
          'text-x-json': 'json',
          'application-x-yaml': 'yaml',
          'text-x-yaml': 'yaml',
          'text-markdown': 'markdown',
          'text-x-markdown': 'markdown',
          'text-x-diff': 'diff',
        };

        const localToTriliumLanguageMap = {
          plaintext: 'text-plain',
          javascript: 'application-javascript',
          typescript: 'application-typescript',
          python: 'text-x-python',
          java: 'text-x-java',
          csharp: 'text-x-csharp',
          cpp: 'text-x-c++src',
          c: 'text-x-csrc',
          php: 'application-x-httpd-php',
          ruby: 'text-x-ruby',
          go: 'text-x-go',
          rust: 'text-x-rustsrc',
          swift: 'text-x-swift',
          kotlin: 'text-x-kotlin',
          html: 'text-html',
          xml: 'text-xml',
          css: 'text-css',
          scss: 'text-x-scss',
          sql: 'text-x-sql',
          bash: 'text-x-sh',
          shell: 'text-x-shell',
          powershell: 'application-x-powershell',
          json: 'application-json',
          yaml: 'application-x-yaml',
          markdown: 'text-x-markdown',
          diff: 'text-x-diff',
        };

        function normalizeIncomingCodeBlockLanguages(html) {
          if (!html || typeof html !== 'string') {
            return html;
          }

          const fallbackFromMimeLikeTag = (tag) => {
            const canonical = (tag || '').toLowerCase().replace(/-env-.+$/, '');

            if (canonical.includes('javascript')) return 'javascript';
            if (canonical.includes('typescript')) return 'typescript';
            if (canonical.includes('python')) return 'python';
            if (canonical.includes('java')) return 'java';
            if (canonical.includes('csharp') || canonical.includes('c-sharp')) return 'csharp';
            if (canonical.includes('c++') || canonical.includes('cpp')) return 'cpp';
            if (canonical.includes('csrc') || canonical === 'text-x-c') return 'c';
            if (canonical.includes('php')) return 'php';
            if (canonical.includes('ruby')) return 'ruby';
            if (canonical.includes('go')) return 'go';
            if (canonical.includes('rust')) return 'rust';
            if (canonical.includes('swift')) return 'swift';
            if (canonical.includes('kotlin')) return 'kotlin';
            if (canonical.includes('html')) return 'html';
            if (canonical.includes('xml')) return 'xml';
            if (canonical.includes('css') && !canonical.includes('scss')) return 'css';
            if (canonical.includes('scss')) return 'scss';
            if (canonical.includes('sql')) return 'sql';
            if (canonical.includes('powershell')) return 'powershell';
            if (canonical.includes('shell')) return 'shell';
            if (canonical.includes('sh')) return 'bash';
            if (canonical.includes('json')) return 'json';
            if (canonical.includes('yaml') || canonical.includes('yml')) return 'yaml';
            if (canonical.includes('markdown')) return 'markdown';
            if (canonical.includes('diff')) return 'diff';
            if (canonical.includes('plain')) return 'plaintext';

            return null;
          };

          const doc = new DOMParser().parseFromString(html, 'text/html');
          for (const code of doc.querySelectorAll('pre code[class]')) {
            const classes = Array.from(code.classList);
            const langClass = classes.find(cls => cls.startsWith('language-'));
            if (!langClass) {
              continue;
            }

            const tag = langClass.slice('language-'.length).toLowerCase();
            const canonicalTag = tag.replace(/-env-.+$/, '');
            const mapped = triliumToLocalLanguageMap[tag]
              || triliumToLocalLanguageMap[canonicalTag]
              || fallbackFromMimeLikeTag(tag);
            if (!mapped) {
              continue;
            }

            code.classList.remove(langClass);
            code.classList.add('language-' + mapped);
          }

          return doc.body.innerHTML;
        }

        function normalizeOutgoingCodeBlockLanguages(html) {
          if (!html || typeof html !== 'string') {
            return html;
          }

          const doc = new DOMParser().parseFromString(html, 'text/html');
          for (const code of doc.querySelectorAll('pre code[class]')) {
            const classes = Array.from(code.classList);
            const langClass = classes.find(cls => cls.startsWith('language-'));
            if (!langClass) {
              continue;
            }

            const languageTag = langClass.slice('language-'.length).toLowerCase();
            const mapped = localToTriliumLanguageMap[languageTag];
            if (!mapped) {
              continue;
            }

            code.classList.remove(langClass);
            code.classList.add('language-' + mapped);
          }

          return doc.body.innerHTML;
        }

        // Initialize TriliumEditor (custom CKEditor build with Trilium plugins)
        TriliumEditor
          .create(document.querySelector('#editor-container'), {
            licenseKey: 'GPL',
            // Override toolbar to match Trilium's layout more closely
            toolbar: {
              items: [
                'heading',
                '|',
                'bold',
                'italic',
                'underline',
                'strikethrough',
                '|',
                'fontSize',
                'fontFamily',
                'fontColor',
                'fontBackgroundColor',
                '|',
                'alignment',
                'outdent',
                'indent',
                '|',
                'bulletedList',
                'numberedList',
                'todoList',
                '|',
                'link',
                'insertImage',
                'insertTable',
                'mediaEmbed',
                'blockQuote',
                'codeBlock',
                'horizontalLine',
                '|',
                'math',
                'mermaid',
                'admonition',
                'footnote',
                '|',
                'specialCharacters',
                'highlight',
                '|',
                'undo',
                'redo',
                '|',
                'findAndReplace',
              ],
              shouldNotGroupWhenFull: true
            },
            heading: {
              options: [
                { model: 'paragraph', title: 'Paragraph', class: 'ck-heading_paragraph' },
                { model: 'heading2', view: 'h2', title: 'Heading 2', class: 'ck-heading_heading2' },
                { model: 'heading3', view: 'h3', title: 'Heading 3', class: 'ck-heading_heading3' },
                { model: 'heading4', view: 'h4', title: 'Heading 4', class: 'ck-heading_heading4' },
                { model: 'heading5', view: 'h5', title: 'Heading 5', class: 'ck-heading_heading5' },
                { model: 'heading6', view: 'h6', title: 'Heading 6', class: 'ck-heading_heading6' }
              ]
            },
            fontSize: {
              options: [10, 12, 'default', 16, 18, 20, 24, 28, 32],
              supportAllValues: false
            },
            alignment: {
              options: ['left', 'center', 'right', 'justify']
            },
            list: {
              properties: {
                styles: true,
                startIndex: true,
                reversed: true
              }
            },
            table: {
              contentToolbar: [
                'tableColumn', 'tableRow', 'mergeTableCells',
                'tableProperties', 'tableCellProperties', 'toggleTableCaption'
              ]
            },
            image: {
              toolbar: [
                'imageStyle:inline', 'imageStyle:alignCenter',
                '|', 'imageResize:50', 'imageResize:75', 'imageResize:original',
                '|', 'toggleImageCaption', 'imageTextAlternative'
              ]
            },
            link: {
              defaultProtocol: 'https://'
            },
            // Math plugin: lazy-load KaTeX library
            math: {
              engine: 'katex',
              lazyLoad: async () => {
                // Dynamically import KaTeX when math plugin is first used
                const katex = await import('https://cdn.jsdelivr.net/npm/katex@0.16.45/dist/katex.mjs');
                return katex;
              },
              outputType: 'span',
              forceOutputType: false,
              enablePreview: true,
            },
            // Mermaid plugin: lazy-load Mermaid library
            mermaid: {
              lazyLoad: async () => {
                // Dynamically import Mermaid when first used
                const mermaid = await import('https://cdn.jsdelivr.net/npm/mermaid@11.14.0/dist/mermaid.esm.min.mjs');
                return mermaid.default;
              },
            },
            // Code block configuration. The custom syntax-highlighting plugin
            // maps these language names to highlight.js in the editing view.
            codeBlock: {
              languages: [
                { language: 'plaintext', label: 'Plain text' },
                { language: 'javascript', label: 'JavaScript' },
                { language: 'typescript', label: 'TypeScript' },
                { language: 'python', label: 'Python' },
                { language: 'java', label: 'Java' },
                { language: 'csharp', label: 'C#' },
                { language: 'cpp', label: 'C++' },
                { language: 'c', label: 'C' },
                { language: 'php', label: 'PHP' },
                { language: 'ruby', label: 'Ruby' },
                { language: 'go', label: 'Go' },
                { language: 'rust', label: 'Rust' },
                { language: 'swift', label: 'Swift' },
                { language: 'kotlin', label: 'Kotlin' },
                { language: 'html', label: 'HTML' },
                { language: 'xml', label: 'XML' },
                { language: 'css', label: 'CSS' },
                { language: 'scss', label: 'SCSS' },
                { language: 'sql', label: 'SQL' },
                { language: 'bash', label: 'Bash' },
                { language: 'shell', label: 'Shell' },
                { language: 'powershell', label: 'PowerShell' },
                { language: 'json', label: 'JSON' },
                { language: 'yaml', label: 'YAML' },
                { language: 'markdown', label: 'Markdown' },
                { language: 'diff', label: 'Diff' },
              ],
            },
          })
          .then(newEditor => {
            editor = newEditor;

            // Apply spellcheck setting to the editable area
            editor.editing.view.change(writer => {
              writer.setAttribute(
                'spellcheck',
                '${spellcheck}',
                editor.editing.view.document.getRoot()
              );
            });

            // Listen for content changes
            editor.model.document.on('change:data', () => {
              if (isUpdatingFromExtension) {
                return;
              }
              const content = normalizeOutgoingCodeBlockLanguages(editor.getData());
              vscode.postMessage({
                type: 'contentChanged',
                content: content
              });
            });

            // Handle Ctrl+S
            editor.editing.view.document.on('keydown', (evt, data) => {
              if ((data.ctrlKey || data.metaKey) && data.keyCode === 83) {
                data.preventDefault();
                vscode.postMessage({ type: 'save' });
              }
            });

            // Signal ready
            vscode.postMessage({ type: 'ready' });
          })
          .catch(error => {
            vscode.postMessage({
              type: 'error',
              message: 'Failed to initialize CKEditor: ' + error.message
            });
          });

        // Handle messages from extension
        window.addEventListener('message', event => {
          const message = event.data;
          
          switch (message.type) {
            case 'init':
            case 'update':
              if (editor) {
                isUpdatingFromExtension = true;
                editor.setData(normalizeIncomingCodeBlockLanguages(message.content || ''));
                isUpdatingFromExtension = false;
              }
              break;
            case 'breadcrumb': {
              const el = document.getElementById('breadcrumb');
              if (el) { el.textContent = message.path; }
              break;
            }
            case 'imageFetchResult': {
              const img = pendingImageFetches.get(message.id);
              pendingImageFetches.delete(message.id);
              if (img && message.dataUri) { img.src = message.dataUri; }
              break;
            }
          }
        });

        // Proxy image fetches through the extension host to avoid CORS restrictions.
        // Only the DOM img.src property is updated — editor.getData() returns the
        // original relative URL, so saving back to Trilium is unaffected.
        function rewriteTriliumImages() {
          document.querySelectorAll('.ck-content img').forEach(img => {
            const src = img.getAttribute('src') ?? '';
            if (!src || img.dataset.triliumFixed) { return; }
            if (src.startsWith('api/') || src.startsWith('/api/')) {
              img.dataset.triliumFixed = '1';
              const id = Math.random().toString(36).slice(2);
              pendingImageFetches.set(id, img);
              vscode.postMessage({ type: 'fetchImage', id, url: src });
            }
          });
        }
        new MutationObserver(rewriteTriliumImages)
          .observe(document.body, { childList: true, subtree: true });

      })();
    </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function mimeFromPath(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    bmp: 'image/bmp', ico: 'image/x-icon', tiff: 'image/tiff', tif: 'image/tiff',
  };
  return map[ext] ?? 'image/jpeg';
}
