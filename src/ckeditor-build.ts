/**
 * Custom CKEditor 5 build for Trilium VS Code extension.
 *
 * This build includes:
 * - Standard CKEditor 5 Classic editor
 * - Trilium-specific plugins (admonition, collapsible, footnotes, keyboard-marker, math, mermaid, todo-list multistate)
 * - Additional formatting and editing features
 */

import {
  AccessibilityHelp,
  Alignment,
  AutoImage,
  AutoLink,
  Autoformat,
  Autosave,
  BlockQuote,
  Bold,
  ClassicEditor,
  Code,
  CodeBlock,
  Essentials,
  FindAndReplace,
  FontBackgroundColor,
  FontColor,
  FontFamily,
  FontSize,
  Heading,
  Highlight,
  HorizontalLine,
  Image,
  ImageCaption,
  ImageInsert,
  ImageResize,
  ImageStyle,
  ImageToolbar,
  ImageUpload,
  Indent,
  IndentBlock,
  Italic,
  Link,
  LinkImage,
  List,
  ListProperties,
  MediaEmbed,
  Paragraph,
  PasteFromOffice,
  RemoveFormat,
  SpecialCharacters,
  SpecialCharactersArrows,
  SpecialCharactersCurrency,
  SpecialCharactersEssentials,
  SpecialCharactersLatin,
  SpecialCharactersMathematical,
  SpecialCharactersText,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  TableCaption,
  TableCellProperties,
  TableColumnResize,
  TableProperties,
  TableToolbar,
  TodoList,
  Underline,
  type EditorConfig,
} from 'ckeditor5';

// Import Trilium plugins from the consolidated package downloaded during build.
import Admonition from '../vendor/ckeditor5/src/plugins/admonition/admonition';
import Footnotes from '../vendor/ckeditor5/src/plugins/footnotes/footnotes';
import Kbd from '../vendor/ckeditor5/src/plugins/keyboard_marker/keyboard_marker';
import Math from '../vendor/ckeditor5/src/plugins/math/math';
import Mermaid from '../vendor/ckeditor5/src/plugins/mermaid/mermaid';
import Collapsible from '../vendor/ckeditor5/src/plugins/collapsible/collapsible';
import InlineIcon from '../vendor/ckeditor5/src/plugins/inline_icon/inline_icon';
import { SyntaxHighlighting } from './ckeditor/syntaxHighlighting';
import TodoListMultistate from '../vendor/ckeditor5/src/plugins/todo_list_multistate/todo_list_multistate';
import TodoListUncheckOnEnter from '../vendor/ckeditor5/src/plugins/todo_list_uncheck_on_enter';

// Import all CSS - esbuild will bundle it
import 'ckeditor5/ckeditor5.css';
import '../vendor/ckeditor5/src/theme/blockquote.css';
import '../vendor/ckeditor5/src/theme/footnotes.css';
import '../vendor/ckeditor5/src/theme/math_form.css';
// KaTeX's rendered math output relies entirely on its own CSS (glyph
// positioning, font-face declarations) - never wired up before, which is why
// rendered equations came out unstyled/overflowing rather than typeset math.
import 'katex/dist/katex.css';
import '../vendor/ckeditor5/src/theme/mermaid.css';
import '../vendor/ckeditor5/src/theme/collapsible.css';
import './ckeditor/trilium-parity.css';
import 'mathlive/fonts.css';
import 'mathlive/static.css';

/**
 * TriliumEditor - Custom CKEditor 5 build with Trilium plugins.
 */
export class TriliumEditor extends ClassicEditor {
  public static override builtinPlugins = [
    // Core essentials
    Essentials,
    Autoformat,
    Autosave,
    AccessibilityHelp,

    // Text formatting
    Bold,
    Italic,
    Underline,
    Strikethrough,
    Code,
    Subscript,
    Superscript,
    RemoveFormat,

    // Paragraph formatting
    Alignment,
    Heading,
    Paragraph,
    Indent,
    IndentBlock,

    // Font styling
    FontFamily,
    FontSize,
    FontColor,
    FontBackgroundColor,
    Highlight,

    // Lists
    List,
    ListProperties,
    TodoList,
    TodoListUncheckOnEnter,
    TodoListMultistate,

    // Block elements
    BlockQuote,
    CodeBlock,
    SyntaxHighlighting,
    HorizontalLine,

    // Tables
    Table,
    TableToolbar,
    TableProperties,
    TableCellProperties,
    TableCaption,
    TableColumnResize,

    // Images
    Image,
    ImageCaption,
    ImageInsert,
    ImageResize,
    ImageStyle,
    ImageToolbar,
    ImageUpload,
    AutoImage,
    LinkImage,

    // Links & Media
    Link,
    AutoLink,
    MediaEmbed,

    // Special characters
    SpecialCharacters,
    SpecialCharactersArrows,
    SpecialCharactersCurrency,
    SpecialCharactersEssentials,
    SpecialCharactersLatin,
    SpecialCharactersMathematical,
    SpecialCharactersText,

    // Utilities
    FindAndReplace,
    PasteFromOffice,

    // Trilium-specific plugins
    Admonition,
    Collapsible,
    Footnotes,
    Kbd,
    Math,
    Mermaid,
    InlineIcon,
  ];

