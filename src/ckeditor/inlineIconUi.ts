import { ButtonView, type Command, Plugin } from 'ckeditor5';
import bxSticker from 'boxicons/svg/regular/bx-sticker.svg?raw';
import { INSERT_ICON_COMMAND } from '../../vendor/ckeditor5/src/plugins/inline_icon/inline_icon_editing.js';

/**
 * The button `InlineIconToolbar` puts in the balloon over a selected icon. Named to match
 * upstream so the vendored, unmodified `inline_icon_toolbar.ts` can still import it from here.
 */
export const CHANGE_ICON = 'changeIcon';

interface InlineIconEditorConfig {
  showPicker?: () => Promise<string | undefined>;
}

/**
 * Simplified reimplementation of Trilium's own `InlineIconUI`.
 *
 * Upstream renders its picker as a live-search balloon drawn by the host application's own
 * React component tree (`glob.getComponentByEl(editorEl).showIconPicker(...)`), which has no
 * equivalent in this standalone extension. This version instead calls the `inlineIcon.showPicker`
 * editor config callback - wired up in triliumTextEditorProvider.ts to a VS Code QuickPick over
 * the bundled boxicons - and awaits its result, trading the in-context live preview for a native
 * QuickPick's text search.
 */
export default class InlineIconUI extends Plugin {

  public static get pluginName() {
    return 'InlineIconUI' as const;
  }

  public init() {
    const editor = this.editor;
    const t = editor.t;

    this.addPickerButton(INSERT_ICON_COMMAND, t('Insert icon'));
    this.addPickerButton(CHANGE_ICON, t('Change icon'));
  }

  public async showPicker() {
    const editor = this.editor;
    const config = editor.config.get('inlineIcon') as InlineIconEditorConfig | undefined;
    if (!config?.showPicker) {
      return;
    }

    const iconClass = await config.showPicker();
    if (!iconClass) {
      return;
    }

    editor.execute(INSERT_ICON_COMMAND, { iconClass });
    editor.editing.view.focus();
  }

  private addPickerButton(name: string, label: string) {
    const editor = this.editor;

    editor.ui.componentFactory.add(name, (locale) => {
      // Always registered: InlineIconEditing is loaded beside this plugin.
      const command = editor.commands.get(INSERT_ICON_COMMAND) as Command;
      const view = new ButtonView(locale);

      view.set({
        label,
        icon: bxSticker,
        tooltip: true,
      });

      view.bind('isEnabled').to(command, 'isEnabled');
      this.listenTo(view, 'execute', () => this.showPicker());

      return view;
    });
  }

}
