import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { EtapiClient, AppInfo } from './etapiClient';
import {
  NoteItem,
  NoteTreeProvider,
  NoteTreeDecorationProvider,
  noteTypeToLabel,
  preferredCodiconForNote,
} from './noteTreeProvider';
import { getAutoRevealInTreeOnOpen, getServerUrl, getToken, storeToken } from './settings';
import { TempFileManager } from './tempFileManager';
import { AttributesViewProvider } from './attributesViewProvider';
import { TriliumTextEditorProvider } from './triliumTextEditorProvider';
import { VirtualDocumentProvider, createVirtualDocumentUri } from './virtualDocumentProvider';
import { openReorderChildrenPanel } from './reorderChildrenPanel';
import { RecentNotesProvider } from './recentNotesProvider';
import { BacklinksProvider } from './backlinksProvider';
import { DraftNoteManager } from './draftNoteManager';
import { protectedNoteToolError, protectedNoteWarningMessage } from './protectedNoteUtils';
import {
  buildNoteContext,
  formatNoteContextForLm,
  stripHtmlForLm,
} from './triliumChatUtils';
import {
  buildRefreshFailureMessage,
  classifyRefreshFailure,
  shouldUntrackAfterFailure,
  shouldWarnAfterFailure,
} from './refreshPolicy';

type Note = import('./etapiClient').Note;
type Revision = import('./etapiClient').Revision;

interface MindMapNode {
  id?: string;
  topic?: string;
  expanded?: boolean;
  children?: MindMapNode[];
  [key: string]: unknown;
}

interface MindMapData {
  nodeData: MindMapNode;
  [key: string]: unknown;
}

interface BreadcrumbPart {
  noteId: string;
  title: string;
}

interface MindMapPreviewWebviewMessage {
  type: 'refresh' | 'ready' | 'save' | 'openBreadcrumbNote';
  data?: MindMapData;
  noteId?: string;
}

interface MermaidEditorWebviewMessage {
  type: 'refresh' | 'ready' | 'save' | 'openBreadcrumbNote';
  content?: string;
  noteId?: string;
}

interface ExcalidrawPayload {
  type: 'excalidraw';
  version: number;
  source?: string;
  elements: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
}

interface ExcalidrawEditorWebviewMessage {
  type: 'refresh' | 'ready' | 'save' | 'openBreadcrumbNote';
  content?: string;
  noteId?: string;
}

type WebviewNoteType = 'mindMap' | 'mermaid' | 'canvas';

const noteWebviewPanels = new Map<string, vscode.WebviewPanel>();
let activeWebviewNoteId: string | undefined;

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 24; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMindMapJsonForEditor(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function formatJsonForEditor(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

async function getBreadcrumbData(client: EtapiClient, noteId: string): Promise<{ parts: BreadcrumbPart[]; backlinksCount: number }> {
  const parts: BreadcrumbPart[] = [];
  const visited = new Set<string>();
  let currentId: string = noteId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    try {
      const note = await client.getNote(currentId);
      parts.unshift({ noteId: currentId, title: note.title });
      if (currentId === 'root' || note.parentNoteIds.length === 0) {
        break;
      }
      currentId = note.parentNoteIds[0];
    } catch {
      break;
    }
  }

  const backlinksCount = await countBacklinks(client, noteId);
  return { parts, backlinksCount };
}

async function countBacklinks(client: EtapiClient, noteId: string): Promise<number> {
  try {
    const { results } = await client.searchNotes('note.targetRelationCount > 0', { limit: 100 });
    const checks = await Promise.all(results.map(async (candidate) => {
      try {
        const fullNote = await client.getNote(candidate.noteId);
        return fullNote.attributes?.some(
          (attr) => attr.type === 'relation' && attr.value === noteId,
        ) ?? false;
      } catch {
        return false;
      }
    }));

    return checks.filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function sendBreadcrumbToPanel(
  panel: vscode.WebviewPanel,
  client: EtapiClient,
  noteId: string,
): Promise<void> {
  const breadcrumb = await getBreadcrumbData(client, noteId);
  panel.webview.postMessage({ type: 'breadcrumb', ...breadcrumb });
}

function expandMindMapNode(node: MindMapNode): MindMapNode {
  const children = Array.isArray(node.children)
    ? node.children.map((child) => expandMindMapNode(child))
    : [];
  return {
    ...node,
    expanded: true,
    children,
  };
}

function normalizeMindMapData(rawContent: string): MindMapData {
  const parsed = JSON.parse(rawContent) as MindMapData | MindMapNode;
  const nodeData = (parsed && typeof parsed === 'object' && 'nodeData' in parsed)
    ? (parsed as MindMapData).nodeData
    : parsed as MindMapNode;
  return {
    ...(parsed && typeof parsed === 'object' && 'nodeData' in parsed ? parsed : {}),
    nodeData: {
      ...expandMindMapNode(nodeData ?? { id: 'root', topic: 'Mind Map', children: [] }),
      root: true,
    },
  };
}

function buildMindMapPreviewHtml(webview: vscode.Webview, noteTitle: string): string {
  const nonce = createNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} https: 'unsafe-inline'; script-src 'nonce-${nonce}' https:; img-src ${webview.cspSource} https: data:; font-src https: data:;">
  <title>${escapeHtml(noteTitle)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/mind-elixir@5.11.0/dist/MindElixir.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@mind-elixir/node-menu@5.0.1/dist/style.css">
  <style>
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
      overflow: hidden;
    }
    body {
      display: flex;
      flex-direction: column;
    }
    button {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 4px;
      padding: 5px 10px;
      cursor: pointer;
      font-size: 12px;
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
    #breadcrumb .crumb {
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--vscode-textLink-foreground, #3794ff);
      cursor: pointer;
      font: inherit;
      margin: 0;
      padding: 0;
    }
    #breadcrumb .crumb:hover {
      color: var(--vscode-textLink-activeForeground, #4daafc);
      text-decoration: underline;
    }
    #breadcrumb .crumb:focus-visible {
      outline: 1px solid var(--vscode-focusBorder, #007fd4);
      outline-offset: 2px;
      border-radius: 2px;
    }
    #breadcrumb .separator {
      color: var(--vscode-descriptionForeground);
      margin: 0 0.4ch;
    }
    #breadcrumb .backlinks-badge {
      margin-left: 1ch;
      padding: 0 0.6ch;
      border-radius: 999px;
      border: 1px solid var(--vscode-badge-background, #4d4d4d);
      color: var(--vscode-badge-foreground, #ffffff);
      background: var(--vscode-badge-background, #4d4d4d);
      font-size: 0.92em;
      vertical-align: middle;
    }
    .content {
      position: relative;
      flex: 1;
      min-height: 0;
    }
    #map {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
    .overlay {
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 10;
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .badge {
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 11px;
      background: color-mix(in srgb, var(--vscode-editor-background) 80%, transparent);
      border: 1px solid var(--vscode-panel-border);
      color: var(--vscode-descriptionForeground);
    }

    .map-container .node-menu {
      top: 52px;
      background: var(--vscode-editorWidget-background);
      color: var(--vscode-editorWidget-foreground, var(--vscode-editor-foreground));
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      box-shadow: 0 1px 8px color-mix(in srgb, var(--vscode-editor-foreground) 15%, transparent);
    }

    .map-container .node-menu .nm-fontsize-container div {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      box-shadow: none;
      border: 1px solid var(--vscode-button-border, var(--vscode-editorWidget-border, transparent));
    }

    .map-container .node-menu input,
    .map-container .node-menu textarea {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-color: var(--vscode-input-border, var(--vscode-editorWidget-border, var(--vscode-panel-border)));
    }

    .map-container .node-menu input::placeholder,
    .map-container .node-menu textarea::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }

    .map-container .node-menu .palette {
      border-color: var(--vscode-contrastBorder, color-mix(in srgb, var(--vscode-editor-foreground) 18%, transparent));
    }

    .map-container .node-menu .nmenu-selected,
    .map-container .node-menu .palette:hover {
      box-shadow: var(--vscode-focusBorder) 0 0 0 2px;
      background-color: color-mix(in srgb, var(--vscode-focusBorder) 22%, transparent);
    }

    .map-container .node-menu .size-selected {
      background-color: var(--vscode-button-background) !important;
      border-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      fill: var(--vscode-button-foreground);
    }

    .map-container .node-menu .size-selected svg,
    .map-container .node-menu .bof .selected {
      color: var(--vscode-button-foreground);
      background-color: var(--vscode-button-background);
    }
  </style>
</head>
<body>
  <div id="breadcrumb"></div>
  <div class="content">
    <div class="overlay">
      <div id="status" class="badge">Loading…</div>
      <button id="refreshBtn">Refresh</button>
    </div>
    <div id="map"></div>
  </div>

  <script type="module" nonce="${nonce}">
    import MindElixir from 'https://cdn.jsdelivr.net/npm/mind-elixir@5.11.0/dist/MindElixir.js';
    import nodeMenu from 'https://cdn.jsdelivr.net/npm/@mind-elixir/node-menu@5.0.1/dist/node-menu.js';

    const vscode = acquireVsCodeApi();
    const statusEl = document.getElementById('status');
    const mapEl = document.getElementById('map');
    const refreshBtn = document.getElementById('refreshBtn');
    const breadcrumbEl = document.getElementById('breadcrumb');
    let mind = null;

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    function setStatus(message) {
      statusEl.textContent = message;
    }

    function renderBreadcrumb(parts, backlinksCount) {
      breadcrumbEl.replaceChildren();

      parts.forEach((part, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'crumb';
        button.textContent = part.title;
        button.title = part.title;
        button.addEventListener('click', () => {
          vscode.postMessage({ type: 'openBreadcrumbNote', noteId: part.noteId });
        });
        breadcrumbEl.appendChild(button);

        if (index < parts.length - 1) {
          const separator = document.createElement('span');
          separator.className = 'separator';
          separator.textContent = '›';
          breadcrumbEl.appendChild(separator);
        }
      });

      const badge = document.createElement('span');
      badge.className = 'backlinks-badge';
      badge.textContent = 'Backlinks ' + (Number.isFinite(backlinksCount) ? backlinksCount : 0);
      badge.title = 'Number of notes that link to this note via relations';
      breadcrumbEl.appendChild(badge);
    }

    function renderMindMap(data) {
      try {
        const options = {
          el: mapEl,
          direction: MindElixir.RIGHT,
          editable: true,
          toolBar: true,
          nodeMenu: true,
          keypress: true,
          contextMenu: true,
          theme: prefersDark ? MindElixir.DARK_THEME : MindElixir.THEME,
        };

        if (!mind) {
          mind = new MindElixir(options);
          mind.install(nodeMenu);
          mind.init(data);

          let saveTimer = null;
          mind.bus.addListener('operation', () => {
            setStatus('Unsaved changes');
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
              setStatus('Saving…');
              vscode.postMessage({ type: 'save', data: mind.getData() });
            }, 800);
          });
        } else {
          mind.refresh(data);
        }

        requestAnimationFrame(() => {
          try {
            mind.toCenter();
          } catch (err) {
            console.warn('[mindMap][preview] center failed', err);
          }
        });
        requestAnimationFrame(() => {
          setStatus('Rendered');
        });
      } catch (err) {
        setStatus('Failed to render');
        console.error('[mindMap][preview] render failed', err);
      }
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || message.type === 'render') {
        if (message && message.type === 'render') {
          renderMindMap(message.data);
        }
        return;
      }
      if (message.type === 'saveResult') {
        if (message.success) {
          setStatus('Saved');
        } else {
          setStatus('Save failed');
          console.error('[mindMap][preview] save failed:', message.error);
        }
        return;
      }
      if (message.type === 'breadcrumb') {
        renderBreadcrumb(message.parts, message.backlinksCount);
        return;
      }
    });

    refreshBtn.addEventListener('click', () => {
      setStatus('Refreshing…');
      vscode.postMessage({ type: 'refresh' });
    });

    vscode.postMessage({ type: 'ready' });

    setTimeout(() => {
      if (statusEl.textContent === 'Loading…') {
        setStatus('Waiting for preview data…');
      }
    }, 1500);
  </script>
