import { ButtonView, IconUnlink, Plugin } from 'ckeditor5';
import { REMOVE_LINK_EMBED_COMMAND } from '../../vendor/ckeditor5/src/plugins/link_embed/link_embed_commands';

/**
 * The Unlink button of a link preview's toolbar. Upstream (Trilium v0.107.0) moved Unlink into a
 * "More actions" menu (link_menu.ts) that needs its own app-level host and the unported
 * internallink.ts; the vendored link_embed_toolbar.ts is patched (see apply-vendor-patches.mjs) to
 * list this button instead of `editLink`/`linkMenu`.
 */
export default class LinkEmbedUnlinkButton extends Plugin {

  public static get pluginName() {
    return 'LinkEmbedUnlinkButton' as const;
  }

  public init(): void {
    const editor = this.editor;

    editor.ui.componentFactory.add('linkEmbedUnlink', (locale) => {
      const command = editor.commands.get(REMOVE_LINK_EMBED_COMMAND);
      const view = new ButtonView(locale);

      view.set({ label: editor.t('Unlink'), icon: IconUnlink, tooltip: true });
      if (command) {
        view.bind('isEnabled').to(command, 'isEnabled');
      }
      view.on('execute', () => editor.execute(REMOVE_LINK_EMBED_COMMAND));

      return view;
    });
  }
}
