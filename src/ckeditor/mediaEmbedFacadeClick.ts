import { Plugin } from 'ckeditor5';
import { preventCKEditorHandling } from '../../vendor/ckeditor5/src/plugins/widget_utils.js';

const WIRED_ATTR = 'data-media-embed-facade-wired';

interface MediaEmbedFacadeEditorConfig {
  openExternal?: (url: string) => void;
}

/**
 * Makes the native MediaEmbed facade's <a> (mediaEmbedFacade.ts) actually open its video when
 * clicked. Two earlier fixes on PR #127 (dropping target="_blank", then wiring
 * preventCKEditorHandling() the same way our own linkEmbed widget does) both turned out to target
 * the wrong layer: live testing (a synthetic .click() confirmed on the exact wired anchor, in the
 * page's own devtools console) showed the click's default action *was* firing - the browser was
 * genuinely trying to navigate this webview's own nested iframe to the video URL in place - and
 * that in-place navigation is what VS Code's outer webview host itself blocks, as a "framing"
 * attempt against its own frame-src CSP ("Framing '...' violates ... frame-src 'self'"), before its
 * usual open-this-link-externally handling ever gets a chance to run. CKEditor was never the
 * problem; a plain anchor click just isn't a reliable way to leave this specific webview at all.
 *
 * The fix is to stop relying on anchor navigation for this facade altogether and instead go through
 * the extension host explicitly - the same round trip openBreadcrumbNote/openAttachment already use
 * (see the `mediaEmbedFacade.openExternal` editor config callback wired in
 * triliumTextEditorProvider.ts, which posts an `openExternalLink` message the host handles with
 * `vscode.env.openExternal()`). `preventCKEditorHandling()` is still applied too, for the same
 * widget-selection/toolbar behavior our own widget gets - it just no longer needs to make the
 * anchor's own navigation work, since this plugin's own click listener replaces that entirely.
 */
export default class MediaEmbedFacadeClickHandling extends Plugin {
  public static get pluginName() {
    return 'MediaEmbedFacadeClickHandling' as const;
  }

  public init(): void {
    const editor = this.editor;
    editor.editing.view.document.on('layoutChanged', () => this._wireFacades());
    editor.ui.once('ready', () => this._wireFacades());
  }

  private _wireFacades(): void {
    const editor = this.editor;
    const openExternal = (editor.config.get('mediaEmbedFacade') as MediaEmbedFacadeEditorConfig | undefined)?.openExternal;

    for (const domRoot of editor.editing.view.domRoots.values()) {
      domRoot.querySelectorAll<HTMLAnchorElement>(`.link-embed-video-facade:not([${WIRED_ATTR}])`).forEach((facade) => {
        facade.setAttribute(WIRED_ATTR, 'true');
        preventCKEditorHandling(facade, editor);
        facade.addEventListener('click', (evt) => {
          evt.preventDefault();
          openExternal?.(facade.href);
        });
      });
    }
  }
}
