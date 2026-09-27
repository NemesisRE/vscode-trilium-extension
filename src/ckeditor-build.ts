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
  Bookmark,
  ClassicEditor,
  Code,
  CodeBlock,
  EmojiPicker,
  EmojiRepository,
  Essentials,
  FindAndReplace,
  FontBackgroundColor,
  FontColor,
  FontFamily,
  FontSize,
  GeneralHtmlSupport,
  Heading,
  Highlight,
  HorizontalLine,
  Image,
  ImageCaption,
  ImageInline,
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
  PageBreak,
  Paragraph,
  PasteFromOffice,
  PictureEditing,
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
  TableSelection,
  TableToolbar,
  TextTransformation,
  TodoList,
  Underline,
  type EditorConfig,
} from 'ckeditor5';

// Import Trilium plugins from the consolidated package downloaded during build.
import Admonition from '../vendor/ckeditor5/src/plugins/admonition/admonition';
import Footnotes from '../vendor/ckeditor5/src/plugins/footnotes/footnotes';
import Kbd from '../vendor/ckeditor5/src/plugins/keyboard_marker/keyboard_marker';
import Math from '../vendor/ckeditor5/src/plugins/math/math';
import AutoformatMath from '../vendor/ckeditor5/src/plugins/math/autoformat_math';
import Mermaid from '../vendor/ckeditor5/src/plugins/mermaid/mermaid';
import Collapsible from '../vendor/ckeditor5/src/plugins/collapsible/collapsible';
import InlineIcon from '../vendor/ckeditor5/src/plugins/inline_icon/inline_icon';
import FileAttachmentLink from './ckeditor/fileAttachmentLink';
import InternalLink from './ckeditor/internalLink';
import { SyntaxHighlighting } from './ckeditor/syntaxHighlighting';
import TodoListMultistate from '../vendor/ckeditor5/src/plugins/todo_list_multistate/todo_list_multistate';
import TodoListUncheckOnEnter from '../vendor/ckeditor5/src/plugins/todo_list_uncheck_on_enter';
import ItalicAsEmPlugin from '../vendor/ckeditor5/src/plugins/italic_as_em';
import StrikethroughAsDel from '../vendor/ckeditor5/src/plugins/strikethrough_as_del';
import RemoveFormatLinksPlugin from '../vendor/ckeditor5/src/plugins/remove_format_links';
import IndentBlockShortcutPlugin from '../vendor/ckeditor5/src/plugins/indent_block_shortcut';
import InsertDateTimePlugin from '../vendor/ckeditor5/src/plugins/insert_date_time';
import CodeBlockToolbar from '../vendor/ckeditor5/src/plugins/code_block_toolbar';
import CodeBlockLanguageDropdown from '../vendor/ckeditor5/src/plugins/code_block_language_dropdown';
import CodeBlockInsertParagraph from '../vendor/ckeditor5/src/plugins/code_block_insert_paragraph';
import CodeBlockHljsClass from '../vendor/ckeditor5/src/plugins/code_block_hljs_class';
import MoveBlockUpDownPlugin from '../vendor/ckeditor5/src/plugins/move_block_updown';
import ScrollOnUndoRedoPlugin from '../vendor/ckeditor5/src/plugins/scroll_on_undo_redo';
import InlineCodeNoSpellcheck from '../vendor/ckeditor5/src/plugins/inline_code_no_spellcheck';
import InlineCodeToolbar from '../vendor/ckeditor5/src/plugins/inline_code_toolbar';
import CollapsibleListItems from '../vendor/ckeditor5/src/plugins/collapsible_list_items';
import TableIndent from '../vendor/ckeditor5/src/plugins/table_indent';
import ImageActions from '../vendor/ckeditor5/src/plugins/image_actions';
import ClipboardImageEmbed from '../vendor/ckeditor5/src/plugins/clipboard_image_embed';
import ClipboardBareImage from '../vendor/ckeditor5/src/plugins/clipboard_bare_image';
import FindInLinkWidgets from '../vendor/ckeditor5/src/plugins/find_in_link_widgets';
import TriliumFormatPainter from '../vendor/ckeditor5/src/plugins/format_painter/format_painter';
import './ckeditor/vendorTypeAugmentations';
import CutToNotePlugin from '../vendor/ckeditor5/src/plugins/cuttonote';
import CopyLinkUrlButton from '../vendor/ckeditor5/src/plugins/copy_link_url';
import CopyAnchorLinkButton from '../vendor/ckeditor5/src/plugins/copy_anchor_link';
import MarkdownImportPlugin from '../vendor/ckeditor5/src/plugins/markdownimport';
import Uploadfileplugin from '../vendor/ckeditor5/src/plugins/file_upload/uploadfileplugin';
import MentionCustomization from '../vendor/ckeditor5/src/plugins/mention_customization';
import TriliumEmojiMention from '../vendor/ckeditor5/src/plugins/mention/emoji_mention';
import TriliumMentionUI from '../vendor/ckeditor5/src/plugins/mention/trilium_mention_ui';
import TriliumSlashCommands from '../vendor/ckeditor5/src/plugins/mention/slash_commands';
import emojiDefinitions from '../vendor/ckeditor5/src/emoji_definitions/en.json';

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

