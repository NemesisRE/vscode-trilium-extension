import { Plugin } from 'ckeditor5';
import { preventCKEditorHandling } from '../../vendor/ckeditor5/src/plugins/widget_utils.js';

const WIRED_ATTR = 'data-media-embed-facade-wired';

/**
 * CKEditor core's MediaEmbed providers only get a `html: match => string` config callback (see
 * mediaEmbedFacade.ts), unlike our own vendored linkEmbed widget (link_embed_editing.ts), which
 * builds its preview via `writer.createUIElement(...)` and so gets a render callback with direct
 * access to both the constructed DOM node and the editor instance. There is no equivalent hook here
 * to call `preventCKEditorHandling()` (widget_utils.ts) against the facade's `<a>` at creation time.
 *
 * `data-cke-ignore-events` on the anchor (still set by mediaEmbedFacade.ts) stops CKEditor's own
 * mousedown-observer-based widget-select gesture from firing for it, but two rounds of live testing
 * on PR #127 confirmed that alone isn't enough to make the click reliably reach the anchor's own
 * default action - the native `contenteditable="false"` focus/selection shift, and CKEditor's
 * WidgetTypeAround overlay mutating the DOM around the widget on selection, can still interfere with
 * the native mousedown -> mouseup -> click sequence a plain anchor relies on. So this plugin
 * re-applies, after the fact, the exact same fix our own widget already uses successfully: as soon
 * as a facade anchor appears in the DOM, wire it up with `preventCKEditorHandling()` directly.
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
    for (const domRoot of editor.editing.view.domRoots.values()) {
      domRoot.querySelectorAll<HTMLAnchorElement>(`.link-embed-video-facade:not([${WIRED_ATTR}])`).forEach((facade) => {
        facade.setAttribute(WIRED_ATTR, 'true');
        preventCKEditorHandling(facade, editor);
      });
    }
  }
}
