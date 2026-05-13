import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Excalidraw, restore, serializeAsJSON } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

declare function acquireVsCodeApi<T = unknown>(): {
  postMessage: (message: T) => void;
};

type HostMessage =
  | { type: 'render'; content: string }
  | { type: 'breadcrumb'; parts: Array<{ noteId: string; title: string }>; backlinksCount: number }
  | { type: 'saveResult'; success: boolean; error?: string };

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'save'; content: string }
  | { type: 'openBreadcrumbNote'; noteId: string };

const vscode = acquireVsCodeApi<WebviewMessage>();
const statusEl = document.getElementById('status') as HTMLDivElement;
const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement;
const breadcrumbEl = document.getElementById('breadcrumb') as HTMLDivElement;
const rootEl = document.getElementById('app') as HTMLDivElement;
const errorEl = document.getElementById('error') as HTMLPreElement;

const EMPTY_SCENE = JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }, null, 2);

type ParsedScene = {
  type?: string;
  version?: number;
  elements?: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

let root: Root | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let suppressNextSave = false;
let lastSerialized = EMPTY_SCENE;

function setStatus(message: string): void {
  statusEl.textContent = message;
}

function clearError(): void {
  errorEl.style.display = 'none';
  errorEl.textContent = '';
}

function showError(message: string, err?: unknown): void {
  const detail = err instanceof Error
    ? err.stack ?? err.message
    : typeof err === 'string'
      ? err
      : err === undefined
        ? ''
        : JSON.stringify(err, null, 2);
  errorEl.style.display = 'block';
  errorEl.textContent = detail ? `${message}\n\n${detail}` : message;
}

function scheduleSave(content: string): void {
  lastSerialized = content;
  setStatus('Unsaved changes');

  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    setStatus('Saving...');
    vscode.postMessage({ type: 'save', content: lastSerialized });
  }, 700);
}

function renderBreadcrumb(parts: Array<{ noteId: string; title: string }>, backlinksCount: number): void {
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
  badge.textContent = `Backlinks ${Number.isFinite(backlinksCount) ? backlinksCount : 0}`;
  badge.title = 'Number of notes that link to this note via relations';
  breadcrumbEl.appendChild(badge);
}

function normalizeScene(content: string): ParsedScene {
  const raw = JSON.parse(content) as unknown;
  const parsed = (raw && typeof raw === 'object') ? (raw as ParsedScene) : {};
  const normalized: ParsedScene = {
    type: parsed?.type,
    version: parsed?.version,
    elements: Array.isArray(parsed?.elements) ? parsed.elements : [],
    appState: parsed?.appState && typeof parsed.appState === 'object' ? { ...parsed.appState } : {},
    files: parsed?.files && typeof parsed.files === 'object' ? parsed.files : {},
  };

  // Older saves may persist collaborators as a plain object, but Excalidraw expects a Map at runtime.
  if (normalized.appState && 'collaborators' in normalized.appState) {
    delete normalized.appState.collaborators;
  }

  if ('collaborators' in normalized) {
    delete (normalized as Record<string, unknown>).collaborators;
  }

  return normalized;
}

function renderScene(content: string): void {
  clearError();

  const nextContent = content.trim() ? content : EMPTY_SCENE;
  const normalized = normalizeScene(nextContent);
  const restored = restore(normalized, null, null);
  suppressNextSave = true;
  lastSerialized = serializeAsJSON(restored.elements as never[], restored.appState, restored.files, 'local');

  const app = React.createElement(
    'div',
    { style: { height: '100%', width: '100%' } },
    React.createElement(Excalidraw, {
      initialData: restored,
      onChange: (elements: unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
        if (suppressNextSave) {
          suppressNextSave = false;
          return;
        }

        scheduleSave(serializeAsJSON(elements as never[], appState, files, 'local'));
      },
      theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    }),
  );

  if (!root) {
    root = createRoot(rootEl);
  }
  root.render(app);
  setStatus('Rendered');
}

refreshBtn.addEventListener('click', () => {
  setStatus('Refreshing...');
  vscode.postMessage({ type: 'refresh' });
});

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const message = event.data;

  if (message.type === 'render') {
    try {
      renderScene(message.content);
    } catch (err) {
      setStatus('Load failed');
      showError('Canvas render failed.', err);
      console.error('[canvas][webview] render failed', err);
    }
    return;
  }

  if (message.type === 'breadcrumb') {
    renderBreadcrumb(message.parts, message.backlinksCount);
    return;
  }

  if (message.type === 'saveResult') {
    if (message.success) {
      setStatus('Saved');
    } else {
      setStatus('Save failed');
      showError('Canvas save failed.', message.error);
      console.error('[canvas][webview] save failed', message.error);
    }
  }
});

window.addEventListener('error', (event) => {
  setStatus('Runtime error');
  showError(`Runtime error: ${event.message}`, event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  setStatus('Runtime error');
  showError('Unhandled promise rejection.', event.reason);
});

vscode.postMessage({ type: 'ready' });
setStatus('Loading...');