// EmojiRepository always fetches its definitions from a URL (there's no "pass the data
// directly" option) and defaults to CKEditor's own CDN when none is given. Bundle the
// definitions file that's already vendored alongside the rest of Trilium's CKEditor package
// (esbuild's built-in JSON loader parses it at build time) and hand it a blob: URL instead, so
// the emoji picker works offline like everything else here.
const emojiDefinitionsUrl = URL.createObjectURL(
  new Blob([JSON.stringify(emojiDefinitions)], { type: 'application/json' }),
);

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
    ItalicAsEmPlugin,
    Underline,
    Strikethrough,
    StrikethroughAsDel,
    Code,
    Subscript,
    Superscript,
    RemoveFormat,
    RemoveFormatLinksPlugin,
    TextTransformation,
    TriliumFormatPainter,

    // Paragraph formatting
    Alignment,
    Heading,
    Paragraph,
    Indent,
    IndentBlock,
    IndentBlockShortcutPlugin,

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
    CollapsibleListItems,

    // Block elements
    BlockQuote,
    CodeBlock,
    CodeBlockToolbar,
    CodeBlockLanguageDropdown,
    CodeBlockInsertParagraph,
    CodeBlockHljsClass,
    SyntaxHighlighting,
    InlineCodeNoSpellcheck,
    InlineCodeToolbar,
    HorizontalLine,
    PageBreak,
    GeneralHtmlSupport,
    Bookmark,
    MoveBlockUpDownPlugin,
    ScrollOnUndoRedoPlugin,

    // Tables
    Table,
    TableToolbar,
    TableProperties,
    TableCellProperties,
    TableCaption,
    TableColumnResize,
    TableSelection,
    TableIndent,

    // Images
    Image,
    ImageCaption,
    ImageInline,
    ImageInsert,
    ImageResize,
    ImageStyle,
    ImageToolbar,
    ImageUpload,
    ImageActions,
    PictureEditing,
    ClipboardImageEmbed,
    ClipboardBareImage,
    AutoImage,
    LinkImage,

    // Links & Media
    Link,
    AutoLink,
    MediaEmbed,
    FindInLinkWidgets,
    CopyLinkUrlButton,
    CopyAnchorLinkButton,

    // Special characters & emoji
    SpecialCharacters,
    SpecialCharactersArrows,
    SpecialCharactersCurrency,
    SpecialCharactersEssentials,
    SpecialCharactersLatin,
    SpecialCharactersMathematical,
    SpecialCharactersText,
    EmojiRepository,
    EmojiPicker,

    // Utilities
    FindAndReplace,
    PasteFromOffice,
    InsertDateTimePlugin,
    CutToNotePlugin,
    MarkdownImportPlugin,

    // Trilium-specific plugins
    Admonition,
    Collapsible,
    Footnotes,
    Kbd,
    Math,
    AutoformatMath,
    Mermaid,
    InlineIcon,
    InternalLink,

    // Generic (non-image) file attachments, dropped/pasted via CKEditor's standard
    // FileRepository upload-adapter interface.
    Uploadfileplugin,
    FileAttachmentLink,

    // "@" note mentions, ":" emoji autocomplete and "/" slash commands, all hosted on the same TriliumMentionUI balloon.
    TriliumMentionUI,
    MentionCustomization,
    TriliumEmojiMention,
    TriliumSlashCommands,
  ];

  public static override defaultConfig = {
    toolbar: {
      // Grouped to mirror Trilium's own classic toolbar (apps/client/.../text/toolbar.ts,
      // buildClassicToolbar) - same clustering and nested "Text formatting"/"Insert" dropdowns,
      // trimmed to what this extension actually has plugins for. A few items Trilium's own
      // toolbar doesn't show (fontFamily, mediaEmbed, highlight, findAndReplace) are kept since
      // they already worked here and removing a working feature isn't "parity", just a
      // regression - they're grouped at the end instead of mixed into Trilium's own layout.
      items: [
        'heading',
        'fontSize',
        '|',
        'bold',
        'italic',
        {
          label: 'Text formatting',
          icon: 'text',
          items: ['underline', 'strikethrough', '|', 'superscript', 'subscript', '|', 'kbd'],
        },
        'formatPainter',
        '|',
        'fontColor',
        'fontBackgroundColor',
        'removeFormat',
        '|',
        'bulletedList',
        'numberedList',
        'todoList',
        'taskStateCycle',
        '|',
        'insertImage',
        'blockQuote',
        'admonition',
        'insertTable',
        '|',
        'code',
        'codeBlock',
        '|',
        'footnote',
        {
          label: 'Insert',
          icon: 'plus',
          items: [
            'link', 'internalLink', 'bookmark', '|',
            'collapsible', 'math', 'mermaid', 'horizontalLine', 'pageBreak', '|',
            'dateTime', 'specialCharacters', 'emoji', 'insertIcon',
          ],
        },
        '|',
        'alignment',
        'outdent',
        'indent',
        '|',
        'markdownImport',
        'cutToNote',
        '|',
        'undo',
        'redo',
        '|',
        'fontFamily',
        'mediaEmbed',
        'highlight',
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
    emoji: {
      definitionsUrl: emojiDefinitionsUrl,
    },
    // Adds the "Copy URL"/"Copy anchor link" buttons Trilium's own config includes
    // (apps/client/.../text/config.ts) onto the stock link/bookmark balloon toolbars,
    // next to their respective preview items.
    link: {
      toolbar: ['linkPreview', 'copyLinkUrl', '|', 'editLink', 'linkProperties', 'unlink'],
    },
    bookmark: {
      toolbar: ['bookmarkPreview', 'copyAnchorLink', '|', 'editBookmark', 'removeBookmark'],
    },
    image: {
      toolbar: [
        'imageTextAlternative',
        'toggleImageCaption',
        'imageStyle:inline',
        'imageStyle:block',
        'imageStyle:side',
        'linkImage',
        '|',
        'copyImageToClipboard',
        'downloadImage',
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
