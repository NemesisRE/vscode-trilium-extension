/**
 * Custom CKEditor 5 build for Trilium VS Code extension.
 * 
 * This build includes:
 * - Standard CKEditor 5 Classic editor
 * - Trilium-specific plugins (admonition, math, mermaid, footnotes, keyboard-marker)
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

// Import Trilium plugins from vendor directory
// @ts-ignore - vendor directory created during build
import { Admonition } from '../vendor/ckeditor5-admonition/src/index.ts';
// @ts-ignore
import { Footnotes } from '../vendor/ckeditor5-footnotes/src/index.ts';
// @ts-ignore
import { Kbd } from '../vendor/ckeditor5-keyboard-marker/src/index.ts';
// @ts-ignore
import { Math } from '../vendor/ckeditor5-math/src/index.ts';
// @ts-ignore
import { Mermaid } from '../vendor/ckeditor5-mermaid/src/index.ts';
import { SyntaxHighlighting } from './ckeditor/syntaxHighlighting';

// Import all CSS - esbuild will bundle it
import 'ckeditor5/ckeditor5.css';
import '../vendor/ckeditor5-admonition/theme/blockquote.css';
import '../vendor/ckeditor5-footnotes/theme/footnote.css';
import '../vendor/ckeditor5-math/theme/mathform.css';
import '../vendor/ckeditor5-mermaid/theme/mermaid.css';
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
    Footnotes,
    Kbd,
    Math,
    Mermaid,
  ];

  public static override defaultConfig: EditorConfig = {
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
        'footnote',
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
  };
}

// Export for use in webview
(window as any).TriliumEditor = TriliumEditor;