  public static override defaultConfig = {
    toolbar: {
      items: [
        'heading',
        '|',
        'bold',
        'italic',
        'underline',
        'strikethrough',
        '|',
        'fontSize',
        'fontFamily',
        'fontColor',
        'fontBackgroundColor',
        '|',
        'alignment',
        'outdent',
        'indent',
        '|',
        'bulletedList',
        'numberedList',
        'todoList',
        'taskStateCycle',
        '|',
        'link',
        'insertImage',
        'insertTable',
        'mediaEmbed',
        'blockQuote',
        'codeBlock',
        'horizontalLine',
        '|',
        'math',
        'mermaid',
        'admonition',
        'collapsible',
        'footnote',
        'insertIcon',
        '|',
        'specialCharacters',
        'highlight',
        '|',
        'undo',
        'redo',
        '|',
        'findAndReplace',
      ],
      shouldNotGroupWhenFull: true,
    },
    language: 'en',
    contentHintsEnabled: false,
    math: {
      engine: 'mathjax',
      outputType: 'script',
      enablePreview: true,
    },
    image: {
      toolbar: [
        'imageTextAlternative',
        'toggleImageCaption',
        'imageStyle:inline',
        'imageStyle:block',
        'imageStyle:side',
        'linkImage',
      ],
    },
    table: {
      contentToolbar: [
        'tableColumn',
        'tableRow',
        'mergeTableCells',
        'tableCellProperties',
        'tableProperties',
      ],
    },
    codeBlock: {
      languages: [
        { language: 'plaintext', label: 'Plain text' },
        { language: 'javascript', label: 'JavaScript' },
        { language: 'typescript', label: 'TypeScript' },
        { language: 'python', label: 'Python' },
        { language: 'java', label: 'Java' },
        { language: 'csharp', label: 'C#' },
        { language: 'cpp', label: 'C++' },
        { language: 'c', label: 'C' },
        { language: 'php', label: 'PHP' },
        { language: 'ruby', label: 'Ruby' },
        { language: 'go', label: 'Go' },
        { language: 'rust', label: 'Rust' },
        { language: 'swift', label: 'Swift' },
        { language: 'kotlin', label: 'Kotlin' },
        { language: 'html', label: 'HTML' },
        { language: 'xml', label: 'XML' },
        { language: 'css', label: 'CSS' },
        { language: 'scss', label: 'SCSS' },
        { language: 'sql', label: 'SQL' },
        { language: 'bash', label: 'Bash' },
        { language: 'shell', label: 'Shell' },
        { language: 'powershell', label: 'PowerShell' },
        { language: 'json', label: 'JSON' },
        { language: 'yaml', label: 'YAML' },
        { language: 'markdown', label: 'Markdown' },
        { language: 'diff', label: 'Diff' },
      ],
    },
  } as EditorConfig;
}

// Export for use in webview
(window as any).TriliumEditor = TriliumEditor;

// Lazy-loaders for the math/mermaid plugins' `lazyLoad` config. These run as
// dynamic import()s inside this bundle (not in the webview's own inline
// script, which can't resolve bare module specifiers), so esbuild's
// code-splitting produces separate on-demand chunks for katex/mermaid
// instead of always bundling them into the main ckeditor.js.
//
// The math plugin's `lazyLoad` return value is discarded (its type is
// Promise<void>) - it awaits the promise purely as a completion signal, then
// re-checks `window.katex`, expecting `lazyLoad` to have assigned it as a
// side effect. Unlike the CDN's UMD-ish build, the plain npm katex.mjs module
// never does this itself, so it has to happen here explicitly.
export async function loadKatex() {
  (window as any).katex = await import('katex');
}

export async function loadMermaid() {
  const mermaid = await import('mermaid');
  return mermaid.default;
}
