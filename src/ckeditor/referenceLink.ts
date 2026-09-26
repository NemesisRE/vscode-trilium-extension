import {
  Command, type ModelElement, type ModelWriter, Plugin, toWidget,
  viewToModelPositionOutsideModelElement, type ViewDowncastWriter, type ViewElement, Widget,
} from 'ckeditor5';

export const INSERT_REFERENCE_LINK_COMMAND = 'referenceLink';

/**
 * Simplified reimplementation of Trilium's own `referencelink.ts` plugin: a widget
 * rendering `<a class="reference-link" href="...">{title}</a>`.
 *
 * Upstream resolves and live-updates the displayed title through Trilium's own note
 * cache (`glob.getReferenceLinkTitle`/`getReferenceLinkTitleSync`, and a `loadReferenceLinkTitle`
 * DOM hook for the editing view) - none of which exist in this standalone extension. This
 * version stores the title as a plain model attribute (`refTitle`), set once when the link
 * is inserted (see internalLink.ts) or read from existing saved HTML on upcast. It will not
 * follow a later rename of the target note - a known simplification, not an oversight.
 */
export default class ReferenceLink extends Plugin {

  public static get requires() {
    return [ReferenceLinkEditing] as const;
  }

}

class ReferenceLinkEditing extends Plugin {

  public static get requires() {
    return [Widget] as const;
  }

  public init() {
    this.defineSchema();
    this.defineConverters();

    this.editor.commands.add(INSERT_REFERENCE_LINK_COMMAND, new InsertReferenceLinkCommand(this.editor));

    this.editor.editing.mapper.on(
      'viewToModelPosition',
      viewToModelPositionOutsideModelElement(this.editor.model, (viewElement) => viewElement.hasClass('reference-link')),
    );

    // Ctrl/Cmd+click follows the link (matches CKEditor's own Link plugin, which requires
    // the modifier so a plain click stays safe for editing/selecting the widget). Bridged
    // through editor config since this bundle can't call acquireVsCodeApi() itself.
    this.listenTo(this.editor.editing.view.document, 'click', (_evt, data) => {
      const domEvent = (data as { domEvent?: MouseEvent }).domEvent;
      if (!domEvent || !(domEvent.ctrlKey || domEvent.metaKey)) {
        return;
      }
      for (let node = (data as { target?: ViewElement }).target; node; node = node.parent as ViewElement | undefined) {
        if (node.is?.('element', 'a') && node.hasClass('reference-link')) {
          const href = node.getAttribute('href');
          const openNote = (this.editor.config.get('referenceLink') as { openNote?: (href: string) => void } | undefined)?.openNote;
          if (href && openNote) {
            domEvent.preventDefault();
            openNote(String(href));
          }
          return;
        }
      }
    });
  }

  private defineSchema() {
    this.editor.model.schema.register('reference', {
      allowWhere: '$text',
      isInline: true,
      // Self-contained: the caret cannot be put inside it, and it is selected as a unit.
      isObject: true,
      allowAttributes: ['href', 'refTitle'],
    });
  }

  private defineConverters() {
    const editor = this.editor;
    const conversion = editor.conversion;

    conversion.for('upcast').elementToElement({
      view: { name: 'a', classes: ['reference-link'] },
      model: (viewElement: ViewElement, { writer }: { writer: ModelWriter }) => {
        const firstChild = viewElement.getChild(0);
        const refTitle = firstChild?.is('$text') ? firstChild.data : '';
        return writer.createElement('reference', {
          href: viewElement.getAttribute('href'),
          refTitle,
        });
      },
    });

    conversion.for('editingDowncast').elementToElement({
      model: 'reference',
      view: (modelItem: ModelElement, { writer }: { writer: ViewDowncastWriter }) => {
        const anchor = referenceAnchorView(modelItem, writer, true);
        return toWidget(anchor, writer, { label: editor.t('Note reference') });
      },
    });

    conversion.for('dataDowncast').elementToElement({
      model: 'reference',
      view: (modelItem: ModelElement, { writer }: { writer: ViewDowncastWriter }) => referenceAnchorView(modelItem, writer, false),
    });
  }

}

function referenceAnchorView(modelItem: ModelElement, writer: ViewDowncastWriter, unsafe: boolean) {
  const href = String(modelItem.getAttribute('href') ?? '');
  const title = String(modelItem.getAttribute('refTitle') ?? '') || href;
  const anchor = writer.createContainerElement(
    'a',
    { href, class: 'reference-link' },
    unsafe ? { renderUnsafeAttributes: ['href'] } : undefined,
  );
  writer.insert(writer.createPositionAt(anchor, 0), writer.createText(title));
  return anchor;
}

class InsertReferenceLinkCommand extends Command {

  public override refresh() {
    const model = this.editor.model;
    const selection = model.document.selection;
    const parent = selection.focus?.parent;
    this.isEnabled = !this.editor.isReadOnly
      && parent !== undefined
      && model.schema.checkChild(parent as ModelElement, 'reference');
  }

  public override execute({ href, title }: { href: string; title: string }) {
    if (!href?.trim()) {
      return;
    }

    const editor = this.editor;
    editor.model.change((writer: ModelWriter) => {
      const reference = writer.createElement('reference', { href, refTitle: title });
      editor.model.insertObject(reference, null, null, { setSelection: 'after' });
    });
  }

}
