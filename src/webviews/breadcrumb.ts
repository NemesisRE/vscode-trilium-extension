interface BreadcrumbVsCodeApi {
  postMessage: (message: { type: 'openBreadcrumbNote'; noteId: string }) => void;
}

/** Renders the note-path breadcrumb + backlinks badge shared by the mermaid and canvas editors. */
export function renderBreadcrumb(
  breadcrumbEl: HTMLElement,
  vscode: BreadcrumbVsCodeApi,
  parts: Array<{ noteId: string; title: string }>,
  backlinksCount: number,
): void {
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
