import { Plugin, type Editor, type ModelElement, type ModelNode, type ModelPosition, type ModelWriter } from 'ckeditor5';
import { getHighlightJs, mapCodeBlockLanguage } from './highlightSupport';

interface SpanStackEntry {
  className: string;
  posStart: ModelPosition;
}

const HIGHLIGHT_MAX_BLOCK_CHILDREN = 500;
let markerCounter = 0;

export class SyntaxHighlighting extends Plugin {
  public override init(): void {
    this.initTextEditor(this.editor);
    this.initLanguageDowncast();
  }

  private initTextEditor(editor: Editor): void {
    const document = editor.model.document;

    editor.conversion.for('editingDowncast').markerToHighlight({
      model: 'hljs',
      view: ({ markerName }) => {
        const [, cssClassName, id] = markerName.split(':');

        return {
          name: 'span',
          classes: [cssClassName],
          attributes: {
            'data-syntax-result': id,
          },
        };
      },
    });

    document.registerPostFixer(writer => {
      const dirtyCodeBlocks = new Set<ModelElement>();

      const lookForCodeBlocks = (node: ModelNode | ModelElement) => {
        if (!(node as ModelElement).getChildren) {
          return;
        }

        for (const child of (node as ModelElement).getChildren()) {
          if (child.is('element', 'paragraph')) {
            continue;
          }

          if (child.is('element', 'codeBlock')) {
            dirtyCodeBlocks.add(child);
            continue;
          }

          if ((child as ModelElement).childCount > 0) {
            lookForCodeBlocks(child as ModelElement);
          }
        }
      };

      for (const change of document.differ.getChanges()) {
        const anyChange = change as any;

        if (
          anyChange.type === 'attribute' &&
          anyChange.attributeKey === 'language'
        ) {
          const startParent = anyChange.range?.start?.parent;
          const endParent = anyChange.range?.end?.parent;
          const positionParent = anyChange.position?.parent;

          if (startParent?.is?.('element', 'codeBlock')) {
            dirtyCodeBlocks.add(startParent as ModelElement);
          }
          if (endParent?.is?.('element', 'codeBlock')) {
            dirtyCodeBlocks.add(endParent as ModelElement);
          }
          if (positionParent?.is?.('element', 'codeBlock')) {
            dirtyCodeBlocks.add(positionParent as ModelElement);
          }
          continue;
        }

        if (
          'name' in anyChange &&
          anyChange.name !== 'paragraph' &&
          anyChange.name !== 'codeBlock' &&
          anyChange.position?.nodeAfter &&
          (anyChange.position.nodeAfter as ModelElement).childCount > 0
        ) {
          lookForCodeBlocks(anyChange.position.nodeAfter as ModelElement);
          continue;
        }

        if (anyChange.type === 'insert' && anyChange.name === 'codeBlock') {
          const codeBlock = anyChange.position?.nodeAfter;
          if (codeBlock?.is?.('element', 'codeBlock')) {
            dirtyCodeBlocks.add(codeBlock as ModelElement);
          }
          continue;
        }

        if (
          (anyChange.type === 'remove' || anyChange.type === 'insert') &&
          anyChange.position?.parent?.is?.('element', 'codeBlock')
        ) {
          dirtyCodeBlocks.add(anyChange.position.parent as ModelElement);
        }
      }

      for (const codeBlock of dirtyCodeBlocks) {
        this.highlightCodeBlock(codeBlock, writer);
      }

      return false;
    });
  }

  private initLanguageDowncast(): void {
    const languageLabels = new Map<string, string>();
    const languageDefinitions = this.editor.config.get('codeBlock.languages') as Array<{
      language: string;
      label: string;
    }> | undefined;

    for (const definition of languageDefinitions ?? []) {
      languageLabels.set(definition.language, definition.label);
    }

    const updateCodeBlockLanguage = (
      eventName: string,
      setPreLabel: boolean,
    ) => {
      const dispatcher = setPreLabel ? this.editor.editing.downcastDispatcher : this.editor.data.downcastDispatcher;

      dispatcher.on(eventName as any, (_evt: unknown, data: any, conversionApi: any) => {
        if (!conversionApi.consumable.consume(data.item, eventName)) {
          return;
        }

        const viewCode = conversionApi.mapper.toViewElement(data.item as ModelElement);
        if (!viewCode || !viewCode.is('element', 'code')) {
          return;
        }

        const language = (data.attributeNewValue as string | null | undefined) ?? 'plaintext';
        const codeClass = `language-${language}`;

        conversionApi.writer.setAttribute('class', codeClass, viewCode);

        const viewPre = viewCode.parent;
        if (!viewPre || !viewPre.is('element', 'pre')) {
          return;
        }

        if (setPreLabel) {
          conversionApi.writer.setAttribute('data-language', languageLabels.get(language) ?? language, viewPre);
          conversionApi.writer.setAttribute('spellcheck', 'false', viewPre);
        }
      });
    };

    updateCodeBlockLanguage('attribute:language:codeBlock', true);
    updateCodeBlockLanguage('attribute:language:codeBlock', false);
  }