</body>
</html>`;
}

function buildMermaidEditorHtml(
  webview: vscode.Webview,
  scriptUri: vscode.Uri,
): string {
  const nonce = createNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <title>Mermaid Editor</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
      overflow: hidden;
    }
    body {
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
    #breadcrumb .crumb {
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--vscode-textLink-foreground, #3794ff);
      cursor: pointer;
      font: inherit;
      margin: 0;
      padding: 0;
    }
    #breadcrumb .crumb:hover {
      color: var(--vscode-textLink-activeForeground, #4daafc);
      text-decoration: underline;
    }
    #breadcrumb .crumb:focus-visible {
      outline: 1px solid var(--vscode-focusBorder, #007fd4);
      outline-offset: 2px;
      border-radius: 2px;
    }
    #breadcrumb .separator {
      color: var(--vscode-descriptionForeground);
      margin: 0 0.4ch;
    }
    #breadcrumb .backlinks-badge {
      margin-left: 1ch;
      padding: 0 0.6ch;
      border-radius: 999px;
      border: 1px solid var(--vscode-badge-background, #4d4d4d);
      color: var(--vscode-badge-foreground, #ffffff);
      background: var(--vscode-badge-background, #4d4d4d);
      font-size: 0.92em;
      vertical-align: middle;
    }
    .content {
      position: relative;
      flex: 1;
      min-height: 0;
    }
    .overlay {
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 10;
      display: flex;
      gap: 8px;
      align-items: center;
    }
    button {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 4px;
      padding: 5px 10px;
      cursor: pointer;
      font-size: 12px;
    }
    #status {
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 11px;
      background: color-mix(in srgb, var(--vscode-editor-background) 80%, transparent);
      border: 1px solid var(--vscode-panel-border);
      color: var(--vscode-descriptionForeground);
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(260px, 42%) 1fr;
      height: 100%;
    }
    #source {
      width: 100%;
      height: 100%;
      border: none;
      border-right: 1px solid var(--vscode-panel-border);
      resize: none;
      outline: none;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.45;
      padding: 14px;
      box-sizing: border-box;
    }
    #preview {
      padding: 12px;
      overflow: auto;
      background: var(--vscode-editor-background);
    }
    #preview svg {
      max-width: 100%;
      height: auto;
    }
    .placeholder {
      color: var(--vscode-descriptionForeground);
      padding: 10px;
    }
    .error {
      color: var(--vscode-errorForeground);
      white-space: pre-wrap;
      word-break: break-word;
      margin: 0;
      padding: 10px;
      border: 1px solid color-mix(in srgb, var(--vscode-errorForeground) 35%, transparent);
      border-radius: 6px;
      background: color-mix(in srgb, var(--vscode-editor-background) 80%, var(--vscode-errorForeground) 20%);
    }
  </style>
</head>
<body>
  <div id="breadcrumb"></div>
  <div class="content">
    <div class="overlay">
      <div id="status">Loading...</div>
      <button id="refreshBtn">Refresh</button>
    </div>
    <div class="layout">
      <textarea id="source" spellcheck="false" aria-label="Mermaid source"></textarea>
      <div id="preview" aria-live="polite"></div>
    </div>
  </div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function buildExcalidrawEditorHtml(
  webview: vscode.Webview,
  scriptUri: vscode.Uri,
  styleUri: vscode.Uri,
  assetBaseUri: vscode.Uri,
): string {
  const nonce = createNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource} https: data:;">
  <title>Excalidraw Editor</title>
  <link rel="stylesheet" href="${styleUri}">
  <style>
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
      overflow: hidden;
    }
    body {
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
    #breadcrumb .crumb {
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--vscode-textLink-foreground, #3794ff);
      cursor: pointer;
      font: inherit;
      margin: 0;
      padding: 0;
    }
    #breadcrumb .crumb:hover {
      color: var(--vscode-textLink-activeForeground, #4daafc);
      text-decoration: underline;
    }
    #breadcrumb .crumb:focus-visible {
      outline: 1px solid var(--vscode-focusBorder, #007fd4);
      outline-offset: 2px;
      border-radius: 2px;
    }
    #breadcrumb .separator {
      color: var(--vscode-descriptionForeground);
      margin: 0 0.4ch;
    }
    #breadcrumb .backlinks-badge {
      margin-left: 1ch;
      padding: 0 0.6ch;
      border-radius: 999px;
      border: 1px solid var(--vscode-badge-background, #4d4d4d);
      color: var(--vscode-badge-foreground, #ffffff);
      background: var(--vscode-badge-background, #4d4d4d);
      font-size: 0.92em;
      vertical-align: middle;
    }
    .content {
      position: relative;
      flex: 1;
      min-height: 0;
    }
    .overlay {
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 10;
      display: flex;
      gap: 8px;
      align-items: center;
    }
    button {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 4px;
      padding: 5px 10px;
      cursor: pointer;
      font-size: 12px;
    }
    #status {
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 11px;
      background: color-mix(in srgb, var(--vscode-editor-background) 80%, transparent);
      border: 1px solid var(--vscode-panel-border);
      color: var(--vscode-descriptionForeground);
    }
    .canvas-shell {
      position: relative;
      width: 100%;
      height: 100%;
    }
    #app {
      position: absolute;
      inset: 0;
    }
    #error {
      display: none;
      margin: 8px;
      padding: 10px 12px;
      border-radius: 6px;
      border: 1px solid color-mix(in srgb, var(--vscode-errorForeground) 35%, transparent);
      background: color-mix(in srgb, var(--vscode-editor-background) 82%, var(--vscode-errorForeground) 18%);
      color: var(--vscode-errorForeground);
      white-space: pre-wrap;
      word-break: break-word;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      line-height: 1.45;
    }
  </style>
</head>
<body>
  <div id="breadcrumb"></div>
  <div class="content">
    <div class="overlay">
      <div id="status">Loading...</div>
      <button id="refreshBtn">Refresh</button>
    </div>
    <div class="canvas-shell">
      <div id="app"></div>
    </div>
    <pre id="error" aria-live="polite"></pre>
  </div>
  <script nonce="${nonce}">window.EXCALIDRAW_ASSET_PATH = ${JSON.stringify(`${assetBaseUri.toString()}/`)};</script>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function summarizeContentForDebug(content: string): string {
  const trimmed = content.trimStart();
  const likelyJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  const firstLine = content.split('\n', 1)[0].slice(0, 120);
  return `len=${content.length} likelyJson=${likelyJson} firstLine=${JSON.stringify(firstLine)}`;
}

function setActiveWebviewNoteContext(noteId: string, noteType: WebviewNoteType): void {
  activeWebviewNoteId = noteId;
  void vscode.commands.executeCommand('setContext', 'trilium.activeNoteId', noteId);
  void vscode.commands.executeCommand('setContext', 'trilium.activeNoteType', noteType);
}

function clearActiveWebviewNoteContext(noteId?: string): void {
  if (noteId && activeWebviewNoteId !== noteId) {
    return;
  }

  activeWebviewNoteId = undefined;
  void vscode.commands.executeCommand('setContext', 'trilium.activeNoteId', '');
  void vscode.commands.executeCommand('setContext', 'trilium.activeNoteType', '');
}

function createOrRevealWebviewPanel(note: Note, viewType: string): { panel: vscode.WebviewPanel; isNew: boolean } {
  const existing = noteWebviewPanels.get(note.noteId);
  if (existing) {
    existing.reveal(vscode.ViewColumn.Active);
    return { panel: existing, isNew: false };
  }

  const panel = vscode.window.createWebviewPanel(
    viewType,
    note.title,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );

  noteWebviewPanels.set(note.noteId, panel);
  panel.onDidDispose(() => {
    noteWebviewPanels.delete(note.noteId);
    clearActiveWebviewNoteContext(note.noteId);
  });
  panel.onDidChangeViewState((event) => {
    if (event.webviewPanel.active) {
      setActiveWebviewNoteContext(note.noteId, note.type as WebviewNoteType);
    } else {
      clearActiveWebviewNoteContext(note.noteId);
    }
  });

  return { panel, isNew: true };
}

const MIME_EXT_MAP: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'application/javascript': '.js',
  'text/javascript': '.js',
  'application/typescript': '.ts',
  'text/typescript': '.ts',
  'text/x-python': '.py',
  'text/markdown': '.md',
  'application/json': '.json',
  'text/xml': '.xml',
  'application/xml': '.xml',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'text/plain': '.txt',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'video/mp4': '.mp4',
};

function mimeToExt(mime: string): string | undefined {
  return MIME_EXT_MAP[mime.split(';', 1)[0].trim().toLowerCase()];
}

function findWebViewUrl(note: Note): string | undefined {
  const attrs = note.attributes ?? [];
  const preferredKeys = new Set(['url', 'src', 'href', 'link']);
  for (const attr of attrs) {
    if (attr.type !== 'label') {
      continue;
    }
    const key = attr.name.trim().toLowerCase();
    if (!preferredKeys.has(key)) {
      continue;
    }
    const raw = attr.value.trim();
    if (!raw) {
      continue;
    }
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString();
      }
    } catch {
      // Ignore invalid URL-like values.
    }
  }
  return undefined;
}

function resolveNoteBrowserUrl(note: Note, notePathOrId?: string): string {
  const serverUrl = getServerUrl().replace(/\/$/, '');
  const webViewUrl = note.type === 'webView' ? findWebViewUrl(note) : undefined;
  return webViewUrl ?? `${serverUrl}/#${notePathOrId ?? note.noteId}`;
}

async function openNoteInBrowser(
  note: Note,
  notePathOrId?: string,
  external = false,
): Promise<void> {
  const noteUrl = resolveNoteBrowserUrl(note, notePathOrId);
  if (external) {
    await vscode.env.openExternal(vscode.Uri.parse(noteUrl));
    return;
  }

  try {
    await vscode.commands.executeCommand('simpleBrowser.show', noteUrl);
  } catch {
    await vscode.env.openExternal(vscode.Uri.parse(noteUrl));
  }
}

