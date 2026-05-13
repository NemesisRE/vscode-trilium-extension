import mermaid from 'mermaid';

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
const sourceEl = document.getElementById('source') as HTMLTextAreaElement;
const previewEl = document.getElementById('preview') as HTMLDivElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement;
const breadcrumbEl = document.getElementById('breadcrumb') as HTMLDivElement;

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function setStatus(message: string): void {
  statusEl.textContent = message;
}

async function renderPreview(content: string): Promise<void> {
  const source = content.trim();
  if (!source) {
    previewEl.innerHTML = '<div class="placeholder">Write Mermaid syntax to render a diagram.</div>';
    return;
  }

  try {
    const id = `mermaid-${Date.now().toString(36)}`;
    const rendered = await mermaid.render(id, source);
    previewEl.innerHTML = rendered.svg;
    rendered.bindFunctions?.(previewEl);
    setStatus('Rendered');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    previewEl.innerHTML = `<pre class="error">${message}</pre>`;
    setStatus('Render error');
  }
}

function scheduleSave(): void {
  setStatus('Unsaved changes');
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    setStatus('Saving...');
    vscode.postMessage({ type: 'save', content: sourceEl.value });
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

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default',
});

sourceEl.addEventListener('input', () => {
  void renderPreview(sourceEl.value);
  scheduleSave();
});

refreshBtn.addEventListener('click', () => {
  setStatus('Refreshing...');
  vscode.postMessage({ type: 'refresh' });
});

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const message = event.data;

  if (message.type === 'render') {
    sourceEl.value = message.content;
    void renderPreview(message.content);
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
      console.error('[mermaid][webview] save failed', message.error);
    }
  }
});

vscode.postMessage({ type: 'ready' });
setStatus('Loading...');
