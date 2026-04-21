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
    const client = this.getClient();
    webviewPanel.webview.html = this.getHtmlForWebview(
      webviewPanel.webview,
      getEditorFontSize(),
      getEditorSpellcheck(),
      client?.getServerUrl() ?? '',
      client?.getToken() ?? '',
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
  private getHtmlForWebview(webview: vscode.Webview, fontSize: number, spellcheck: boolean, serverUrl = '', token = ''): string {
    // Load CKEditor from out/ckeditor (copied during build)
    const ckeditorUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        'out',
        'ckeditor',
        'ckeditor.js',
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
      style-src ${webview.cspSource} 'unsafe-inline';
      script-src 'nonce-${nonce}';
      font-src ${webview.cspSource};
      img-src * data: blob:;
      ${serverUrl ? `connect-src ${serverUrl};` : ''}
    ">
    <title>Trilium Text Editor</title>
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
        border-color: var(--vscode-editorWidget-border, #454545) !important;
      }
      .ck.ck-toolbar .ck.ck-toolbar__separator {
        background: var(--vscode-editorWidget-border, #454545) !important;
      }
      .ck.ck-editor__top { border-color: var(--vscode-editorWidget-border, #454545) !important; }
      .ck.ck-editor__main>.ck-editor__editable {
        background: var(--vscode-editor-background, #1e1e1e) !important;
        color: var(--vscode-editor-foreground, #d4d4d4) !important;
        border-color: var(--vscode-editorWidget-border, #454545) !important;
      }
      .ck.ck-editor__editable.ck-focused {
        border-color: var(--vscode-focusBorder, #007acc) !important;
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
      .ck-editor__editable {
        flex: 1;
        overflow-y: auto;
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
      .ck-content pre {
        background: var(--vscode-textCodeBlock-background, rgba(0,0,0,.06));
        border-radius: 4px;
        padding: 12px 16px;
        overflow-x: auto;
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
    </style>
</head>
<body>
    <div id="breadcrumb"></div>
    <div id="editor-container"></div>
    
    <script nonce="${nonce}" src="${ckeditorUri}"></script>
    <script nonce="${nonce}">
      (function() {
        const vscode = acquireVsCodeApi();
        const TRILIUM_SERVER = ${JSON.stringify(serverUrl)};
        const TRILIUM_TOKEN  = ${JSON.stringify(token)};
        let editor;
        let isUpdatingFromExtension = false;

        // Initialize CKEditor
        ClassicEditor
          .create(document.querySelector('#editor-container'), {
            licenseKey: 'GPL',
            toolbar: {
              items: [
                'heading', 'fontSize', '|',
                'bold', 'italic',
                { label: 'Text formatting', icon: 'text', items: [
                  'underline', 'strikethrough', '|',
                  'superscript', 'subscript'
                ]},
                '|',
                'fontColor', 'fontBackgroundColor', 'removeFormat', '|',
                'bulletedList', 'numberedList', 'todoList', '|',
                'blockQuote', 'insertTable', '|',
                'code', 'codeBlock', '|',
                { label: 'Insert', icon: 'plus', items: [
                  'link', 'bookmark', '|',
                  'imageUpload', 'mediaEmbed', '|',
                  'specialCharacters', 'horizontalLine', 'pageBreak'
                ]},
                '|',
                'alignment', 'outdent', 'indent', '|',
                'findAndReplace', '|',
                'undo', 'redo'
              ],
              shouldNotGroupWhenFull: false
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
            }
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
              const content = editor.getData();
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
                editor.setData(message.content || '');
                isUpdatingFromExtension = false;
              }
              break;
            case 'breadcrumb': {
              const el = document.getElementById('breadcrumb');
              if (el) { el.textContent = message.path; }
              break;
            }
          }
        });

        // Rewrite Trilium-relative image URLs so images display inside the webview.
        // Images are fetched via the ETAPI token; only the display src is changed —
        // editor.getData() still returns the original relative URLs, so saving is safe.
        function rewriteTriliumImages() {
          if (!TRILIUM_SERVER || !TRILIUM_TOKEN) { return; }
          document.querySelectorAll('.ck-content img').forEach(img => {
            const src = img.getAttribute('src') ?? '';
            if (!src || img.dataset.triliumFixed) { return; }
            if (src.startsWith('api/') || src.startsWith('/api/')) {
              img.dataset.triliumFixed = '1';
              const url = TRILIUM_SERVER + (src.startsWith('/') ? src : '/' + src);
              fetch(url, { headers: { Authorization: TRILIUM_TOKEN } })
                .then(r => r.blob())
                .then(blob => { img.src = URL.createObjectURL(blob); })
                .catch(() => { /* leave broken-image icon */ });
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
