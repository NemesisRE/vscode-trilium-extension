import { renderLinkEmbedBoxHtml, sliceToBlockReference, type LinkPreviewData } from '@triliumnext/commons';
import type { Editor } from 'ckeditor5';
import ContentEmbed from '../../vendor/ckeditor5/src/plugins/content_embed/content_embed';

/**
 * Host-side helpers for the vendored ContentEmbed plugin (the successor of IncludeNote), which
 * delegates everything it can't do itself to the `contentEmbed` editor config: the note picker,
 * rendering what an embed shows, and so on. The webview script in triliumTextEditorProvider.ts
 * builds that config out of these helpers plus its own message round trips to the extension host.
 */

/** Inserts an embed of `noteId` after the selection, the way upstream's own Include note dialog does. */
export function insertContentEmbedForNote(editor: Editor, noteId: string): void {
  editor.model.change((writer) => {
    const embed = writer.createElement('contentEmbed', { noteId, boxSize: 'resizable' });
    editor.model.insertObject(embed, null, null, { setSelection: 'after' });
  });
}

/** Shows an Expandable embed's content, or just its title row while `isCollapsed`. */
export function setContentEmbedCollapsed(editor: Editor, domElement: Element, isCollapsed: boolean): void {
  editor.plugins.get(ContentEmbed).setEmbedCollapsedAt(domElement, isCollapsed);
}

/**
 * Strips the executable surface out of HTML that the editor keeps for an embed of a kind this
 * version doesn't know. The webview's CSP (script-src with a nonce, no 'unsafe-inline') already
 * keeps all of it from running - this is defense in depth, like sanitizeIncludedNoteHtml on the
 * extension host - but the unknown embed's content is written back into the note as-is.
 */
export function sanitizeEmbedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, iframe, object, embed, link, meta, base, form').forEach((el) => el.remove());
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || ((name === 'href' || name === 'src' || name === 'xlink:href') && value.startsWith('javascript:'))) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
}

/** The placeholder shown for an embed of a kind this version doesn't know. */
export function renderUnknownEmbed(wrapper: HTMLElement): void {
  const note = document.createElement('div');
  note.className = 'include-note-content include-note-unknown';
  note.textContent = 'This embed type is not supported by this editor. It is kept as it is in the note.';
  wrapper.replaceChildren(note);
}

/**
 * Renders the player of a media link preview (a YouTube video, an audio or video file) as the same
 * click-to-open facade the rest of this extension uses for video: a live player never works in a
 * VS Code webview (see mediaEmbedFacade.ts), so a click hands the URL to the extension host.
 */
export function renderMediaEmbed(
  preview: LinkPreviewData,
  wrapper: HTMLElement,
  boxSize: string | undefined,
  openExternal: (url: string) => void,
): void {
  wrapper.innerHTML = renderLinkEmbedBoxHtml(
    preview,
    (name) => (name === 'data-box-size' ? boxSize : undefined),
    { editable: true, playVideoLabel: 'Watch video', playAudioLabel: 'Play audio' },
  );

  // A click on a facade button or a link must neither navigate the webview in place nor reach
  // VS Code's own anchor handling (which would open the URL a second time) - see
  // mediaEmbedFacadeClick.ts.
  wrapper.querySelectorAll<HTMLElement>('button[data-video-id], button[data-media-url], a[href]').forEach((el) => {
    el.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      openExternal(preview.url);
    });
  });
}

/**
 * Keeps only the blocks of a text note's `html` that `block` (the embed's `block` parameter,
 * `id` or `startId:endId`) points at. Returns the whole note when a block is missing, as upstream's
 * own renderer does for a block that has since been deleted.
 */
export function sliceEmbedHtmlToBlock(html: string, block: string | undefined): string {
  if (!block) {
    return html;
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return sliceToBlockReference(doc.body, block) ? doc.body.innerHTML : html;
}