async function showProtectedNoteRecoveryActions(
  note: Note,
  notePathOrId?: string,
): Promise<void> {
  const action = await vscode.window.showWarningMessage(
    protectedNoteWarningMessage(note.title),
    'Open in Browser',
    'Open in External Browser',
    'Reconnect',
  );

  if (action === 'Open in Browser') {
    await openNoteInBrowser(note, notePathOrId, false);
    return;
  }

  if (action === 'Open in External Browser') {
    await openNoteInBrowser(note, notePathOrId, true);
    return;
  }

  if (action === 'Reconnect') {
    await vscode.commands.executeCommand('trilium.reconnect');
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  if (vscode.env.uiKind !== vscode.UIKind.Desktop) {
    void vscode.window.showWarningMessage(
      'Trilium Notes: This extension requires the VS Code desktop application.',
    );
    return;
  }

  const tempFileManager = new TempFileManager();
  const draftNoteManager = new DraftNoteManager();
  const treeProvider = new NoteTreeProvider(undefined, context.extensionPath);
  const attributesProvider = new AttributesViewProvider();
  const recentNotesProvider = new RecentNotesProvider(context, context.extensionPath);
    let backlinksProvider: BacklinksProvider | undefined;
    let backlinksView: vscode.TreeView<any> | undefined;

  function ensureBacklinksView(): void {
    const client = treeProvider.getClient();
    if (!client) {
      backlinksProvider = undefined;
      if (backlinksView) {
        backlinksView.dispose();
        backlinksView = undefined;
      }
      return;
    }

    if (!backlinksProvider) {
      backlinksProvider = new BacklinksProvider(() => treeProvider.getClient());
    }
    if (!backlinksView) {
      backlinksView = vscode.window.createTreeView('triliumBacklinks', {
        treeDataProvider: backlinksProvider,
        showCollapseAll: false,
      });
      context.subscriptions.push(backlinksView);
    }
  }

  interface RefreshEntry {
    noteId: string;
    title: string;
    type: Note['type'];
    utcDateModified: string;
    tempFilePath: string;
    consecutiveFailures: number;
    lastWarnedFailureCount?: number;
  }
  const refreshRegistry = new Map<string, RefreshEntry>(); // noteId → entry

  function trackNoteForRefresh(note: Note, tempFilePath: string): void {
    refreshRegistry.set(note.noteId, {
      noteId: note.noteId,
      title: note.title,
      type: note.type,
      utcDateModified: note.utcDateModified,
      tempFilePath,
      consecutiveFailures: 0,
      lastWarnedFailureCount: undefined,
    });
  }

  async function refreshTrackedEntry(
    noteId: string,
    entry: RefreshEntry,
    client: EtapiClient,
  ): Promise<void> {
    const fresh = await client.getNote(noteId);
    if (fresh.utcDateModified > entry.utcDateModified) {
      entry.utcDateModified = fresh.utcDateModified;
      const openDoc = vscode.workspace.textDocuments.find(
        (d) => d.uri.scheme === 'file' && d.fileName === entry.tempFilePath,
      );
      if (openDoc && !openDoc.isDirty) {
        const newContent = await client.getNoteContent(noteId);
        const fileContent =
          entry.type === 'mindMap'
            ? formatMindMapJsonForEditor(newContent)
            : newContent;
        fs.writeFileSync(entry.tempFilePath, fileContent, 'utf8');
      }
    }

    entry.consecutiveFailures = 0;
    entry.lastWarnedFailureCount = undefined;
  }

  // Register virtual document provider for trilium-text:// URIs
  const virtualDocProvider = new VirtualDocumentProvider(() => treeProvider.getClient());
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('trilium-text', virtualDocProvider),
  );

  // Register in-memory read-only document provider for revision content (trilium-revision://)
  const revisionContentMap = new Map<string, string>();
  const revisionDocProvider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri): string {
      return revisionContentMap.get(uri.path) ?? '';
    }
  })();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('trilium-revision', revisionDocProvider),
  );

  // Register custom text editor provider for CKEditor webview
  const textEditorProvider = new TriliumTextEditorProvider(
    context,
    () => treeProvider.getClient(),
    draftNoteManager,
    (noteId) => treeProvider.refreshNoteById(noteId),
    () => treeProvider.refreshRoot(),
  );
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      TriliumTextEditorProvider.viewType,
      textEditorProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      },
    ),
  );

  const output = vscode.window.createOutputChannel('Trilium Notes');
  output.appendLine('Extension activated (v1.0.0)');
  treeProvider.setLogger((msg) => output.appendLine(`[tree] ${msg}`));

  // Status bar item — shows connection state, click to (re)connect.
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'trilium.connect';
  statusBarItem.tooltip = 'Trilium Notes — click to connect';
  statusBarItem.text = '$(debug-disconnect) Trilium';
  statusBarItem.show();

  function updateStatusBar(info: AppInfo | undefined): void {
    if (info) {
      statusBarItem.text = `$(database) Trilium v${info.appVersion}`;
      statusBarItem.tooltip = `Connected to ${getServerUrl()} (v${info.appVersion}) — click to reconnect`;
    } else {
      statusBarItem.text = '$(debug-disconnect) Trilium';
      statusBarItem.tooltip = 'Trilium Notes — not connected, click to connect';
    }
  }

  function updateTreeDescription(info: AppInfo | undefined): void {
    treeView.description = info ? `Trilium v${info.appVersion}` : 'Not connected';
  }

  async function refreshOpenVirtualEditorsAfterReconnect(): Promise<void> {
    const client = treeProvider.getClient();
    if (!client) {
      return;
    }

    const openVirtualDocs = vscode.workspace.textDocuments
      .filter((doc) => doc.uri.scheme === 'trilium-text')
      .flatMap((doc) => {
        const noteId = noteIdFromTriliumTextUri(doc.uri);
        return noteId ? [{ uri: doc.uri, noteId }] : [];
      });
    const openEditorDocs = textEditorProvider.getOpenEditorMetadata()
      .filter((entry) => entry.uri.scheme === 'trilium-text');

    const refreshEntries = new Map<string, { uri: vscode.Uri; noteId: string }>();
    for (const entry of [...openVirtualDocs, ...openEditorDocs]) {
      refreshEntries.set(entry.uri.toString(), entry);
    }

    await Promise.all(Array.from(refreshEntries.values()).map(async (entry) => {
      const { uri, noteId } = entry;
      if (!noteId) {
        return;
      }
      try {
        const note = await client.getNote(noteId);
        const content = await client.getNoteContent(noteId);
        const targetUri = await migrateLegacyTriliumTextTabs(uri, noteId, note.title)
          ?? uri;

        textEditorProvider.setTitleForOpenEditor(targetUri, note.title);
        virtualDocProvider.updateContent(targetUri, content);
        textEditorProvider.pushContentToOpenEditor(targetUri, content);
      } catch {
        // Keep existing content for docs that still cannot be fetched.
      }
    }));
  }

  const treeView = vscode.window.createTreeView('triliumNoteTree', {
    treeDataProvider: treeProvider,
    dragAndDropController: treeProvider,
    showCollapseAll: true,
  });

  const recentNotesView = vscode.window.createTreeView('triliumRecentNotes', {
    treeDataProvider: recentNotesProvider,
    showCollapseAll: false,
  });

  const triliumChatParticipant = vscode.chat.createChatParticipant(
    'trilium-notes.trilium',
    async (request, _chatContext, response, token) => {
      const client = treeProvider.getClient();
      if (!client) {
        const message = 'Trilium is not connected. Run "Trilium: Connect to Trilium Server" first.';
        response.markdown(message);
        return {
          errorDetails: { message },
        };
      }

      const defaultContextNoteId = getPreferredParticipantContextNoteId(treeView, tempFileManager);
      let defaultContextText: string | undefined;
      if (defaultContextNoteId) {
        response.progress('Inspecting current Trilium context…');
        try {
          const contextResult = await vscode.lm.invokeTool('trilium_getNoteContext', {
            toolInvocationToken: request.toolInvocationToken,
            input: {
              noteId: defaultContextNoteId,
              childLimit: 10,
            },
          }, token);
          defaultContextText = toolResultToText(contextResult);
        } catch {
          defaultContextText = undefined;
        }
      }

      const tools = getRegisteredLmTools([
        'trilium_searchNotes',
        'trilium_getNoteContext',
        'trilium_readNote',
        'trilium_listChildren',
        'trilium_stageDraftNotes',
      ]);

      try {
        const result = await runParticipantToolLoop(
          request,
          tools,
          buildParticipantPrompt(request.prompt, request.command, defaultContextNoteId, defaultContextText),
          token,
        );
        response.markdown(result.text || 'No response was produced.');
        for (const sessionId of result.stagedSessionIds) {
          response.button({
            command: 'trilium.confirmDraftSession',
            title: 'Confirm Draft Notes',
            arguments: [sessionId],
          });
          response.button({
            command: 'trilium.discardDraftSession',
            title: 'Discard Draft Notes',
            arguments: [sessionId],
          });
        }
        return {
          metadata: {
            defaultContextNoteId: defaultContextNoteId ?? null,
            command: request.command ?? null,
            stagedSessionIds: result.stagedSessionIds,
          },
        };
      } catch (err) {
        const message = `Trilium participant failed: ${err}`;
        response.markdown(message);
        return {
          errorDetails: { message },
        };
      }
    },
  );
  triliumChatParticipant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'trilium.svg');

  treeView.onDidChangeSelection((e) => {
      const selectedNote = e.selection[0]?.note;
    attributesProvider.showNote(e.selection[0]?.note);
      if (backlinksProvider && selectedNote) {
        backlinksProvider.updateBacklinks(selectedNote.noteId);
      }
  });

  const themeChangeDisposable = vscode.window.onDidChangeActiveColorTheme(() => {
    treeProvider.refreshRoot();
  });

  // Attempt to restore a previously stored connection on activation.
  const initialInfo = await tryConnect(context.secrets, treeProvider);
  updateStatusBar(initialInfo);
  updateTreeDescription(initialInfo);
  void vscode.commands.executeCommand('setContext', 'trilium.connected', !!initialInfo);
  attributesProvider.setClient(treeProvider.getClient());
  ensureBacklinksView();
  if (initialInfo) {
    await refreshOpenVirtualEditorsAfterReconnect();
  }


  const updateActiveNoteContext = () => {
    const activeDoc = vscode.window.activeTextEditor?.document;
    if (!activeDoc) {
      void vscode.commands.executeCommand('setContext', 'trilium.activeNoteId', '');
      void vscode.commands.executeCommand('setContext', 'trilium.activeNoteType', '');
      return;
    }

    const noteId = noteIdFromUri(activeDoc.uri, tempFileManager);
    if (!noteId) {
      void vscode.commands.executeCommand('setContext', 'trilium.activeNoteId', '');
      void vscode.commands.executeCommand('setContext', 'trilium.activeNoteType', '');
      return;
    }

    const activeType = tempFileManager.getNoteType(noteId) ?? '';
    void vscode.commands.executeCommand('setContext', 'trilium.activeNoteId', noteId);
    void vscode.commands.executeCommand('setContext', 'trilium.activeNoteType', activeType);
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateActiveNoteContext));
  updateActiveNoteContext();

  const openNoteAsSource = async (
    note: Note,
    languageId: string,
    formatContent?: (content: string) => string,
  ): Promise<void> => {
    if (note.isProtected) {
      await showProtectedNoteRecoveryActions(note, note.noteId);
      return;
    }

    const client = treeProvider.getClient();
    if (!client) {
      void vscode.window.showErrorMessage('Trilium: Not connected.');
      return;
    }

    const rawContent = await client.getNoteContent(note.noteId);
    const filePath = tempFileManager.getTempPath(note);
    const fileContent = formatContent ? formatContent(rawContent) : rawContent;
    fs.writeFileSync(filePath, fileContent, 'utf8');
    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.languages.setTextDocumentLanguage(doc, languageId);
    await vscode.window.showTextDocument(doc, { preview: false });
    await maybeAutoRevealOpenedNote(note.noteId, treeProvider, treeView);
    recentNotesProvider.trackNote(note);
    if (backlinksProvider) {
      backlinksProvider.updateBacklinks(note.noteId);
    }
    trackNoteForRefresh(note, filePath);
  };

  const openMermaidWysiwyg = async (note: Note): Promise<void> => {
    if (note.isProtected) {
      await showProtectedNoteRecoveryActions(note, note.noteId);
      return;
    }

    const client = treeProvider.getClient();
    if (!client) {
      void vscode.window.showErrorMessage('Trilium: Not connected.');
      return;
    }

    const { panel, isNew } = createOrRevealWebviewPanel(note, 'triliumMermaidEditor');
    setActiveWebviewNoteContext(note.noteId, 'mermaid');

    const mermaidScriptUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'out', 'webviews', 'mermaidEditor.js'),
    );

    if (!isNew) {
      panel.title = note.title;
    }

    let webviewReady = false;
    let queuedContent: string | undefined;
    let queuedBreadcrumb: { parts: BreadcrumbPart[]; backlinksCount: number } | undefined;

    const postBreadcrumb = async (noteId: string): Promise<void> => {
      const breadcrumb = await getBreadcrumbData(client, noteId);
      if (webviewReady) {
        panel.webview.postMessage({ type: 'breadcrumb', ...breadcrumb });
      } else {
        queuedBreadcrumb = breadcrumb;
      }
    };

    const postContent = (content: string): void => {
      if (!isNew) {
        panel.webview.postMessage({ type: 'render', content });
        return;
      }

      if (webviewReady) {
        panel.webview.postMessage({ type: 'render', content });
      } else {
        queuedContent = content;
      }
    };

    const pushLatest = async (): Promise<void> => {
      const latest = await client.getNote(note.noteId);
      const content = await client.getNoteContent(note.noteId);
      panel.title = latest.title;
      await postBreadcrumb(latest.noteId);
      postContent(content);
    };

    if (isNew) {
      panel.webview.html = buildMermaidEditorHtml(panel.webview, mermaidScriptUri);

      const disposable = panel.webview.onDidReceiveMessage(async (msg: MermaidEditorWebviewMessage) => {
        if (msg?.type === 'ready') {
          webviewReady = true;
          if (queuedContent !== undefined) {
            panel.webview.postMessage({ type: 'render', content: queuedContent });
            queuedContent = undefined;
          }
          if (queuedBreadcrumb !== undefined) {
            panel.webview.postMessage({ type: 'breadcrumb', ...queuedBreadcrumb });
            queuedBreadcrumb = undefined;
          }
          return;
        }

        if (msg?.type === 'refresh') {
          try {
            await pushLatest();
          } catch (err) {
            void vscode.window.showErrorMessage(`Trilium: Failed to refresh Mermaid note: ${err}`);
          }
          return;
        }

        if (msg?.type === 'openBreadcrumbNote' && msg.noteId) {
          await vscode.commands.executeCommand('trilium.openNoteById', msg.noteId);
          return;
        }

        if (msg?.type === 'save') {
          try {
            await client.putNoteContent(note.noteId, msg.content ?? '');
            await treeProvider.refreshNoteById(note.noteId);
            panel.webview.postMessage({ type: 'saveResult', success: true });
          } catch (err) {
            panel.webview.postMessage({ type: 'saveResult', success: false, error: String(err) });
          }
        }
      });

      panel.onDidDispose(() => disposable.dispose());
    }

    try {
      await pushLatest();
    } catch (err) {
      if (isNew) {
        panel.dispose();
      }
      void vscode.window.showErrorMessage(`Trilium: Failed to open Mermaid editor: ${err}`);
      return;
    }

    recentNotesProvider.trackNote(note);
    if (backlinksProvider) {
      backlinksProvider.updateBacklinks(note.noteId);
    }
  };

  const openCanvasWysiwyg = async (note: Note): Promise<void> => {
    if (note.isProtected) {
      await showProtectedNoteRecoveryActions(note, note.noteId);
      return;
    }

    const client = treeProvider.getClient();
    if (!client) {
      void vscode.window.showErrorMessage('Trilium: Not connected.');
      return;
    }

    const { panel, isNew } = createOrRevealWebviewPanel(note, 'triliumCanvasEditor');
    setActiveWebviewNoteContext(note.noteId, 'canvas');

    const excalidrawScriptUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'out', 'webviews', 'excalidrawEditor.js'),
    );
    const excalidrawStyleUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'out', 'webviews', 'excalidrawEditor.css'),
    );
    const excalidrawAssetBaseUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'out', 'webviews'),
    );
    if (isNew) {
      panel.webview.html = buildExcalidrawEditorHtml(
        panel.webview,
        excalidrawScriptUri,
        excalidrawStyleUri,
        excalidrawAssetBaseUri,
      );
    } else {
      panel.title = note.title;
    }

    let webviewReady = false;
    let queuedContent: string | undefined;
    let queuedBreadcrumb: { parts: BreadcrumbPart[]; backlinksCount: number } | undefined;

    const postBreadcrumb = async (noteId: string): Promise<void> => {
      const breadcrumb = await getBreadcrumbData(client, noteId);
      if (webviewReady) {
        panel.webview.postMessage({ type: 'breadcrumb', ...breadcrumb });
      } else {
        queuedBreadcrumb = breadcrumb;
      }
    };

    const postContent = (content: string): void => {
      if (!isNew) {
        panel.webview.postMessage({ type: 'render', content });
        return;
      }

      if (webviewReady) {
        panel.webview.postMessage({ type: 'render', content });
      } else {
        queuedContent = content;
      }
    };

    const pushLatest = async (): Promise<void> => {
      const latest = await client.getNote(note.noteId);
      const content = await client.getNoteContent(note.noteId);
      panel.title = latest.title;
      await postBreadcrumb(latest.noteId);
      postContent(content);
    };

    if (isNew) {
      const disposable = panel.webview.onDidReceiveMessage(async (msg: ExcalidrawEditorWebviewMessage) => {
        if (msg?.type === 'ready') {
          webviewReady = true;
          if (queuedContent !== undefined) {
            panel.webview.postMessage({ type: 'render', content: queuedContent });
            queuedContent = undefined;
          }
          if (queuedBreadcrumb !== undefined) {
            panel.webview.postMessage({ type: 'breadcrumb', ...queuedBreadcrumb });
            queuedBreadcrumb = undefined;
          }
          return;
        }

        if (msg?.type === 'refresh') {
          try {
            await pushLatest();
          } catch (err) {
            void vscode.window.showErrorMessage(`Trilium: Failed to refresh canvas note: ${err}`);
          }
          return;
        }

        if (msg?.type === 'openBreadcrumbNote' && msg.noteId) {
          await vscode.commands.executeCommand('trilium.openNoteById', msg.noteId);
          return;
        }

        if (msg?.type === 'save') {
          try {
            await client.putNoteContent(note.noteId, msg.content ?? '');
            await treeProvider.refreshNoteById(note.noteId);
            panel.webview.postMessage({ type: 'saveResult', success: true });
          } catch (err) {
            panel.webview.postMessage({ type: 'saveResult', success: false, error: String(err) });
          }
        }
      });

      panel.onDidDispose(() => disposable.dispose());
    }

    try {
      await pushLatest();
    } catch (err) {
      if (isNew) {
        panel.dispose();
      }
      void vscode.window.showErrorMessage(`Trilium: Failed to open canvas editor: ${err}`);
      return;
    }

    recentNotesProvider.trackNote(note);
    if (backlinksProvider) {
      backlinksProvider.updateBacklinks(note.noteId);
    }
  };

  context.subscriptions.push(
    triliumChatParticipant,
    treeView,
    recentNotesView,
    themeChangeDisposable,
    output,
    statusBarItem,
    vscode.window.registerWebviewViewProvider(AttributesViewProvider.viewId, attributesProvider),

    vscode.commands.registerCommand('trilium.clearRecentNotes', () => {
      recentNotesProvider.clear();
    }),

    vscode.commands.registerCommand('trilium.confirmDraftSession', async (sessionId: string) => {
      const client = treeProvider.getClient();
      const session = draftNoteManager.getSession(sessionId);
      if (!client || !session) {
        void vscode.window.showWarningMessage('Trilium: No staged draft session found.');
        return;
      }

      const drafts = draftNoteManager.listSessionDrafts(sessionId);
      for (const entry of drafts) {
        await textEditorProvider.confirmDraftSave(entry.noteId);
      }
      await treeProvider.refreshNoteById(session.parentNoteId);
      void vscode.window.showInformationMessage(
        `Trilium: Saved ${drafts.length} draft note(s) under "${session.parentTitle}".`,
      );
    }),

    vscode.commands.registerCommand('trilium.discardDraftSession', async (sessionId: string) => {
      const client = treeProvider.getClient();
      const session = draftNoteManager.getSession(sessionId);
      if (!client || !session) {
        void vscode.window.showWarningMessage('Trilium: No staged draft session found.');
        return;
      }

      const drafts = draftNoteManager.listSessionDrafts(sessionId);
      for (const draft of drafts) {
        await revertAndCloseTabForUri(draft.uri, TriliumTextEditorProvider.viewType);
      }
      for (const draft of drafts.slice().reverse()) {
        try {
          await client.deleteNote(draft.noteId);
        } finally {
          draftNoteManager.removeDraft(draft.noteId);
        }
      }
      draftNoteManager.removeSession(sessionId);
      await treeProvider.refreshNoteById(session.parentNoteId);
      void vscode.window.showInformationMessage(
        `Trilium: Discarded ${drafts.length} staged draft note(s).`,
      );
    }),

    vscode.commands.registerCommand('trilium._openBreadcrumbNote', async (noteId: string) => {
      const client = treeProvider.getClient();
      if (!client || !noteId) {
        return;
      }

      try {
        const note = await client.getNote(noteId);
        await openNoteInEditor(
          note,
          client,
          tempFileManager,
          virtualDocProvider,
          treeProvider,
          treeView,
        );
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open breadcrumb note: ${err}`);
      }
    }),

      vscode.commands.registerCommand('trilium.openNoteById', async (noteId: string) => {
        const client = treeProvider.getClient();
        if (!client || !noteId) {
          return;
        }

        try {
          const note = await client.getNote(noteId);
          await openNoteInEditor(
            note,
            client,
            tempFileManager,
            virtualDocProvider,
            treeProvider,
            treeView,
          );
          if (backlinksProvider) {
            backlinksProvider.updateBacklinks(noteId);
          }
        } catch (err) {
          void vscode.window.showErrorMessage(`Trilium: Failed to open note: ${err}`);
        }
      }),

    vscode.commands.registerCommand('trilium.revealInTree', async (item?: NoteItem) => {
      const noteId = item?.note?.noteId ?? getActiveNoteId(tempFileManager);
      if (!noteId) {
        void vscode.window.showWarningMessage(
          'Trilium: No active Trilium note found to reveal.',
        );
        return;
      }

      try {
        const revealed = await revealNoteInTree(noteId, treeProvider, treeView);
        if (!revealed) {
          void vscode.window.showWarningMessage(
            'Trilium: Could not reveal note in tree (note may be outside current root/filter).',
          );
        }
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to reveal note in tree: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.openParent', async (item?: NoteItem) => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage('Trilium: Not connected.');
        return;
      }

      const noteId = item?.note?.noteId ?? getActiveNoteId(tempFileManager);
      if (!noteId) {
        void vscode.window.showWarningMessage(
          'Trilium: No active Trilium note found to open its parent.',
        );
        return;
      }

      try {
        const source = item?.note ?? await client.getNote(noteId);
        const parentId = source.parentNoteIds[0];
        if (!parentId) {
          void vscode.window.showInformationMessage('Trilium: This note has no parent.');
          return;
        }

        const parent = await client.getNote(parentId);
        await openNoteInEditor(
          parent,
          client,
          tempFileManager,
          virtualDocProvider,
          treeProvider,
          treeView,
        );
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open parent note: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.refresh', () => {
      virtualDocProvider.clearAllCache();
      treeProvider.refreshRoot();
    }),

    vscode.commands.registerCommand('trilium.connect', async () => {
      const info = await runConnectWizard(context.secrets, treeProvider);
      updateStatusBar(info);
      updateTreeDescription(info);
      void vscode.commands.executeCommand('setContext', 'trilium.connected', !!info);
      attributesProvider.setClient(treeProvider.getClient());
      ensureBacklinksView();
      virtualDocProvider.clearAllCache();
      if (info) {
        await refreshOpenVirtualEditorsAfterReconnect();
      }
    }),

    vscode.commands.registerCommand('trilium.reconnect', async () => {
      const info = await runConnectWizard(context.secrets, treeProvider);
      updateStatusBar(info);
      updateTreeDescription(info);
      void vscode.commands.executeCommand('setContext', 'trilium.connected', !!info);
      attributesProvider.setClient(treeProvider.getClient());
      ensureBacklinksView();
      virtualDocProvider.clearAllCache();
      if (info) {
        await refreshOpenVirtualEditorsAfterReconnect();
      }
    }),

    vscode.commands.registerCommand('trilium.createNote', async (item?: NoteItem) => {
      interface NoteTypeOption extends vscode.QuickPickItem {
        type: 'text' | 'code' | 'mermaid' | 'canvas' | 'mindMap';
      }
      const NOTE_TYPE_OPTIONS: NoteTypeOption[] = [
        { label: '$(edit) Text Note', type: 'text' },
        { label: '$(code) Code Note', type: 'code' },
        { label: '$(type-hierarchy) Mermaid Diagram', type: 'mermaid' },
        { label: '$(symbol-misc) Canvas (Excalidraw)', type: 'canvas' },
        { label: '$(type-hierarchy-sub) Mind Map', type: 'mindMap' },
      ];
      const typePick = await vscode.window.showQuickPick(NOTE_TYPE_OPTIONS, {
        title: 'New Note — select type',
        ignoreFocusOut: true,
      });
      if (!typePick) { return; }

      if (typePick.type === 'code') {
        const langPick = await vscode.window.showQuickPick(CODE_LANGUAGE_OPTIONS, {
          title: 'Select code language',
          placeHolder: 'Language',
          ignoreFocusOut: true,
        });
        if (!langPick) { return; }
        await createNoteOfType('code', langPick.mime, item, treeProvider, treeView, tempFileManager);
        return;
      }

      const defaults: Partial<Record<NoteTypeOption['type'], string>> = {
        mermaid: 'graph TD\n    A[Start] --> B[End]',
        canvas: JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {} }),
        mindMap: formatMindMapJsonForEditor(
          JSON.stringify({ nodeData: { id: 'root', topic: 'Mind Map', children: [] } }),
        ),
      };
      await createNoteOfType(typePick.type, undefined, item, treeProvider, treeView, tempFileManager,
        defaults[typePick.type] ?? '');
    }),

    vscode.commands.registerCommand('trilium.createNoteText', async (item?: NoteItem) => {
      await createNoteOfType('text', undefined, item, treeProvider, treeView, tempFileManager);
    }),

    vscode.commands.registerCommand('trilium.createNoteCode', async (item?: NoteItem) => {
      const langPick = await vscode.window.showQuickPick(CODE_LANGUAGE_OPTIONS, {
        title: 'Select code language',
        placeHolder: 'Language',
        ignoreFocusOut: true,
      });
      if (!langPick) { return; }
      await createNoteOfType('code', langPick.mime, item, treeProvider, treeView, tempFileManager);
    }),

    vscode.commands.registerCommand('trilium.createNoteMermaid', async (item?: NoteItem) => {
      await createNoteOfType('mermaid', undefined, item, treeProvider, treeView, tempFileManager,
        'graph TD\n    A[Start] --> B[End]');
    }),

    vscode.commands.registerCommand('trilium.createNoteCanvas', async (item?: NoteItem) => {
      await createNoteOfType('canvas', undefined, item, treeProvider, treeView, tempFileManager,
        JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {} }));
    }),

    vscode.commands.registerCommand('trilium.createNoteMindMap', async (item?: NoteItem) => {
      await createNoteOfType('mindMap', undefined, item, treeProvider, treeView, tempFileManager,
        formatMindMapJsonForEditor(
          JSON.stringify({ nodeData: { id: 'root', topic: 'Mind Map', children: [] } }),
        ));
    }),

    vscode.commands.registerCommand('trilium.openMindMap', async (item?: NoteItem) => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage('Trilium: Not connected.');
        return;
      }

      let note = item?.note;
      if (!note) {
        const activeNoteId = getActiveNoteId(tempFileManager);
        if (!activeNoteId) {
          void vscode.window.showWarningMessage('Trilium: No active note found to preview.');
          return;
        }
        note = await client.getNote(activeNoteId);
      }

      if (note.type !== 'mindMap') {
        void vscode.window.showWarningMessage('Trilium: Mind map preview is only available for mindMap notes.');
        return;
      }

      if (note.isProtected) {
        await showProtectedNoteRecoveryActions(note, note.noteId);
        return;
      }

      const { panel, isNew } = createOrRevealWebviewPanel(note, 'triliumMindMapPreview');
      setActiveWebviewNoteContext(note.noteId, 'mindMap');
      if (isNew) {
        panel.webview.html = buildMindMapPreviewHtml(panel.webview, note.title);
      } else {
        panel.title = note.title;
      }

      let webviewReady = false;
      let queuedRenderData: unknown;
      let queuedBreadcrumb: { parts: BreadcrumbPart[]; backlinksCount: number } | undefined;

      const postBreadcrumb = async (noteId: string): Promise<void> => {
        const breadcrumb = await getBreadcrumbData(client, noteId);
        if (webviewReady) {
          panel.webview.postMessage({ type: 'breadcrumb', ...breadcrumb });
        } else {
          queuedBreadcrumb = breadcrumb;
        }
      };

      const postRenderData = (data: unknown): void => {
        if (!isNew) {
          panel.webview.postMessage({ type: 'render', data });
          return;
        }

        if (webviewReady) {
          panel.webview.postMessage({ type: 'render', data });
          return;
        }
        queuedRenderData = data;
      };

      const pushPreviewData = async (): Promise<void> => {
        const latestNote = await client.getNote(note.noteId);
        const rawContent = await client.getNoteContent(note.noteId);
        await postBreadcrumb(latestNote.noteId);
        try {
          const parsed = normalizeMindMapData(rawContent);

          output.appendLine(
            `[mindMap][preview] rendering noteId=${note.noteId} ${summarizeContentForDebug(rawContent)}`,
          );

          panel.title = latestNote.title;
          postRenderData(parsed);
        } catch {
          throw new Error('Mind map content is not valid JSON.');
        }
      };

      if (isNew) {
        const messageDisposable = panel.webview.onDidReceiveMessage(async (msg: MindMapPreviewWebviewMessage) => {
          if (msg?.type === 'ready') {
            webviewReady = true;
            if (queuedRenderData !== undefined) {
              panel.webview.postMessage({ type: 'render', data: queuedRenderData });
              queuedRenderData = undefined;
            }
            if (queuedBreadcrumb !== undefined) {
              panel.webview.postMessage({ type: 'breadcrumb', ...queuedBreadcrumb });
              queuedBreadcrumb = undefined;
            }
            return;
          }

          if (msg?.type === 'save') {
            try {
              const payload = JSON.stringify(msg.data, null, 2);
              await client.putNoteContent(note.noteId, payload);
              // Sync the temp file on disk if it is open in a text editor
              const tempPath = tempFileManager.getTempPath(note);
              if (tempPath) {
                fs.writeFileSync(tempPath, payload, 'utf8');
              }
              await treeProvider.refreshNoteById(note.noteId);
              panel.webview.postMessage({ type: 'saveResult', success: true });
            } catch (err) {
              panel.webview.postMessage({ type: 'saveResult', success: false, error: String(err) });
            }
            return;
          }

          if (msg?.type === 'openBreadcrumbNote' && msg.noteId) {
            await vscode.commands.executeCommand('trilium.openNoteById', msg.noteId);
            return;
          }

          if (msg?.type !== 'refresh') {
            return;
          }
          try {
            await pushPreviewData();
          } catch (err) {
            void vscode.window.showErrorMessage(`Trilium: Failed to refresh mind map preview: ${err}`);
          }
        });

        panel.onDidDispose(() => {
          messageDisposable.dispose();
        });
      }

      try {
        await pushPreviewData();
      } catch (err) {
        if (isNew) {
          panel.dispose();
        }
        void vscode.window.showErrorMessage(`Trilium: Failed to preview mind map: ${err}`);
        return;
      }
    }),

    vscode.commands.registerCommand('trilium.openTodayNote', async () => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage(
          'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
        );
        return;
      }

      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const date = `${year}-${month}-${day}`;

      try {
        const note = await client.getDayNote(date);
        if (note.isProtected) {
          await showProtectedNoteRecoveryActions(note, note.noteId);
          return;
        }

        // Text notes: open with CKEditor custom editor on file-backed temp
        // docs to get native dirty/close behavior.
        if (note.type === 'text') {
          const rawContent = await client.getNoteContent(note.noteId);
          const filePath = tempFileManager.getTextEditorTempPath(note);
          fs.writeFileSync(filePath, rawContent, 'utf8');
          const uri = vscode.Uri.file(filePath);
          TriliumTextEditorProvider.setDocumentMetadata(uri, {
            noteId: note.noteId,
            title: note.title,
          });
          await vscode.commands.executeCommand(
            'vscode.openWith',
            uri,
            TriliumTextEditorProvider.viewType,
          );
          await maybeAutoRevealOpenedNote(note.noteId, treeProvider, treeView);
          return;
        }

        // Non-text notes can open in dedicated WYSIWYG panels when available.
        if (note.type === 'mindMap') {
          await vscode.commands.executeCommand('trilium.openMindMap', new NoteItem(note));
          await maybeAutoRevealOpenedNote(note.noteId, treeProvider, treeView);
          return;
        }

        if (note.type === 'mermaid') {
          await vscode.commands.executeCommand('trilium.openMermaid', new NoteItem(note));
          await maybeAutoRevealOpenedNote(note.noteId, treeProvider, treeView);
          return;
        }

        if (note.type === 'canvas') {
          await vscode.commands.executeCommand('trilium.openCanvas', new NoteItem(note));
          await maybeAutoRevealOpenedNote(note.noteId, treeProvider, treeView);
          return;
        }

        // Other note types: use temp file approach.
        const rawContent = await client.getNoteContent(note.noteId);
        const filePath = tempFileManager.getTempPath(note);
        fs.writeFileSync(filePath, rawContent, 'utf8');
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.languages.setTextDocumentLanguage(doc, tempFileManager.getLanguageId(note));
        await vscode.window.showTextDocument(doc, { preview: false });
        await maybeAutoRevealOpenedNote(note.noteId, treeProvider, treeView);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open today's note: ${err}`);
      }
    }),

    /**
     * Programmatic single-note creation — designed to be called by AI agents via
     * `vscode.commands.executeCommand('trilium.createNoteWithContent', ...)`.
     *
     * Arguments: (parentNoteId: string, title: string, type: string, content: string, mime?: string)
     * Returns: Promise<{ noteId: string }> — throws on error so callers can detect failure.
     */
    vscode.commands.registerCommand(
      'trilium.createNoteWithContent',
      async (parentNoteId: string, title: string, type: string, content: string, mime?: string) => {
        const client = treeProvider.getClient();
        if (!client) {
          throw new Error('Trilium: Not connected.');
        }
        const validTypes = ['text', 'code', 'mermaid', 'canvas'] as const;
        const noteType = (validTypes as readonly string[]).includes(type)
          ? (type as typeof validTypes[number])
          : 'text';
        const normalizedParentId = parentNoteId ?? 'root';
        const result = await client.createNote(normalizedParentId, title, noteType, content, mime);
        await treeProvider.refreshNoteById(normalizedParentId);
        return { noteId: result.note.noteId };
      },
    ),

    /**
     * Bulk recursive note import — designed for AI agents to create entire documentation
     * hierarchies in a single call.
     *
     * Arguments: (parentNoteId?: string, notesJson?: string)
     *
     * `notesJson` must be a JSON array of NoteImportSpec:
     *   [{ title, type?, mime?, content?, children?: [...] }]
     *
     * Returns: Promise<{ created: number }> — total notes created.
     *
     * Example notesJson:
     * [{"title":"Overview","type":"text","content":"<p>Hello</p>","children":[
     *   {"title":"Diagram","type":"mermaid","content":"graph TD\n  A-->B"}
     * ]}]
     */
    vscode.commands.registerCommand(
      'trilium.importNotes',
      async (parentNoteId?: string, notesJson?: string) => {
        const client = treeProvider.getClient();
        if (!client) {
          void vscode.window.showErrorMessage('Trilium: Not connected.');
          return { created: 0 };
        }

        let json = notesJson;
        if (!json) {
          json = await vscode.window.showInputBox({
            title: 'Import Notes — paste JSON array',
            placeHolder: '[{"title":"My Note","type":"text","content":"<p>Hello</p>"}]',
            ignoreFocusOut: true,
          });
          if (!json) { return { created: 0 }; }
        }

        let specs: NoteImportSpec[];
        try {
          specs = JSON.parse(json) as NoteImportSpec[];
          if (!Array.isArray(specs)) { throw new Error('Expected a JSON array'); }
        } catch (err) {
          void vscode.window.showErrorMessage(`Trilium: Invalid JSON — ${err}`);
          return { created: 0 };
        }

        const rootId = parentNoteId ?? 'root';
        try {
          const count = await importNotesRecursive(client, rootId, specs);
          await treeProvider.refreshNoteById(rootId);
          void vscode.window.showInformationMessage(`Trilium: Imported ${count} note(s).`);
          return { created: count };
        } catch (err) {
          void vscode.window.showErrorMessage(`Trilium: Import failed — ${err}`);
          return { created: 0 };
        }
      },
    ),

    // Language Model Tools — discovered automatically by Copilot Chat for all
    // users who install the extension. No copilot-instructions.md required.

    vscode.lm.registerTool<{
      parentNoteId?: string;
      title: string;
      type: string;
      content: string;
      mime?: string;
    }>('trilium_createNote', {
      prepareInvocation(_options) {
        return { invocationMessage: 'Creating Trilium note…' };
      },
      async invoke(options, _token) {
        const { parentNoteId, title, type, content, mime } = options.input;
        const client = treeProvider.getClient();
        if (!client) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: Trilium is not connected. Ask the user to run "Trilium: Connect to Trilium Server" first.'),
          ]);
        }
        const validTypes = ['text', 'code', 'mermaid', 'canvas'] as const;
        const noteType = (validTypes as readonly string[]).includes(type)
          ? (type as typeof validTypes[number])
          : 'text';
        try {
          const normalizedParentId = parentNoteId ?? 'root';
          const result = await client.createNote(normalizedParentId, title, noteType, content, mime);
          await treeProvider.refreshNoteById(normalizedParentId);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Created note "${title}" with id "${result.note.noteId}" under parent "${parentNoteId ?? 'root'}".`,
            ),
          ]);
        } catch (err) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Error creating note: ${err}`),
          ]);
        }
      },
    }),

    vscode.lm.registerTool<{
      parentNoteId?: string;
      notes: NoteImportSpec[];
    }>('trilium_importNotes', {
      prepareInvocation(options) {
        const count = options.input.notes?.length ?? 0;
        return { invocationMessage: `Importing ${count} top-level note(s) into Trilium…` };
      },
      async invoke(options, _token) {
        const { parentNoteId, notes } = options.input;
        const client = treeProvider.getClient();
        if (!client) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: Trilium is not connected. Ask the user to run "Trilium: Connect to Trilium Server" first.'),
          ]);
        }
        if (!Array.isArray(notes) || notes.length === 0) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: "notes" must be a non-empty array.'),
          ]);
        }
        try {
          const normalizedParentId = parentNoteId ?? 'root';
          const count = await importNotesRecursive(client, normalizedParentId, notes);
          await treeProvider.refreshNoteById(normalizedParentId);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Successfully created ${count} note(s) under parent "${parentNoteId ?? 'root'}".`,
            ),
          ]);
        } catch (err) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Error importing notes: ${err}`),
          ]);
        }
      },
    }),

    vscode.lm.registerTool<{
      parentNoteId: string;
      notes: DraftNoteSpec[];
    }>('trilium_stageDraftNotes', {
      prepareInvocation(options) {
        const count = options.input.notes?.length ?? 0;
        return { invocationMessage: `Staging ${count} Trilium draft note(s)…` };
      },
      async invoke(options, _token) {
        const { parentNoteId, notes } = options.input;
        const client = treeProvider.getClient();
        if (!client) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: Trilium is not connected. Ask the user to run "Trilium: Connect to Trilium Server" first.'),
          ]);
        }
        if (!parentNoteId) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: "parentNoteId" is required when staging draft notes.'),
          ]);
        }
        if (!Array.isArray(notes) || notes.length === 0) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: "notes" must be a non-empty array.'),
          ]);
        }

        try {
          const parent = await client.getNote(parentNoteId);
          const session = draftNoteManager.createSession(parentNoteId, parent.title);
          const createdEntries = await stageDraftNotesRecursive(
            client,
            parentNoteId,
            notes,
            session.sessionId,
            tempFileManager,
            textEditorProvider,
            draftNoteManager,
          );
          await treeProvider.refreshNoteById(parentNoteId);
          const summary = createdEntries
            .map((entry) => `- ${entry.title} (${entry.noteId})`)
            .join('\n');
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Staged ${createdEntries.length} Trilium draft child note(s) under "${parent.title}". Draft session id: ${session.sessionId}\n${summary}`,
            ),
          ]);
        } catch (err) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Error staging draft notes: ${err}`),
          ]);
        }
      },
    }),

    vscode.lm.registerTool<{
      query: string;
      ancestorNoteId?: string;
      limit?: number;
    }>('trilium_searchNotes', {
      prepareInvocation(options) {
        return { invocationMessage: `Searching Trilium for "${options.input.query}"…` };
      },
      async invoke(options, _token) {
        const { query, ancestorNoteId, limit } = options.input;
        const client = treeProvider.getClient();
        if (!client) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: Trilium is not connected. Ask the user to run "Trilium: Connect to Trilium Server" first.'),
          ]);
        }
        try {
          const { results } = await client.searchNotes(query, {
            ancestorNoteId,
            limit: limit ?? 20,
          });
          const items = await Promise.all(
            results.map(async (n) => {
              const context = await buildNoteContext(client, n.noteId, 0);
              return {
                noteId: n.noteId,
                title: n.title,
                type: n.type,
                path: context.pathTitles.join(' / '),
                parentNoteId: n.parentNoteIds[0] ?? '',
              };
            }),
          );
          if (items.length === 0) {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(`No notes found matching "${query}".`),
            ]);
          }
          const text = items.map(i =>
            `- noteId: ${i.noteId} | title: "${i.title}" | type: ${noteTypeToLabel(i.type)} | path: "${i.path}" | parentNoteId: ${i.parentNoteId || 'none'}`,
          ).join('\n');
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Found ${items.length} note(s):\n${text}`),
          ]);
        } catch (err) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Error searching notes: ${err}`),
          ]);
        }
      },
    }),

    vscode.lm.registerTool<{
      noteId: string;
      childLimit?: number;
    }>('trilium_getNoteContext', {
      prepareInvocation(options) {
        return { invocationMessage: `Gathering Trilium context for "${options.input.noteId}"…` };
      },
      async invoke(options, _token) {
        const { noteId, childLimit } = options.input;
        const client = treeProvider.getClient();
        if (!client) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: Trilium is not connected. Ask the user to run "Trilium: Connect to Trilium Server" first.'),
          ]);
        }

        try {
          const context = await buildNoteContext(client, noteId, childLimit ?? 12);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(formatNoteContextForLm(context)),
          ]);
        } catch (err) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Error getting note context: ${err}`),
          ]);
        }
      },
    }),

    vscode.lm.registerTool<{
      noteId: string;
    }>('trilium_readNote', {
      prepareInvocation(options) {
        return { invocationMessage: `Reading Trilium note "${options.input.noteId}"…` };
      },
      async invoke(options, _token) {
        const { noteId } = options.input;
        const client = treeProvider.getClient();
        if (!client) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: Trilium is not connected. Ask the user to run "Trilium: Connect to Trilium Server" first.'),
          ]);
        }
        try {
          const note = await client.getNote(noteId);
          if (note.isProtected) {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(protectedNoteToolError(noteId, 'read')),
            ]);
          }
          const raw = await client.getNoteContent(noteId);
          const context = await buildNoteContext(client, noteId, 0);
          const plain = stripHtmlForLm(raw);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Title: ${note.title}\nType: ${note.type}\nPath: ${context.pathTitles.join(' / ')}\n\nContent:\n${plain}`,
            ),
          ]);
        } catch (err) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Error reading note: ${err}`),
          ]);
        }
      },
    }),

    vscode.lm.registerTool<{
      noteId: string;
    }>('trilium_listChildren', {
      prepareInvocation(options) {
        return { invocationMessage: `Listing children of Trilium note "${options.input.noteId}"…` };
      },
      async invoke(options, _token) {
        const { noteId } = options.input;
        const client = treeProvider.getClient();
        if (!client) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: Trilium is not connected. Ask the user to run "Trilium: Connect to Trilium Server" first.'),
          ]);
        }
        try {
          const note = await client.getNote(noteId);
          if (note.childNoteIds.length === 0) {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(`Note "${noteId}" ("${note.title}") has no children.`),
            ]);
          }
          const children = await Promise.all(note.childNoteIds.map(id => client.getNote(id)));
          const text = children.map(c =>
            `- noteId: ${c.noteId} | title: "${c.title}" | type: ${c.type}`,
          ).join('\n');
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Children of "${note.title}" (${children.length}):\n${text}`,
            ),
          ]);
        } catch (err) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Error listing children: ${err}`),
          ]);
        }
      },
    }),

    vscode.lm.registerTool<{
      noteId: string;
      content: string;
    }>('trilium_updateNoteContent', {
      prepareInvocation(options) {
        return { invocationMessage: `Updating Trilium note "${options.input.noteId}"…` };
      },
      async invoke(options, _token) {
        const { noteId, content } = options.input;
        const client = treeProvider.getClient();
        if (!client) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: Trilium is not connected. Ask the user to run "Trilium: Connect to Trilium Server" first.'),
          ]);
        }

        try {
          const note = await client.getNote(noteId);
          if (note.isProtected) {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(protectedNoteToolError(noteId, 'modified')),
            ]);
          }

          await client.putNoteContent(noteId, content);
          await treeProvider.refreshNoteById(noteId);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Updated note "${note.title}" (${noteId}) with ${content.length} characters of content.`,
            ),
          ]);
        } catch (err) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Error updating note content: ${err}`),
          ]);
        }
      },
    }),

    vscode.lm.registerTool<{
      noteId: string;
      content: string;
      separator?: string;
    }>('trilium_appendToNote', {
      prepareInvocation(options) {
        return { invocationMessage: `Appending to Trilium note "${options.input.noteId}"…` };
      },
      async invoke(options, _token) {
        const { noteId, content, separator } = options.input;
        const client = treeProvider.getClient();
        if (!client) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: Trilium is not connected. Ask the user to run "Trilium: Connect to Trilium Server" first.'),
          ]);
        }

        try {
          const note = await client.getNote(noteId);
          if (note.isProtected) {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(protectedNoteToolError(noteId, 'modified')),
            ]);
          }

          const existing = await client.getNoteContent(noteId);
          const defaultSeparator = note.type === 'text' ? '' : '\n';
          const joiner = separator ?? defaultSeparator;
          const merged = existing.length === 0 ? content : `${existing}${joiner}${content}`;

          await client.putNoteContent(noteId, merged);
          await treeProvider.refreshNoteById(noteId);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Appended content to note "${note.title}" (${noteId}). New content length: ${merged.length} characters.`,
            ),
          ]);
        } catch (err) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Error appending to note: ${err}`),
          ]);
        }
      },
    }),

    vscode.commands.registerCommand('trilium.openInBrowser', async (item: NoteItem) => {
      await openNoteInBrowser(item.note, item.path, false);
    }),

    vscode.commands.registerCommand('trilium.openInBrowserExternal', async (item: NoteItem) => {
      await openNoteInBrowser(item.note, item.path, true);
    }),

    vscode.commands.registerCommand('trilium.openFile', async (item: NoteItem) => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage(
          'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
        );
        return;
      }

      try {
        const content = await client.getNoteContentBuffer(item.note.noteId);
        const fallbackExt = mimeToExt(item.note.mime) ?? '.bin';
        const titleHasExt = /\.[a-z0-9]+$/i.test(item.note.title);
        const filename = titleHasExt
          ? item.note.title
          : `${item.note.title}${fallbackExt}`;
        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const dir = vscode.Uri.file(path.join(os.tmpdir(), 'vscode-trilium-files'));
        await vscode.workspace.fs.createDirectory(dir);
        const target = vscode.Uri.joinPath(dir, `${item.note.noteId}-${safeName}`);
        await vscode.workspace.fs.writeFile(target, new Uint8Array(content));
        await vscode.commands.executeCommand('vscode.open', target);
        recentNotesProvider.trackNote(item.note);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open file note: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.downloadFile', async (item: NoteItem) => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage(
          'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
        );
        return;
      }

      const { note } = item;
      const defaultFileName = note.title.includes('.') ? note.title : note.title + (mimeToExt(note.mime) ?? '');
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultFileName),
        saveLabel: 'Download',
      });
      if (!saveUri) { return; }

      try {
        const buffer = await client.getNoteContentBuffer(note.noteId);
        fs.writeFileSync(saveUri.fsPath, Buffer.from(buffer));
        void vscode.window.showInformationMessage(`Trilium: Downloaded "${note.title}" to ${saveUri.fsPath}`);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to download file: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.renameNote', async (item?: NoteItem) => {
      const target = item ?? treeView.selection[0];
      if (!target) {
        return;
      }

      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage(
          'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
        );
        return;
      }

      const newTitle = await vscode.window.showInputBox({
        prompt: 'Rename note',
        value: target.note.title,
        ignoreFocusOut: true,
      });
      if (!newTitle || newTitle === target.note.title) {
        return;
      }

      try {
        await client.patchNote(target.note.noteId, { title: newTitle });
        await treeProvider.refreshNoteById(target.note.noteId);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to rename note: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.deleteNote', async (item?: NoteItem) => {
      const target = item ?? treeView.selection[0];
      if (!target) {
        return;
      }

      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage(
          'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
        );
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Delete "${target.note.title}"? This cannot be undone.`,
        { modal: true },
        'Delete',
      );
      if (confirm !== 'Delete') {
        return;
      }

      try {
        await client.deleteNote(target.note.noteId);
        // Close any editor that has this note's temp file open.
        const removedPath = tempFileManager.removeTempFile(target.note.noteId);
        tempFileManager.removeTextEditorTempFile(target.note.noteId);
        if (removedPath) {
          const fileUri = vscode.Uri.file(removedPath);
          for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
              if (tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === fileUri.fsPath) {
                await vscode.window.tabGroups.close(tab);
              }
            }
          }
        }
        const pathParts = target.path.split('/').filter(Boolean);
        const parentNoteId = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : 'root';
        await treeProvider.refreshNoteById(parentNoteId);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to delete note: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.openNote', async (item: NoteItem) => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage(
          'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
        );
        return;
      }

      const { note } = item;
      const editableTypes: Note['type'][] = ['text', 'code', 'mermaid', 'canvas', 'mindMap'];
      if (!(editableTypes as string[]).includes(note.type)) {
        const action = await vscode.window.showWarningMessage(
          `Trilium: "${note.title}" (${note.type}) cannot be rendered natively.`,
          'Open in Browser',
          'Open in External Browser',
        );
        if (action === 'Open in Browser') {
          await vscode.commands.executeCommand('trilium.openInBrowser', item);
        } else if (action === 'Open in External Browser') {
          await vscode.commands.executeCommand('trilium.openInBrowserExternal', item);
        }
        return;
      }

      if (note.isProtected) {
        await showProtectedNoteRecoveryActions(note, item.path);
        return;
      }

      try {
        // Text notes: open with CKEditor custom editor on a file-backed temp
        // document so VS Code provides native dirty/close warning behavior.
        if (note.type === 'text') {
          const rawContent = await client.getNoteContent(note.noteId);
          const uri = createVirtualDocumentUri(note.noteId, note.title);
          virtualDocProvider.updateContent(uri, rawContent);
          TriliumTextEditorProvider.setDocumentMetadata(uri, {
            noteId: note.noteId,
            title: note.title,
          });
          await vscode.commands.executeCommand(
            'vscode.openWith',
            uri,
            TriliumTextEditorProvider.viewType,
          );
          await maybeAutoRevealOpenedNote(note.noteId, treeProvider, treeView);
          recentNotesProvider.trackNote(note);
            if (backlinksProvider) {
              backlinksProvider.updateBacklinks(note.noteId);
            }
          return;
        }

        // Non-text notes can open in dedicated WYSIWYG panels when available.
        if (note.type === 'mindMap') {
          await vscode.commands.executeCommand('trilium.openMindMap', item);
          return;
        }

        if (note.type === 'mermaid') {
          await vscode.commands.executeCommand('trilium.openMermaid', item);
          return;
        }

        if (note.type === 'canvas') {
          await vscode.commands.executeCommand('trilium.openCanvas', item);
          return;
        }

        const rawContent = await client.getNoteContent(note.noteId);
        const filePath = tempFileManager.getTempPath(note);
        const fileContent = rawContent;
        fs.writeFileSync(filePath, fileContent, 'utf8');

        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.languages.setTextDocumentLanguage(
          doc,
          tempFileManager.getLanguageId(note),
        );
        await vscode.window.showTextDocument(doc, { preview: false });
        await maybeAutoRevealOpenedNote(note.noteId, treeProvider, treeView);
        recentNotesProvider.trackNote(note);
          if (backlinksProvider) {
            backlinksProvider.updateBacklinks(note.noteId);
          }
        trackNoteForRefresh(note, filePath);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open note: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.openMindMapJson', async (item?: NoteItem) => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage('Trilium: Not connected.');
        return;
      }

      let note = item?.note;
      if (!note) {
        const activeNoteId = getActiveNoteId(tempFileManager);
        if (!activeNoteId) {
          void vscode.window.showWarningMessage('Trilium: No active mind map note found.');
          return;
        }
        note = await client.getNote(activeNoteId);
      }

      if (note.type !== 'mindMap') {
        void vscode.window.showWarningMessage('Trilium: This command is only available for mind map notes.');
        return;
      }

      if (note.isProtected) {
        await showProtectedNoteRecoveryActions(note, note.noteId);
        return;
      }

      try {
        const rawContent = await client.getNoteContent(note.noteId);
        const filePath = tempFileManager.getTempPath(note);
        output.appendLine(
          `[mindMap][openJson] writing content noteId=${note.noteId} path=${filePath} ${summarizeContentForDebug(rawContent)}`,
        );
        fs.writeFileSync(filePath, formatMindMapJsonForEditor(rawContent), 'utf8');
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.languages.setTextDocumentLanguage(doc, 'json');
        await vscode.window.showTextDocument(doc, { preview: false });
        await maybeAutoRevealOpenedNote(note.noteId, treeProvider, treeView);
        recentNotesProvider.trackNote(note);
        if (backlinksProvider) {
          backlinksProvider.updateBacklinks(note.noteId);
        }
        trackNoteForRefresh(note, filePath);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open mind map JSON: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.openMermaid', async (item?: NoteItem) => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage('Trilium: Not connected.');
        return;
      }

      let note = item?.note;
      if (!note) {
        const activeNoteId = getActiveNoteId(tempFileManager);
        if (!activeNoteId) {
          void vscode.window.showWarningMessage('Trilium: No active Mermaid note found.');
          return;
        }
        note = await client.getNote(activeNoteId);
      }

      if (note.type !== 'mermaid') {
        void vscode.window.showWarningMessage('Trilium: This command is only available for Mermaid notes.');
        return;
      }

      await openMermaidWysiwyg(note);
    }),

    vscode.commands.registerCommand('trilium.openMermaidSource', async (item?: NoteItem) => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage('Trilium: Not connected.');
        return;
      }

      let note = item?.note;
      if (!note) {
        const activeNoteId = getActiveNoteId(tempFileManager);
        if (!activeNoteId) {
          void vscode.window.showWarningMessage('Trilium: No active Mermaid note found.');
          return;
        }
        note = await client.getNote(activeNoteId);
      }

      if (note.type !== 'mermaid') {
        void vscode.window.showWarningMessage('Trilium: This command is only available for Mermaid notes.');
        return;
      }

      try {
        await openNoteAsSource(note, 'mermaid');
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open Mermaid source: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.openCanvas', async (item?: NoteItem) => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage('Trilium: Not connected.');
        return;
      }

      let note = item?.note;
      if (!note) {
        const activeNoteId = getActiveNoteId(tempFileManager);
        if (!activeNoteId) {
          void vscode.window.showWarningMessage('Trilium: No active canvas note found.');
          return;
        }
        note = await client.getNote(activeNoteId);
      }

      if (note.type !== 'canvas') {
        void vscode.window.showWarningMessage('Trilium: This command is only available for canvas notes.');
        return;
      }

      await openCanvasWysiwyg(note);
    }),

    vscode.commands.registerCommand('trilium.openCanvasJson', async (item?: NoteItem) => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage('Trilium: Not connected.');
        return;
      }

      let note = item?.note;
      if (!note) {
        const activeNoteId = getActiveNoteId(tempFileManager);
        if (!activeNoteId) {
          void vscode.window.showWarningMessage('Trilium: No active canvas note found.');
          return;
        }
        note = await client.getNote(activeNoteId);
      }

      if (note.type !== 'canvas') {
        void vscode.window.showWarningMessage('Trilium: This command is only available for canvas notes.');
        return;
      }

      try {
        await openNoteAsSource(note, 'json', formatJsonForEditor);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open canvas JSON: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.openNoteAsMarkdown', async (item: NoteItem) => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage(
          'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
        );
        return;
      }

      const { note } = item;
      if (note.type !== 'text') {
        void vscode.window.showWarningMessage(
          `Trilium: "Open as Markdown" is only available for text notes.`,
        );
        return;
      }

      if (note.isProtected) {
        await showProtectedNoteRecoveryActions(note, item.path);
        return;
      }

      try {
        // Use old Markdown conversion approach for fallback editing
        const rawContent = await client.getNoteContent(note.noteId);
        const filePath = tempFileManager.getTempPath(note);
        const fileContent = tempFileManager.htmlToMarkdown(rawContent);

        fs.writeFileSync(filePath, fileContent, 'utf8');

        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.languages.setTextDocumentLanguage(doc, 'markdown');
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open note as Markdown: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.openNoteAsHtml', async (item: NoteItem) => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage(
          'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
        );
        return;
      }

      try {
        const rawContent = await client.getNoteContent(item.note.noteId);
        const filePath = tempFileManager.getHtmlTempPath(item.note);
        fs.writeFileSync(filePath, rawContent, 'utf8');
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.languages.setTextDocumentLanguage(doc, 'html');
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open note as HTML: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.searchNotes', async () => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage(
          'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
        );
        return;
      }

      interface SearchItem extends vscode.QuickPickItem { note: Note; }

      const qp = vscode.window.createQuickPick<SearchItem>();
      qp.title = 'Search Trilium Notes';
      qp.placeholder = 'Type to search…';
      qp.matchOnDescription = true;

      let debounceTimer: ReturnType<typeof setTimeout> | undefined;

      qp.onDidChangeValue((query) => {
        if (debounceTimer) { clearTimeout(debounceTimer); }
        if (!query.trim()) { qp.items = []; return; }
        qp.busy = true;
        debounceTimer = setTimeout(async () => {
          try {
            const { results } = await client.searchNotes(query, { limit: 50 });
            qp.items = results.map((note) => ({
              label: `$(${preferredCodiconForNote(note)}) ${note.title}`,
              description: noteTypeToLabel(note.type),
              detail: note.parentNoteIds[0],
              note,
            }));
          } catch {
            qp.items = [];
          } finally {
            qp.busy = false;
          }
        }, 300);
      });

      qp.onDidAccept(async () => {
        const [item] = qp.selectedItems;
        if (!item) { return; }
        qp.hide();
        try {
          await openNoteInEditor(
            item.note,
            client,
            tempFileManager,
            virtualDocProvider,
            treeProvider,
            treeView,
          );
        } catch (err) {
          void vscode.window.showErrorMessage(`Trilium: Failed to open note: ${err}`);
        }
      });

      qp.onDidHide(() => {
        if (debounceTimer) { clearTimeout(debounceTimer); }
        qp.dispose();
      });

      qp.show();
    }),

    vscode.commands.registerCommand('trilium.filterTree', async () => {
      const current = treeProvider.getFilter();
      const query = await vscode.window.showInputBox({
        title: 'Filter Notes Tree',
        prompt: 'Show only notes whose title contains this text (server search)',
        placeHolder: 'Filter by title…',
        value: current,
        ignoreFocusOut: true,
      });
      if (query === undefined) { return; } // user cancelled
      treeProvider.setFilter(query);
      await vscode.commands.executeCommand('setContext', 'trilium.treeFiltered', query.length > 0);
    }),

    vscode.commands.registerCommand('trilium.clearTreeFilter', async () => {
      treeProvider.clearFilter();
      await vscode.commands.executeCommand('setContext', 'trilium.treeFiltered', false);
    }),

    vscode.commands.registerCommand('trilium.copyNoteId', async (item: NoteItem) => {
      await vscode.env.clipboard.writeText(item.note.noteId);
      vscode.window.setStatusBarMessage(`Trilium: Copied note ID "${item.note.noteId}"`, 3000);
    }),

    vscode.commands.registerCommand('trilium.copyNoteUrl', async (item: NoteItem) => {
      const serverUrl = getServerUrl().replace(/\/$/, '');
      const url = `${serverUrl}/#${item.path}`;
      await vscode.env.clipboard.writeText(url);
      vscode.window.setStatusBarMessage(`Trilium: Copied URL for "${item.note.title}"`, 3000);
    }),

    vscode.commands.registerCommand('trilium.viewAttributes', async (item?: NoteItem) => {
      const target = item ?? treeView.selection[0];
      if (!target) {
        return;
      }
      attributesProvider.showNote(target.note);
      await vscode.commands.executeCommand('triliumNoteAttributes.focus');
    }),

    vscode.commands.registerCommand('trilium.openCalendarNote', async () => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage(
          'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
        );
        return;
      }

      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      // ISO 8601 week number
      const startOfYear = new Date(year, 0, 1);
      const weekNum = Math.ceil(
        ((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7,
      );
      const weekStr = `${year}-W${String(weekNum).padStart(2, '0')}`;

      interface CalendarOption extends vscode.QuickPickItem { key: string; }
      const options: CalendarOption[] = [
        { label: '$(calendar) Today\'s Note', description: `${year}-${month}-${day}`, key: 'day' },
        { label: '$(calendar-clock) Inbox Note', description: `Respects #inbox label`, key: 'inbox' },
        { label: '$(list-unordered) This Week\'s Note', description: weekStr, key: 'week' },
        { label: '$(list-ordered) This Month\'s Note', description: `${year}-${month}`, key: 'month' },
        { label: '$(calendar-alt) This Year\'s Note', description: String(year), key: 'year' },
      ];

      const pick = await vscode.window.showQuickPick(options, {
        title: 'Open Calendar Note',
        placeHolder: 'Select time period',
      });
      if (!pick) { return; }

      try {
        let note: import('./etapiClient').Note;
        switch (pick.key) {
          case 'day':   note = await client.getDayNote(`${year}-${month}-${day}`); break;
          case 'inbox': note = await client.getInboxNote(`${year}-${month}-${day}`); break;
          case 'week':  note = await client.getWeekNote(weekStr); break;
          case 'month': note = await client.getMonthNote(`${year}-${month}`); break;
          case 'year':  note = await client.getYearNote(String(year)); break;
          default: return;
        }
        await openNoteInEditor(
          note,
          client,
          tempFileManager,
          virtualDocProvider,
          treeProvider,
          treeView,
        );
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open calendar note: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.openInboxNote', async () => {
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage('Trilium: Not connected.');
        return;
      }
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      try {
        const note = await client.getInboxNote(date);
        await openNoteInEditor(
          note,
          client,
          tempFileManager,
          virtualDocProvider,
          treeProvider,
          treeView,
        );
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open inbox note: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.openWeekNote', async () => {
      const client = treeProvider.getClient();
      if (!client) { void vscode.window.showErrorMessage('Trilium: Not connected.'); return; }
      const now = new Date();
      const year = now.getFullYear();
      const startOfYear = new Date(year, 0, 1);
      const weekNum = Math.ceil(
        ((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7,
      );
      const week = `${year}-W${String(weekNum).padStart(2, '0')}`;
      try {
        const note = await client.getWeekNote(week);
        await openNoteInEditor(
          note,
          client,
          tempFileManager,
          virtualDocProvider,
          treeProvider,
          treeView,
        );
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open week note: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.openMonthNote', async () => {
      const client = treeProvider.getClient();
      if (!client) { void vscode.window.showErrorMessage('Trilium: Not connected.'); return; }
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      try {
        const note = await client.getMonthNote(month);
        await openNoteInEditor(
          note,
          client,
          tempFileManager,
          virtualDocProvider,
          treeProvider,
          treeView,
        );
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open month note: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.openYearNote', async () => {
      const client = treeProvider.getClient();
      if (!client) { void vscode.window.showErrorMessage('Trilium: Not connected.'); return; }
      try {
        const note = await client.getYearNote(String(new Date().getFullYear()));
        await openNoteInEditor(
          note,
          client,
          tempFileManager,
          virtualDocProvider,
          treeProvider,
          treeView,
        );
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to open year note: ${err}`);
      }
    }),

    // -----------------------------------------------------------------------
    // Revision history
    // -----------------------------------------------------------------------

    vscode.commands.registerCommand('trilium.showRevisions', async (item?: NoteItem) => {
      const target = item ?? treeView.selection[0];
      if (!target) { return; }
      const client = treeProvider.getClient();
      if (!client) {
        void vscode.window.showErrorMessage('Trilium: Not connected.');
        return;
      }

      let revisions: Revision[];
      try {
        revisions = await client.getNoteRevisions(target.note.noteId);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to load revisions: ${err}`);
        return;
      }

      if (revisions.length === 0) {
        void vscode.window.showInformationMessage(
          `"${target.note.title}" has no saved revisions.`,
        );
        return;
      }

      // Most recent first
      revisions.sort((a, b) => b.utcDateLastEdited.localeCompare(a.utcDateLastEdited));

      interface RevisionItem extends vscode.QuickPickItem { revision: Revision; }
      const OPEN_BTN: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon('go-to-file'),
        tooltip: 'Open in tab',
      };
      const DIFF_BTN: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon('diff'),
        tooltip: 'Diff against current',
      };

      const items: RevisionItem[] = revisions.map((r) => ({
        label: r.title,
        description: r.dateLastEdited,
        detail: r.contentLength > 0 ? `${r.contentLength} bytes` : undefined,
        revision: r,
        buttons: [OPEN_BTN, DIFF_BTN],
      }));

      const qp = vscode.window.createQuickPick<RevisionItem>();
      qp.title = `Revisions — ${target.note.title}`;
      qp.items = items;
      qp.placeholder = 'Select revision · $(go-to-file) open · $(diff) diff against current';

      const openRevision = async (r: Revision, diff: boolean) => {
        qp.busy = true;
        try {
          const content = await client.getRevisionContent(r.revisionId);
          revisionContentMap.set(`/${r.revisionId}`, content);
          const revUri = vscode.Uri.parse(`trilium-revision:/${r.revisionId}`);
          if (!diff) {
            await vscode.window.showTextDocument(revUri, { preview: true });
          } else {
            const currentContent = await client.getNoteContent(target.note.noteId);
            revisionContentMap.set(`/current-${target.note.noteId}`, currentContent);
            const curUri = vscode.Uri.parse(`trilium-revision:/current-${target.note.noteId}`);
            await vscode.commands.executeCommand(
              'vscode.diff', revUri, curUri,
              `${r.title} (${r.dateLastEdited}) ↔ Current`,
            );
          }
        } catch (err) {
          void vscode.window.showErrorMessage(`Trilium: Failed to load revision: ${err}`);
        } finally {
          qp.busy = false;
        }
      };

      qp.onDidTriggerItemButton(async ({ item: picked, button }) => {
        qp.hide();
        await openRevision(picked.revision, button === DIFF_BTN);
      });

      qp.onDidAccept(async () => {
        const [picked] = qp.selectedItems;
        if (!picked) { return; }
        qp.hide();
        await openRevision(picked.revision, false);
      });

      qp.onDidHide(() => qp.dispose());
      qp.show();
    }),

    // -----------------------------------------------------------------------
    // Clone & move notes
    // -----------------------------------------------------------------------

    vscode.commands.registerCommand('trilium.cloneNote', async (item?: NoteItem) => {
      const target = item ?? treeView.selection[0];
      if (!target) { return; }
      const client = treeProvider.getClient();
      if (!client) { void vscode.window.showErrorMessage('Trilium: Not connected.'); return; }

      const destination = await pickDestinationNote(client, `Clone "${target.note.title}" to…`);
      if (!destination) { return; }

      try {
        await client.createBranch(target.note.noteId, destination.noteId);
        await client.refreshNoteOrdering(destination.noteId);
        await treeProvider.refreshNoteById(destination.noteId);
        void vscode.window.showInformationMessage(
          `Cloned "${target.note.title}" into "${destination.title}".`,
        );
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Clone failed: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.moveNote', async (item?: NoteItem) => {
      const target = item ?? treeView.selection[0];
      if (!target) { return; }
      const client = treeProvider.getClient();
      if (!client) { void vscode.window.showErrorMessage('Trilium: Not connected.'); return; }

      if (!target.branchId) {
        void vscode.window.showErrorMessage(
          `Trilium: Cannot determine the branch for this tree item. Right-click the note in the tree.`,
        );
        return;
      }

      const destination = await pickDestinationNote(client, `Move "${target.note.title}" to…`);
      if (!destination) { return; }

      // Determine the old parent noteId from the tree path
      const pathParts = target.path.split('/');
      const oldParentNoteId = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : undefined;

      if (oldParentNoteId && oldParentNoteId === destination.noteId) {
        void vscode.window.showInformationMessage('Trilium: Note is already under that parent.');
        return;
      }

      try {
        await client.createBranch(target.note.noteId, destination.noteId);
        await client.deleteBranch(target.branchId);
        await client.refreshNoteOrdering(destination.noteId);
        if (oldParentNoteId) {
          await client.refreshNoteOrdering(oldParentNoteId);
          await treeProvider.refreshNoteById(oldParentNoteId);
        }
        await treeProvider.refreshNoteById(destination.noteId);
        void vscode.window.showInformationMessage(
          `Moved "${target.note.title}" to "${destination.title}".`,
        );
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Move failed: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.reorderChildren', async (item?: NoteItem) => {
      const target = item ?? treeView.selection[0];
      if (!target) { return; }
      const client = treeProvider.getClient();
      if (!client) { void vscode.window.showErrorMessage('Trilium: Not connected.'); return; }

      try {
        await openReorderChildrenPanel(context, client, target, () => {
          void treeProvider.refreshNoteById(target.note.noteId);
        });
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Reorder window failed: ${err}`);
      }
    }),

    // -----------------------------------------------------------------------
    // Export subtree
    // -----------------------------------------------------------------------

    vscode.commands.registerCommand('trilium.exportSubtree', async (item?: NoteItem) => {
      const target = item ?? treeView.selection[0];
      if (!target) { return; }
      const client = treeProvider.getClient();
      if (!client) { void vscode.window.showErrorMessage('Trilium: Not connected.'); return; }

      interface FormatOption extends vscode.QuickPickItem { format: 'html' | 'markdown'; }
      const formatPick = await vscode.window.showQuickPick<FormatOption>([
        { label: '$(file-zip) HTML ZIP', description: 'Full HTML export with assets', format: 'html' },
        { label: '$(markdown) Markdown ZIP', description: 'Markdown text export', format: 'markdown' },
      ], { title: `Export Subtree — ${target.note.title}` });
      if (!formatPick) { return; }

      const defaultName = `${target.note.title.replace(/[\\/:*?"<>|]/g, '_')}.zip`;
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultName),
        filters: { 'ZIP Archive': ['zip'] },
        saveLabel: 'Export',
      });
      if (!saveUri) { return; }

      try {
        const buffer = await client.exportNoteSubtree(target.note.noteId, formatPick.format);
        await vscode.workspace.fs.writeFile(saveUri, new Uint8Array(buffer));
        void vscode.window.showInformationMessage(
          `Trilium: Exported "${target.note.title}" to ${saveUri.fsPath}`,
        );
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Export failed: ${err}`);
      }
    }),

    vscode.commands.registerCommand('trilium.debugListLmTools', async () => {
      const allTools = vscode.lm.tools;
      const triliumTools = allTools.filter((tool) => tool.name.startsWith('trilium_'));

      output.appendLine(`[lm] total tools visible in vscode.lm.tools: ${allTools.length}`);
      output.appendLine(`[lm] trilium tools visible: ${triliumTools.length}`);
      for (const tool of triliumTools) {
        output.appendLine(`[lm] tool ${tool.name} tags=[${tool.tags.join(', ')}]`);
      }

      if (triliumTools.length === 0) {
        void vscode.window.showWarningMessage(
          'Trilium: No Trilium language model tools are visible at runtime. Open "Trilium Notes" output for diagnostics.',
        );
      } else {
        void vscode.window.showInformationMessage(
          `Trilium: ${triliumTools.length} language model tools are visible. See "Trilium Notes" output.`,
        );
      }
    }),

    // Sync note content back to Trilium whenever a tracked temp file is saved.
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (tempFileManager.isTextEditorTempPath(doc.fileName)) {
        return;
      }
      const noteId = tempFileManager.getNoteIdForPath(doc.fileName);
      if (!noteId) {
        return;
      }

      const client = treeProvider.getClient();
      if (!client) {
        return;
      }

      try {
        // Text notes are stored as Markdown locally; convert back to HTML for Trilium.
        // Raw HTML temp files are already HTML and must be uploaded as-is.
        let payload: string;
        if (tempFileManager.isHtmlTempPath(doc.fileName)) {
          payload = doc.getText();
        } else if (tempFileManager.isTextNote(noteId)) {
          payload = tempFileManager.markdownToHtml(doc.getText());
        } else {
          payload = doc.getText();
        }

        if (tempFileManager.isMindMapNote(noteId)) {
          output.appendLine(
            `[mindMap][save] uploading content noteId=${noteId} path=${doc.fileName} ${summarizeContentForDebug(payload)}`,
          );
        }

        await client.putNoteContent(noteId, payload);
        await treeProvider.refreshNoteById(noteId);
        vscode.window.setStatusBarMessage('Trilium: Note saved.', 3000);
      } catch (err) {
        void vscode.window.showErrorMessage(`Trilium: Failed to save note: ${err}`);
      }
    }),

    // Cleanup temporary and virtual documents when their tabs are closed.
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme === 'trilium-text') {
        virtualDocProvider.clearCache(doc.uri);
        return;
      }

      if (doc.uri.scheme !== 'file') {
        return;
      }

      // VS Code can close/reopen a file-backed document during language-mode
      // transitions. Avoid deleting temp files while another document instance
      // for the same file is still open.
      const isStillOpen = vscode.workspace.textDocuments.some((openDoc) =>
        openDoc.uri.scheme === 'file' && openDoc.fileName === doc.fileName,
      );
      if (isStillOpen) {
        return;
      }

      if (tempFileManager.isManagedTempPath(doc.fileName)) {
        tempFileManager.removeTempFileByPath(doc.fileName);
      }
      TriliumTextEditorProvider.clearDocumentMetadata(doc.uri);
    }),

    vscode.window.registerFileDecorationProvider(new NoteTreeDecorationProvider()),
    { dispose: () => tempFileManager.cleanup() },

    vscode.workspace.onDidCloseTextDocument((doc) => {
      for (const [noteId, entry] of refreshRegistry) {
        if (entry.tempFilePath === doc.fileName) {
          refreshRegistry.delete(noteId);
          break;
        }
      }
    }),

    (() => {
      const POLL_MS = 30_000;
      const handle = setInterval(async () => {
        const intervalSecs = vscode.workspace
          .getConfiguration('trilium')
          .get<number>('autoRefreshIntervalSeconds', 30);
        const maxConsecutiveFailures = vscode.workspace
          .getConfiguration('trilium')
          .get<number>('autoRefreshMaxConsecutiveFailures', 8);
        const warnAfterFailures = vscode.workspace
          .getConfiguration('trilium')
          .get<number>('autoRefreshWarnAfterFailures', 3);
        if (intervalSecs <= 0 || refreshRegistry.size === 0) {
          return;
        }
        const client = treeProvider.getClient();
        if (!client) {
          return;
        }
        for (const [noteId, entry] of Array.from(refreshRegistry)) {
          try {
            await refreshTrackedEntry(noteId, entry, client);
          } catch (err) {
            const kind = classifyRefreshFailure(err);
            entry.consecutiveFailures += 1;

            if (shouldUntrackAfterFailure(kind, entry.consecutiveFailures, maxConsecutiveFailures)) {
              refreshRegistry.delete(noteId);
              continue;
            }

            if (!shouldWarnAfterFailure(entry.consecutiveFailures, warnAfterFailures)) {
              continue;
            }

            if (entry.lastWarnedFailureCount === entry.consecutiveFailures) {
              continue;
            }
            entry.lastWarnedFailureCount = entry.consecutiveFailures;

            const action = await vscode.window.showWarningMessage(
              buildRefreshFailureMessage(
                entry.title,
                kind,
                entry.consecutiveFailures,
                maxConsecutiveFailures,
              ),
              'Retry Now',
              'Reconnect',
              'Disable Auto-Refresh',
            );

            if (action === 'Retry Now') {
              try {
                await refreshTrackedEntry(noteId, entry, client);
              } catch {
                // Leave the note tracked; normal polling/backoff will continue.
              }
            } else if (action === 'Reconnect') {
              await vscode.commands.executeCommand('trilium.reconnect');
            } else if (action === 'Disable Auto-Refresh') {
              await vscode.workspace
                .getConfiguration('trilium')
                .update('autoRefreshIntervalSeconds', 0, vscode.ConfigurationTarget.Global);
            }
          }
        }
      }, POLL_MS);
      return { dispose: () => clearInterval(handle) };
    })(),
  );
}

async function tryConnect(
  secrets: vscode.SecretStorage,
  treeProvider: NoteTreeProvider,
): Promise<AppInfo | undefined> {
  const token = await getToken(secrets);
  if (!token) {
    return undefined;
  }

  const serverUrl = getServerUrl();
  const client = new EtapiClient(serverUrl, token);

  try {
    const info = await client.getAppInfo();
    treeProvider.setClient(client);
    return info;
  } catch {
    // Credentials stored but server unreachable — user can reconnect manually.
    return undefined;
  }
}

async function runConnectWizard(
  secrets: vscode.SecretStorage,
  treeProvider: NoteTreeProvider,
): Promise<AppInfo | undefined> {
  const currentUrl = getServerUrl();

  const serverUrl = await vscode.window.showInputBox({
    prompt: 'Trilium server URL',
    value: currentUrl,
    ignoreFocusOut: true,
    validateInput: (v) => {
      try {
        new globalThis.URL(v);
        return null;
      } catch {
        return 'Enter a valid URL (e.g. http://localhost:8080)';
      }
    },
  });
  if (!serverUrl) {
    return;
  }

  const token = await vscode.window.showInputBox({
    prompt: 'ETAPI token — obtain from Trilium: Options → ETAPI',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'Paste your ETAPI token here',
  });
  if (!token) {
    return;
  }

  // Validate the credentials before storing them.
  const client = new EtapiClient(serverUrl, token);
  try {
    const info = await client.getAppInfo();
    await vscode.workspace
      .getConfiguration('trilium')
      .update('serverUrl', serverUrl, vscode.ConfigurationTarget.Global);
    await storeToken(secrets, token);
    treeProvider.setClient(client);
    void vscode.window.showInformationMessage(
      `Trilium: Connected to ${serverUrl} (v${info.appVersion}).`,
    );
    return info;
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Trilium: Could not connect — check URL and token. ${err}`,
    );
    return undefined;
  }
}

export function deactivate(): void {
  // Cleanup is handled via context.subscriptions.
}

// ---------------------------------------------------------------------------
// Destination note picker (for clone / move)
// ---------------------------------------------------------------------------

async function pickDestinationNote(
  client: EtapiClient,
  title: string,
): Promise<Note | undefined> {
  interface DestItem extends vscode.QuickPickItem { note: Note; }
  const qp = vscode.window.createQuickPick<DestItem>();
  qp.title = title;
  qp.placeholder = 'Type to search for destination note…';
  qp.matchOnDescription = true;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  qp.onDidChangeValue((query) => {
    if (debounce) { clearTimeout(debounce); }
    if (!query.trim()) { qp.items = []; return; }
    qp.busy = true;
    debounce = setTimeout(async () => {
      try {
        const { results } = await client.searchNotes(query, { limit: 30 });
        qp.items = results.map((n) => ({
          label: `$(${preferredCodiconForNote(n)}) ${n.title}`,
          description: noteTypeToLabel(n.type),
          note: n,
        }));
      } catch {
        qp.items = [];
      } finally {
        qp.busy = false;
      }
    }, 300);
  });

  return new Promise((resolve) => {
    qp.onDidAccept(() => {
      const [picked] = qp.selectedItems;
      settled = true;
      qp.hide();
      resolve(picked?.note);
    });
    qp.onDidHide(() => {
      if (debounce) { clearTimeout(debounce); }
      qp.dispose();
      if (!settled) {
        resolve(undefined);
      }
    });
    qp.show();
  });
}

// ---------------------------------------------------------------------------
// Note editor helper
// ---------------------------------------------------------------------------

async function openNoteInEditor(
  note: Note,
  client: EtapiClient,
  tempFileManager: TempFileManager,
  virtualDocProvider: VirtualDocumentProvider,
  treeProvider: NoteTreeProvider,
  treeView: vscode.TreeView<NoteItem>,
  notePathOrId?: string,
): Promise<void> {
  const editableTypes: Note['type'][] = ['text', 'code', 'mermaid', 'canvas', 'mindMap'];
  if (!(editableTypes as string[]).includes(note.type)) {
    const action = await vscode.window.showWarningMessage(
      `Trilium: "${note.title}" (${note.type}) cannot be rendered natively.`,
      'Open in Browser',
      'Open in External Browser',
    );
    if (action === 'Open in Browser') {
      await openNoteInBrowser(note, notePathOrId, false);
    } else if (action === 'Open in External Browser') {
      await openNoteInBrowser(note, notePathOrId, true);
    }
    return;
  }

  if (note.isProtected) {
    await showProtectedNoteRecoveryActions(note, notePathOrId);
    return;
  }
  if (note.type === 'text') {
    const rawContent = await client.getNoteContent(note.noteId);
    const uri = createVirtualDocumentUri(note.noteId, note.title);
    virtualDocProvider.updateContent(uri, rawContent);
    TriliumTextEditorProvider.setDocumentMetadata(uri, {
      noteId: note.noteId,
      title: note.title,
    });
    await vscode.commands.executeCommand('vscode.openWith', uri, TriliumTextEditorProvider.viewType);
    await maybeAutoRevealOpenedNote(note.noteId, treeProvider, treeView);
    return;
  }
  if (note.type === 'mindMap') {
    await vscode.commands.executeCommand('trilium.openMindMap', new NoteItem(note));
    await maybeAutoRevealOpenedNote(note.noteId, treeProvider, treeView);
    return;
  }
  if (note.type === 'mermaid') {
    await vscode.commands.executeCommand('trilium.openMermaid', new NoteItem(note));
    await maybeAutoRevealOpenedNote(note.noteId, treeProvider, treeView);
    return;
  }
  if (note.type === 'canvas') {
    await vscode.commands.executeCommand('trilium.openCanvas', new NoteItem(note));
    await maybeAutoRevealOpenedNote(note.noteId, treeProvider, treeView);
    return;
  }
  const rawContent = await client.getNoteContent(note.noteId);
  const filePath = tempFileManager.getTempPath(note);
  const fileContent = rawContent;
  fs.writeFileSync(filePath, fileContent, 'utf8');
  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.languages.setTextDocumentLanguage(doc, tempFileManager.getLanguageId(note));
  await vscode.window.showTextDocument(doc, { preview: false });
  await maybeAutoRevealOpenedNote(note.noteId, treeProvider, treeView);
}

function noteIdFromUri(uri: vscode.Uri, tempFileManager: TempFileManager): string | undefined {
  if (uri.scheme === 'trilium-text') {
    return noteIdFromTriliumTextUri(uri);
  }

  if (uri.scheme === 'file') {
    return tempFileManager.getNoteIdForPath(uri.fsPath);
  }

  return undefined;
}

function getPreferredParticipantContextNoteId(
  treeView: vscode.TreeView<NoteItem>,
  tempFileManager: TempFileManager,
): string | undefined {
  return treeView.selection[0]?.note.noteId ?? getActiveNoteId(tempFileManager);
}

function getRegisteredLmTools(names: string[]): vscode.LanguageModelChatTool[] {
  const byName = new Map(vscode.lm.tools.map((tool) => [tool.name, tool]));
  return names.flatMap((name) => {
    const tool = byName.get(name);
    if (!tool) {
      return [];
    }

    return [{
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    } satisfies vscode.LanguageModelChatTool];
  });
}

function toolResultToText(result: vscode.LanguageModelToolResult): string {
  return result.content
    .map((part) => part instanceof vscode.LanguageModelTextPart ? part.value : '')
    .join('')
    .trim();
}

function buildParticipantPrompt(
  prompt: string,
  command: string | undefined,
  defaultContextNoteId: string | undefined,
  defaultContextText: string | undefined,
): string {
  const commandInstruction = command === 'document'
    ? 'The selected /document command means the user explicitly wants documentation content, potentially as multiple nested notes when that structure is clearer.'
    : 'If the user is asking for documentation or a structured knowledge-base section, prefer creating a nested note tree with trilium_stageDraftNotes.';

  return [
    'You are the Trilium Notes chat participant running inside VS Code.',
    'Use the available Trilium tools to inspect the existing knowledge base, resolve the correct destination note, and stage new Trilium child notes when appropriate.',
    'Rules:',
    '- Prefer the supplied current Trilium context as the default destination scope unless the user clearly names a different target.',
    '- Use Trilium notes as primary grounding. Read relevant destination or sibling notes before writing so new content matches the local structure and naming.',
    '- If the request says to use online information, use grounded/web information when this Copilot environment provides it. If it does not, say so briefly and continue using Trilium context plus model knowledge.',
    '- Do not guess the destination when multiple Trilium notes are plausible. Ask a short clarifying question instead.',
    '- For documentation requests, treat the target section as the subtree boundary. Do not append to or overwrite the existing section note unless the user explicitly asks for that.',
    '- New notes may be placed directly under the target section or inside deeper subsections within that subtree when that creates a clearer structure.',
    '- Nested child notes are encouraged when the documentation naturally breaks into overview, setup, operations, troubleshooting, or similar subtopics.',
    '- Use trilium_stageDraftNotes to create staged draft child notes. These drafts are opened locally and are not saved to Trilium content until the user confirms them.',
    '- Draft note content must be valid HTML for each text note.',
    '- After staging drafts, summarize exactly what notes were created and under which Trilium paths.',
    commandInstruction,
    defaultContextNoteId
      ? `Current Trilium context noteId: ${defaultContextNoteId}`
      : 'Current Trilium context noteId: none',
    defaultContextText
      ? `Current Trilium context:\n${defaultContextText}`
      : 'Current Trilium context: none',
    `User request:\n${prompt}`,
  ].join('\n\n');
}

interface ParticipantRunResult {
  text: string;
  stagedSessionIds: string[];
}

async function runParticipantToolLoop(
  request: vscode.ChatRequest,
  tools: vscode.LanguageModelChatTool[],
  prompt: string,
  token: vscode.CancellationToken,
): Promise<ParticipantRunResult> {
  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(prompt),
  ];
  const stagedSessionIds = new Set<string>();

  for (let round = 0; round < 8; round += 1) {
    const modelResponse = await request.model.sendRequest(messages, {
      justification: 'Research existing Trilium notes, synthesize the answer, and optionally write results back into the user\'s Trilium tree.',
      tools,
      toolMode: vscode.LanguageModelChatToolMode.Auto,
    }, token);

    const assistantParts: Array<
      vscode.LanguageModelTextPart
      | vscode.LanguageModelToolCallPart
      | vscode.LanguageModelDataPart
    > = [];
    const toolCalls: vscode.LanguageModelToolCallPart[] = [];

    for await (const part of modelResponse.stream) {
      if (part instanceof vscode.LanguageModelTextPart) {
        assistantParts.push(part);
        continue;
      }

      if (part instanceof vscode.LanguageModelToolCallPart) {
        assistantParts.push(part);
        toolCalls.push(part);
        continue;
      }

      if (part instanceof vscode.LanguageModelDataPart) {
        assistantParts.push(part);
      }
    }

    if (toolCalls.length === 0) {
      return {
        text: assistantParts
          .map((part) => part instanceof vscode.LanguageModelTextPart ? part.value : '')
          .join('')
          .trim(),
        stagedSessionIds: Array.from(stagedSessionIds),
      };
    }

    messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));
    for (const toolCall of toolCalls) {
      const toolResult = await vscode.lm.invokeTool(toolCall.name, {
        toolInvocationToken: request.toolInvocationToken,
        input: toolCall.input,
      }, token);
      if (toolCall.name === 'trilium_stageDraftNotes') {
        const resultText = toolResultToText(toolResult);
        const match = resultText.match(/Draft session id: ([^\s]+)/);
        if (match) {
          stagedSessionIds.add(match[1]);
        }
      }
      messages.push(vscode.LanguageModelChatMessage.User([
        new vscode.LanguageModelToolResultPart(toolCall.callId, toolResult.content),
      ]));
    }
  }

  throw new Error('Exceeded maximum tool-calling rounds while handling the Trilium chat request.');
}

function noteIdFromTriliumTextUri(uri: vscode.Uri): string | undefined {
  const query = new URLSearchParams(uri.query);
  const fromQuery = query.get('noteId');
  if (fromQuery) {
    return fromQuery;
  }

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

async function migrateLegacyTriliumTextTabs(
  oldUri: vscode.Uri,
  noteId: string,
  noteTitle: string,
): Promise<vscode.Uri | undefined> {
  if (oldUri.scheme !== 'trilium-text') {
    return undefined;
  }

  const pathSegment = oldUri.path.substring(1);
  if (!pathSegment || pathSegment !== noteId) {
    return undefined;
  }

  const newUri = createVirtualDocumentUri(noteId, noteTitle);
  if (newUri.toString() === oldUri.toString()) {
    return undefined;
  }

  let migrated = false;
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (!(tab.input instanceof vscode.TabInputCustom)) {
        continue;
      }
      if (tab.input.uri.toString() !== oldUri.toString()) {
        continue;
      }

      TriliumTextEditorProvider.setDocumentMetadata(newUri, {
        noteId,
        title: noteTitle,
      });
      await vscode.commands.executeCommand(
        'vscode.openWith',
        newUri,
        TriliumTextEditorProvider.viewType,
        { preview: tab.isPreview, preserveFocus: true, viewColumn: group.viewColumn },
      );

      try {
        await vscode.window.tabGroups.close(tab);
      } catch {
        // Tab handle can become stale after openWith; close by URI lookup instead.
        for (const fallbackGroup of vscode.window.tabGroups.all) {
          for (const fallbackTab of fallbackGroup.tabs) {
            if (
              fallbackTab.input instanceof vscode.TabInputCustom
              && fallbackTab.input.uri.toString() === oldUri.toString()
            ) {
              await vscode.window.tabGroups.close(fallbackTab);
            }
          }
        }
      }
      migrated = true;
    }
  }

  return migrated ? newUri : undefined;
}

function getActiveNoteId(tempFileManager: TempFileManager): string | undefined {
  const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
  if (activeEditorUri) {
    const fromEditor = noteIdFromUri(activeEditorUri, tempFileManager);
    if (fromEditor) {
      return fromEditor;
    }
  }

  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (!activeTab) {
    return undefined;
  }

  if (activeTab.input instanceof vscode.TabInputText) {
    return noteIdFromUri(activeTab.input.uri, tempFileManager);
  }

  if (activeTab.input instanceof vscode.TabInputCustom) {
    return noteIdFromUri(activeTab.input.uri, tempFileManager);
  }

  return activeWebviewNoteId;
}

async function revealNoteInTree(
  noteId: string,
  treeProvider: NoteTreeProvider,
  treeView: vscode.TreeView<NoteItem>,
): Promise<boolean> {
  const item = await treeProvider.findItemByNoteId(noteId);
  if (!item) {
    return false;
  }

  await vscode.commands.executeCommand('triliumNoteTree.focus');
  await treeView.reveal(item, {
    select: true,
    focus: true,
    expand: 3,
  });
  return true;
}

async function maybeAutoRevealOpenedNote(
  noteId: string,
  treeProvider: NoteTreeProvider,
  treeView: vscode.TreeView<NoteItem>,
): Promise<void> {
  if (!getAutoRevealInTreeOnOpen()) {
    return;
  }

  try {
    await revealNoteInTree(noteId, treeProvider, treeView);
  } catch {
    // Best-effort only. Opening the note should not fail if the tree cannot reveal it.
  }
}

// ---------------------------------------------------------------------------
// Note creation helpers
// ---------------------------------------------------------------------------

interface CodeLanguageOption extends vscode.QuickPickItem {
  mime: string;
}

const CODE_LANGUAGE_OPTIONS: CodeLanguageOption[] = [
  { label: 'JavaScript', mime: 'text/javascript' },
  { label: 'TypeScript', mime: 'application/typescript' },
  { label: 'Python', mime: 'text/x-python' },
  { label: 'HTML', mime: 'text/html' },
  { label: 'CSS', mime: 'text/css' },
  { label: 'JSON', mime: 'application/json' },
  { label: 'XML', mime: 'text/xml' },
  { label: 'SQL', mime: 'text/x-sql' },
  { label: 'Shell', mime: 'text/x-sh' },
  { label: 'Java', mime: 'text/x-java' },
  { label: 'C', mime: 'text/x-c' },
  { label: 'C++', mime: 'text/x-c++' },
  { label: 'Rust', mime: 'text/x-rust' },
  { label: 'Go', mime: 'text/x-go' },
  { label: 'Kotlin', mime: 'text/x-kotlin' },
  { label: 'Ruby', mime: 'text/x-ruby' },
  { label: 'YAML', mime: 'application/x-yaml' },
  { label: 'Markdown', mime: 'text/markdown' },
  { label: 'Plain Text', mime: 'text/plain' },
];

async function createNoteOfType(
  type: 'text' | 'code' | 'mermaid' | 'canvas' | 'mindMap',
  mime: string | undefined,
  item: NoteItem | undefined,
  treeProvider: NoteTreeProvider,
  treeView: vscode.TreeView<NoteItem>,
  tempFileManager: TempFileManager,
  defaultContent = '',
): Promise<void> {
  const client = treeProvider.getClient();
  if (!client) {
    void vscode.window.showErrorMessage(
      'Trilium: Not connected. Use "Trilium: Connect to Trilium Server" first.',
    );
    return;
  }

  const parentId = item?.note.noteId ?? 'root';
  const parentLabel = item?.note.title ?? 'root';

  const title = await vscode.window.showInputBox({
    prompt: `New ${type} note under "${parentLabel}"`,
    placeHolder: 'Note title',
    ignoreFocusOut: true,
  });
  if (!title) { return; }

  try {
    const result = await client.createNote(parentId, title, type, defaultContent, mime);
    await treeProvider.refreshNoteById(parentId);

    const newNote = result.note;

    // Text notes: open with CKEditor (same path as openNote / openTodayNote).
    if (newNote.type === 'text') {
      const filePath = tempFileManager.getTextEditorTempPath(newNote);
      fs.writeFileSync(filePath, defaultContent, 'utf8');
      const uri = vscode.Uri.file(filePath);
      TriliumTextEditorProvider.setDocumentMetadata(uri, {
        noteId: newNote.noteId,
        title: newNote.title,
      });
      await vscode.commands.executeCommand('vscode.openWith', uri, TriliumTextEditorProvider.viewType);
      await maybeAutoRevealOpenedNote(newNote.noteId, treeProvider, treeView);
      return;
    }

    if (newNote.type === 'mindMap') {
      const filePath = tempFileManager.getTempPath(newNote);
      fs.writeFileSync(filePath, formatMindMapJsonForEditor(defaultContent), 'utf8');
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.languages.setTextDocumentLanguage(doc, tempFileManager.getLanguageId(newNote));
      await vscode.window.showTextDocument(doc, { preview: false });
      await maybeAutoRevealOpenedNote(newNote.noteId, treeProvider, treeView);
      return;
    }

    // Other note types: use temp file approach.
    const filePath = tempFileManager.getTempPath(newNote);
    fs.writeFileSync(filePath, defaultContent, 'utf8');
    const doc = await vscode.workspace.openTextDocument(filePath);
    const langId = tempFileManager.getLanguageId(newNote);
    await vscode.languages.setTextDocumentLanguage(doc, langId);
    await vscode.window.showTextDocument(doc, { preview: false });
    await maybeAutoRevealOpenedNote(newNote.noteId, treeProvider, treeView);
  } catch (err) {
    void vscode.window.showErrorMessage(`Trilium: Failed to create note: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Bulk import helpers (used by trilium.importNotes)
// ---------------------------------------------------------------------------

interface NoteImportSpec {
  title: string;
  type?: 'text' | 'code' | 'mermaid' | 'canvas';
  mime?: string;
  content?: string;
  children?: NoteImportSpec[];
}

interface DraftNoteSpec {
  title: string;
  content: string;
  children?: DraftNoteSpec[];
}

async function importNotesRecursive(
  client: EtapiClient,
  parentNoteId: string,
  specs: NoteImportSpec[],
): Promise<number> {
  let count = 0;
  for (const spec of specs) {
    const type = spec.type ?? 'text';
    const result = await client.createNote(
      parentNoteId,
      spec.title,
      type,
      spec.content ?? '',
      spec.mime,
    );
    count++;
    if (spec.children && spec.children.length > 0) {
      count += await importNotesRecursive(client, result.note.noteId, spec.children);
    }
  }
  return count;
}

async function stageDraftNotesRecursive(
  client: EtapiClient,
  parentNoteId: string,
  specs: DraftNoteSpec[],
  sessionId: string,
  tempFileManager: TempFileManager,
  textEditorProvider: TriliumTextEditorProvider,
  draftNoteManager: DraftNoteManager,
): Promise<Array<{ noteId: string; title: string }>> {
  const created: Array<{ noteId: string; title: string }> = [];

  for (const spec of specs) {
    const serverContent = '<p></p>';
    const result = await client.createNote(parentNoteId, spec.title, 'text', serverContent);
    const note = result.note;
    const filePath = tempFileManager.getTextEditorTempPath(note);
    fs.writeFileSync(filePath, serverContent, 'utf8');
    const uri = vscode.Uri.file(filePath);

    TriliumTextEditorProvider.setDocumentMetadata(uri, {
      noteId: note.noteId,
      title: note.title,
    });
    draftNoteManager.registerDraft({
      noteId: note.noteId,
      sessionId,
      parentNoteId,
      title: note.title,
      type: 'text',
      uri,
      serverContent,
      localContent: spec.content,
    });

    await vscode.commands.executeCommand('vscode.openWith', uri, TriliumTextEditorProvider.viewType);
    textEditorProvider.setTitleForOpenEditor(uri, note.title);
    created.push({ noteId: note.noteId, title: note.title });

    if (spec.children && spec.children.length > 0) {
      created.push(...await stageDraftNotesRecursive(
        client,
        note.noteId,
        spec.children,
        sessionId,
        tempFileManager,
        textEditorProvider,
        draftNoteManager,
      ));
    }
  }

  return created;
}

async function closeTabForUri(uri: vscode.Uri): Promise<void> {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      const tabUri = input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText
        ? input.uri
        : undefined;
      if (tabUri?.toString() === uri.toString()) {
        await vscode.window.tabGroups.close(tab);
        return;
      }
    }
  }
}

async function revertAndCloseTabForUri(uri: vscode.Uri, customViewType?: string): Promise<void> {
  const opened = customViewType
    ? vscode.commands.executeCommand('vscode.openWith', uri, customViewType)
    : vscode.commands.executeCommand('vscode.open', uri);

  await opened;
  await vscode.commands.executeCommand('workbench.action.files.revert');
  await closeTabForUri(uri);
}