  private highlightCodeBlock(codeBlock: ModelElement, writer: ModelWriter): void {
    const model = this.editor.model;
    const codeBlockRange = model.createRangeIn(codeBlock);

    for (const marker of model.markers.getMarkersIntersectingRange(codeBlockRange)) {
      if (marker.name.startsWith('hljs:')) {
        writer.removeMarker(marker.name);
      }
    }

    if (codeBlock.childCount >= HIGHLIGHT_MAX_BLOCK_CHILDREN) {
      return;
    }

    const language = mapCodeBlockLanguage((codeBlock.getAttribute('language') as string | undefined) ?? null);
    if (!language) {
      return;
    }

    let text = '';
    for (let index = 0; index < codeBlock.childCount; index += 1) {
      const child = codeBlock.getChild(index);
      if (!child) {
        continue;
      }

      if (child.is('$text')) {
        text += child.data;
        continue;
      }

      if (child.is('element', 'softBreak')) {
        text += '\n';
      }
    }

    let highlighted: { value: string } | null = null;
    try {
      highlighted = getHighlightJs().highlight(text, { language, ignoreIllegals: true });
    } catch {
      return;
    }

    if (!highlighted?.value) {
      return;
    }

    this.applyHighlightMarkers(codeBlock, writer, highlighted.value);
  }

  private applyHighlightMarkers(codeBlock: ModelElement, writer: ModelWriter, html: string): void {
    const spanStack: SpanStackEntry[] = [];
    let child: ModelNode | null = null;
    let childText = '';
    let childIndex = -1;
    let childTextOffset = 0;
    let htmlIndex = 0;

    while (htmlIndex < html.length) {
      if (childTextOffset >= childText.length) {
        childIndex += 1;

        if (childIndex < codeBlock.childCount) {
          child = codeBlock.getChild(childIndex);
          if (!child) {
            childText = '';
            childTextOffset = 0;
            continue;
          }

          if (child.is('$text')) {
            childText = child.data;
            childTextOffset = 0;
          } else if (child.is('element', 'softBreak')) {
            childText = '\n';
            childTextOffset = 0;
          } else {
            childText = '';
            childTextOffset = 0;
            continue;
          }
        } else {
          childText = '';
        }
      }

      if (html[htmlIndex] === '<' && html[htmlIndex + 1] !== '/') {
        const quoteStart = html.indexOf('"', htmlIndex + 1);
        const quoteEnd = quoteStart >= 0 ? html.indexOf('"', quoteStart + 1) : -1;
        const tagEnd = html.indexOf('>', htmlIndex + 1);

        if (quoteStart < 0 || quoteEnd < 0 || tagEnd < 0) {
          return;
        }

        let className = html.slice(quoteStart + 1, quoteEnd);
        const firstClassSeparator = className.indexOf(' ');
        if (firstClassSeparator > 0) {
          className = className.slice(0, firstClassSeparator);
        }

        htmlIndex = tagEnd + 1;
        spanStack.push({
          className,
          posStart: writer.createPositionAt(codeBlock, this.getCodeBlockOffset(child, childTextOffset)),
        });
        continue;
      }

      if (html[htmlIndex] === '<' && html[htmlIndex + 1] === '/') {
        const tagEnd = html.indexOf('>', htmlIndex + 1);
        if (tagEnd < 0) {
          return;
        }

        htmlIndex = tagEnd + 1;

        const stackTop = spanStack.pop();
        if (!stackTop) {
          continue;
        }

        const range = writer.createRange(
          stackTop.posStart,
          writer.createPositionAt(codeBlock, this.getCodeBlockOffset(child, childTextOffset)),
        );
        const markerName = `hljs:${stackTop.className}:${markerCounter}`;
        markerCounter = (markerCounter + 1) & 0xffffff;
        writer.addMarker(markerName, { range, usingOperation: false });
        continue;
      }

      if (!child || childTextOffset >= childText.length) {
        return;
      }

      if (html[htmlIndex] === '&') {
        const entityEnd = html.indexOf(';', htmlIndex);
        if (entityEnd < 0) {
          return;
        }
        htmlIndex = entityEnd + 1;
      } else {
        htmlIndex += 1;
      }

      childTextOffset += 1;
    }
  }

  private getCodeBlockOffset(child: ModelNode | null, childTextOffset: number): number {
    return ((child as any)?.startOffset ?? 0) + childTextOffset;
  }
}
