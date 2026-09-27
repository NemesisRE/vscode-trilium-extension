import {
  type ModelElement, type ModelWriter, Plugin, toWidget,
  viewToModelPositionOutsideModelElement, type ViewDowncastWriter, type ViewElement, Widget,
} from 'ckeditor5';

interface FileAttachmentEditorConfig {
  openAttachment?: (attachmentId: string, filename: string) => void;
}

/**
 * Renders a widget for a generic (non-image) file attachment: `<a class="reference-link
 * file-attachment-link" href="#">📎 filename</a>`.
 *
 * Backs file_upload/uploadfileplugin.ts's generic upload flow (see its vendor patch): that
 * plugin creates the `fileAttachment` model element this schema/converters define, first with
 * just an `uploadId` while the file is uploading and then, once FileUploadEditing's own upload
 * tracking finishes, with `href` set to the new attachment's id (not a browsable URL - there is
 * nothing to navigate to inside the webview's CSP sandbox, so a click instead asks the extension
 * host to download and open the attachment, same as referenceLink.ts asks it to open a note).
 */
export default class FileAttachmentLink extends Plugin {

  public static get requires() {
    return [Widget] as const;
  }

  public init() {
    this.defineSchema();
    this.defineConverters();

    // A click opens the attachment. Mirrors referenceLink.ts's click handling: this is a widget
    // (isObject: true), so a plain click already just selects it rather than placing a caret.
    this.listenTo(this.editor.editing.view.document, 'click', (_evt, data) => {
      const domEvent = (data as { domEvent?: MouseEvent }).domEvent;
      if (!domEvent) {
        return;
      }
      for (let node = (data as { target?: ViewElement }).target; node; node = node.parent as ViewElement | undefined) {
        if (node.is?.('element', 'a') && node.hasClass('file-attachment-link')) {
          const attachmentId = node.getAttribute('href');
          const filename = node.getAttribute('data-filename');
          const openAttachment = (this.editor.config.get('fileAttachment') as FileAttachmentEditorConfig | undefined)?.openAttachment;
          if (attachmentId && openAttachment) {
            domEvent.preventDefault();
            openAttachment(String(attachmentId), String(filename ?? ''));
          }
          return;
        }
      }
    });
  }

  private defineSchema() {
    this.editor.model.schema.register('fileAttachment', {
      allowWhere: '$text',
      isInline: true,
      isObject: true,
      allowAttributes: ['href', 'filename', 'uploadId', 'uploadStatus'],
    });
  }

  private defineConverters() {
    const editor = this.editor;
    const conversion = editor.conversion;

    conversion.for('upcast').elementToElement({
      view: { name: 'a', classes: ['file-attachment-link'] },
      model: (viewElement: ViewElement, { writer }: { writer: ModelWriter }) => writer.createElement('fileAttachment', {
        href: viewElement.getAttribute('href'),
        filename: viewElement.getAttribute('data-filename'),
      }),
    });

    conversion.for('editingDowncast').elementToElement({
      model: 'fileAttachment',
      view: (modelItem: ModelElement, { writer }: { writer: ViewDowncastWriter }) => {
        const anchor = fileAttachmentAnchorView(modelItem, writer);
        return toWidget(anchor, writer, { label: editor.t('File attachment') });
      },
    });

    conversion.for('dataDowncast').elementToElement({
      model: 'fileAttachment',
      view: (modelItem: ModelElement, { writer }: { writer: ViewDowncastWriter }) => fileAttachmentAnchorView(modelItem, writer),
    });
  }

}

function fileAttachmentAnchorView(modelItem: ModelElement, writer: ViewDowncastWriter) {
  const href = String(modelItem.getAttribute('href') ?? '');
  const filename = String(modelItem.getAttribute('filename') ?? '');
  const uploading = !href;
  const anchor = writer.createContainerElement('a', {
    href: href || '#',
    class: 'reference-link file-attachment-link',
    'data-filename': filename,
  });
  const label = uploading ? `Uploading ${filename}…` : (filename || href);
  writer.insert(writer.createPositionAt(anchor, 0), writer.createText(`📎 ${label}`));
  return anchor;
}
