import { ButtonView, Command, Plugin } from 'ckeditor5';
import internalLinkIcon from '../../vendor/ckeditor5/src/icons/trilium.svg?raw';
import ReferenceLink, { INSERT_REFERENCE_LINK_COMMAND } from './referenceLink.js';

export const COMMAND_NAME = 'insertInternalLink';

interface InternalLinkEditorConfig {
  pickNote?: () => Promise<{ href: string; title: string } | undefined>;
}

/**
 * Simplified reimplementation of Trilium's own `internallink.ts`.
 *
 * Upstream's command calls `glob.getComponentByEl(editorEl).triggerCommand('addLinkToText')`,
 * which opens Trilium's own app-level note-picker dialog - no equivalent here. This version
 * calls an `internalLink.pickNote` editor config callback instead, wired in
 * triliumTextEditorProvider.ts to the same debounced-search QuickPick already used by the
 * "Search Notes..." command, then inserts the result via referenceLink.ts's insert command.
 */
export default class InternalLinkPlugin extends Plugin {

  public static get requires() {
    return [ReferenceLink] as const;
  }

  public init() {
    const editor = this.editor;
    const t = editor.t;

    editor.commands.add(COMMAND_NAME, new InsertInternalLinkCommand(editor));

    editor.ui.componentFactory.add('internalLink', (locale) => {
      const view = new ButtonView(locale);

      view.set({
        label: t('Internal link'),
        icon: internalLinkIcon,
        tooltip: true,
      });

      const command = editor.commands.get(COMMAND_NAME) as Command;
      view.bind('isEnabled').to(command, 'isEnabled');
      view.on('execute', () => editor.execute(COMMAND_NAME));

      return view;
    });
  }

}

class InsertInternalLinkCommand extends Command {

  public override refresh() {
    const selection = this.editor.model.document.selection;
    const position = selection.getFirstPosition();
    const isInCodeBlock = position?.findAncestor('codeBlock');

    this.isEnabled = !this.editor.isReadOnly && !isInCodeBlock;
  }

  public override async execute() {
    const editor = this.editor;
    const config = editor.config.get('internalLink') as InternalLinkEditorConfig | undefined;
    if (!config?.pickNote) {
      return;
    }

    const picked = await config.pickNote();
    if (!picked) {
      return;
    }

    editor.execute(INSERT_REFERENCE_LINK_COMMAND, picked);
  }

}
