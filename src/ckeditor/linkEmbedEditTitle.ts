import { ButtonView, IconPencil, Plugin } from 'ckeditor5';

interface LinkEmbedTitleEditorConfig {
  edit?: (currentTitle: string) => Promise<string | undefined>;
}

/**
 * The "Edit title" button of a link preview's toolbar. Upstream (Trilium v0.107.0) folded title
 * editing into its app-level "Edit link" dialog (`editLink`, unported - see
 * apply-vendor-patches.mjs), so this asks the extension host for the new title through the
 * `linkEmbedTitle.edit` config callback (an input box) and rewrites the preview with it.
 */
export default class LinkEmbedEditTitleButton extends Plugin {

  public static get pluginName() {
    return 'LinkEmbedEditTitleButton' as const;
  }

  public init(): void {
    const editor = this.editor;

    editor.ui.componentFactory.add('linkEmbedEditTitle', (locale) => {
      const view = new ButtonView(locale);
      view.set({ label: editor.t('Edit title'), icon: IconPencil, tooltip: true });
      view.on('execute', () => void this.editTitle());
      return view;
    });
  }

  private async editTitle(): Promise<void> {
    const editor = this.editor;
    const selected = editor.model.document.selection.getSelectedElement();
    if (!selected || (selected.name !== 'linkEmbed' && selected.name !== 'linkMention')) {
      return;
    }

    const edit = (editor.config.get('linkEmbedTitle') as LinkEmbedTitleEditorConfig | undefined)?.edit;
    const title = await edit?.((selected.getAttribute('title') as string | undefined) ?? '');
    if (title === undefined || editor.state === 'destroyed' || selected.root.rootName === '$graveyard') {
      return;
    }

    editor.model.change((writer) => {
      const attributes = Object.fromEntries(selected.getAttributes());
      if (title) {
        attributes.title = title;
      } else {
        delete attributes.title;
      }
      const replacement = writer.createElement(selected.name, attributes);
      editor.model.insertObject(replacement, writer.createRangeOn(selected), null, { setSelection: 'on' });
    });
    editor.editing.view.focus();
  }
}
