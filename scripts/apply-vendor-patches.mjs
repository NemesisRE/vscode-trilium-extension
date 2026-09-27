import * as fs from 'fs';
import * as path from 'path';

/**
 * Applies local patches to vendor files that are incompatible with the project's TypeScript setup.
 * These patches are the intended stabilization point when Trilium plugin-ref updates
 * pull in upstream CKEditor changes that do not compile cleanly in this repo.
 */
export function applyVendorPatches(vendorDir, logPrefix = '[patch-plugins]') {
  // The standalone extension does not ship Trilium's monorepo commons package.
  // Keep the native todo plugin intact while redirecting its small commons surface
  // to the local compatibility module.
  const todoPluginDir = path.join(vendorDir, 'ckeditor5', 'src', 'plugins', 'todo_list_multistate');
  for (const fileName of ['todo_list_multistate_autoformat.ts', 'todo_list_multistate_editing.ts']) {
    const filePath = path.join(todoPluginDir, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    let src = fs.readFileSync(filePath, 'utf8');
    const before = src;
    src = src.replaceAll('from "@triliumnext/commons"', 'from "../../../../../src/ckeditor/triliumCommons"');
    if (src !== before) {
      fs.writeFileSync(filePath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5/src/plugins/todo_list_multistate/${fileName}`);
    }
  }

  // Upstream renders the task-state buttons with the Boxicons webfont plus a CSS-glyph preview.
  // Neither works in the webview, so the button uses the SVG the host resolved for the state and
  // a per-state class the generated stylesheet can colour. `withText` stays false, which keeps the
  // state name on hover instead of widening the balloon past the editor.
  const todoUiPath = path.join(todoPluginDir, 'todo_list_multistate_ui.ts');
  if (fs.existsSync(todoUiPath)) {
    let src = fs.readFileSync(todoUiPath, 'utf8');
    const before = src;
    src = src.replace(
      /\n                \/\/ A checkbox preview[\s\S]*?button\.children\.add\(preview\);/,
      ''
    );
    src = src.replace(
      'label: state.title || state.name,\n                    withText: false,\n                    tooltip: true,\n                    class: "ck-task-state-button"',
      'label: state.title || state.name,\n                    icon: state.iconSvg || undefined,\n                    withText: false,\n                    tooltip: true,\n                    class: `ck-task-state-button ck-task-state-button-${state.name.replace(/[^a-zA-Z0-9_-]/g, "-")}`'
    );
    if (src !== before) {
      fs.writeFileSync(todoUiPath, src, 'utf8');
      console.log(`${logPrefix} patched native task-state button icons`);
    }
  }

  const todoToolbarPath = path.join(vendorDir, 'ckeditor5', 'src', 'plugins', 'todo_list_multistate', 'todo_list_multistate_toolbar.ts');
  if (fs.existsSync(todoToolbarPath)) {
    let src = fs.readFileSync(todoToolbarPath, 'utf8');
    const before = src;
    // Upstream only offers horizontally centred positions. A checkbox sits at the very left of
    // the content, so centring pushes the balloon past the left edge. The `*West` variants align
    // it with the checkbox instead, and `limiter` keeps the choice inside the editing root.
    src = src.replace(
      'const position = {\n            target: anchorDom,\n            positions: [\n                BalloonPanelView.defaultPositions.northArrowSouth,\n                BalloonPanelView.defaultPositions.southArrowNorth\n            ]\n        };',
      'const position = {\n            target: anchorDom,\n            limiter: editor.editing.view.getDomRoot() ?? undefined,\n            positions: [\n                BalloonPanelView.defaultPositions.northArrowSouthWest,\n                BalloonPanelView.defaultPositions.southArrowNorthWest,\n                BalloonPanelView.defaultPositions.northArrowSouth,\n                BalloonPanelView.defaultPositions.southArrowNorth\n            ]\n        };'
    );
    // "Edit task states" opens Trilium's own settings screen, which this host does not provide,
    // so the button would only close the balloon. Dropping it also keeps the menu compact.
    src = src.replace(
      '        toolbar.items.add(new ToolbarSeparatorView(editor.locale));\n        toolbar.items.add(this._createEditButton());\n',
      ''
    );
    if (src !== before) {
      fs.writeFileSync(todoToolbarPath, src, 'utf8');
      console.log(`${logPrefix} constrained native task-state balloon`);
    }
  }

  const collapsibleEditingPath = path.join(vendorDir, 'ckeditor5', 'src', 'plugins', 'collapsible', 'collapsible_editing.ts');
  if (fs.existsSync(collapsibleEditingPath)) {
    let src = fs.readFileSync(collapsibleEditingPath, 'utf8');
    const before = src;
    src = src.replace(
      '        enableViewPlaceholder({\n            view: this.editor.editing.view,\n            element: summary,\n            text: t("Summary"),\n            keepOnFocus: true\n        });',
      '        summary.placeholder = t("Summary");\n        enableViewPlaceholder({\n            view: this.editor.editing.view,\n            element: summary,\n            keepOnFocus: true\n        });'
    );
    src = src.replace(
      '                enableViewPlaceholder({\n                    view: editor.editing.view,\n                    element: view,\n                    text: t("Type the content here..."),\n                    keepOnFocus: true\n                });',
      '                view.placeholder = t("Type the content here...");\n                enableViewPlaceholder({\n                    view: editor.editing.view,\n                    element: view,\n                    keepOnFocus: true\n                });'
    );
    if (src !== before) {
      fs.writeFileSync(collapsibleEditingPath, src, 'utf8');
      console.log(`${logPrefix} patched collapsible placeholder API`);
    }
  }

  // ckeditor5-math: renderMathJax3 leaves behind previous renders if called multiple times,
  // causing duplicate equations. We need to clear all children before appending the new render.
  // Also: once katex's own package types are reachable in this program (see loadKatex() in
  // ckeditor-build.ts), TS2686 flags the bare `katex` identifier here as a UMD global used from
  // a module without an import - switch to `window.katex`, matching the guard just above it,
  // which resolves the same way without triggering that restriction. And: the constructed options
  // object is built against this vendor's own (looser) local KatexOptions shape, which no longer
  // matches katex's own (stricter) KatexOptions once render()'s type comes from the real package -
  // cast it, since the actual runtime values are unaffected either way.
  const mathUtilsPath = path.join(vendorDir, 'ckeditor5', 'src', 'plugins', 'math', 'utils.ts');
  if (fs.existsSync(mathUtilsPath)) {
    let src = fs.readFileSync(mathUtilsPath, 'utf8');
    const before = src;
    src = src.replace(
      "if ( element.firstChild ) {\n\t\t\t\telement.removeChild( element.firstChild );\n\t\t\t}",
      "while ( element.firstChild ) {\n\t\t\t\telement.removeChild( element.firstChild );\n\t\t\t}"
    );
    src = src.replace(
      "if ( katex ) {\n\t\t\t\t\tkatex.render( equation, el, {\n\t\t\t\t\t\tthrowOnError: false,\n\t\t\t\t\t\tdisplayMode: display,\n\t\t\t\t\t\t...katexRenderOptions,\n\t\t\t\t\t\t...normalizeKatexMacros( katexRenderOptions )\n\t\t\t\t\t} );",
      "if ( window.katex ) {\n\t\t\t\t\twindow.katex.render( equation, el, ( {\n\t\t\t\t\t\tthrowOnError: false,\n\t\t\t\t\t\tdisplayMode: display,\n\t\t\t\t\t\t...katexRenderOptions,\n\t\t\t\t\t\t...normalizeKatexMacros( katexRenderOptions )\n\t\t\t\t\t} ) as Parameters<typeof window.katex.render>[ 2 ] );"
    );
    if (src !== before) {
      fs.writeFileSync(mathUtilsPath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5/src/plugins/math/utils.ts`);
    }
  }

  // ckeditor5-math: this file's own `declare global { var katex: ...; }` (with a
  // hand-written minimal Katex interface) exists for when katex is loaded as a
  // runtime global. We statically import the real katex package elsewhere in
  // this build (see ckeditor-build.ts's loadKatex()), and katex's own .d.ts
  // already declares the same global via `export as namespace katex;`, so
  // once both are reachable in the same compile they collide as a duplicate
  // identifier. Drop the vendor's now-redundant copy; katex's own (more
  // accurate) global declaration covers utils.ts's `katex` reference instead.
  const mathTypingsPath = path.join(vendorDir, 'ckeditor5', 'src', 'plugins', 'math', 'typings_external.ts');
  if (fs.existsSync(mathTypingsPath)) {
    let src = fs.readFileSync(mathTypingsPath, 'utf8');
    const before = src;
    src = src.replace(
      "export interface Katex {\n\trender( equation: string, el: HTMLElement, options: KatexOptions ): void;\n}\n\n",
      "",
    );
    src = src.replace(
      "\t// eslint-disable-next-line no-var\n\tvar katex: undefined | Katex;\n",
      "",
    );
    if (src !== before) {
      fs.writeFileSync(mathTypingsPath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5/src/plugins/math/typings_external.ts`);
    }
  }

  // ckeditor5-mermaid: the debounced textarea input listener leaves its `event` parameter
  // implicitly typed and accesses `event.target.value` without narrowing target's type,
  // so give it an explicit `Event` type and guard the HTMLInputElement cast.
  const mermaidEditingPath = path.join(vendorDir, 'ckeditor5', 'src', 'plugins', 'mermaid', 'mermaid_editing.ts');
  if (fs.existsSync(mermaidEditingPath)) {
    let src = fs.readFileSync(mermaidEditingPath, 'utf8');
    const before = src;
    src = src.replace(
      "\t\t\tconst debouncedListener = debounce( event => {",
      "\t\t\tconst debouncedListener = debounce( ( event: Event ) => {",
    );
    src = src.replace(
      "\t\t\t\teditor.model.change( writer => {\n\t\t\t\t\twriter.setAttribute( 'source', event.target.value, data.item as ModelNode );\n\t\t\t\t} );",
      "\t\t\t\tconst target = event.target as HTMLInputElement | null;\n\t\t\t\tif ( !target ) {\n\t\t\t\t\treturn;\n\t\t\t\t}\n\n\t\t\t\teditor.model.change( writer => {\n\t\t\t\t\twriter.setAttribute( 'source', target.value, data.item as ModelNode );\n\t\t\t\t} );",
    );
    if (src !== before) {
      fs.writeFileSync(mermaidEditingPath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5/src/plugins/mermaid/mermaid_editing.ts`);
    }
  }

  // ckeditor5-inline_icon: both files import the upstream InlineIconUI, whose picker is
  // rendered by Trilium's own app-level React component tree
  // (glob.getComponentByEl(editorEl).showIconPicker(...)), which does not exist in this
  // standalone extension. Redirect both imports to our own InlineIconUI
  // (src/ckeditor/inlineIconUi.ts), which calls an editor-config callback wired to a VS
  // Code QuickPick instead. inline_icon_editing.ts has no such dependency and is used
  // unmodified.
  const inlineIconPath = path.join(vendorDir, 'ckeditor5', 'src', 'plugins', 'inline_icon', 'inline_icon.ts');
  if (fs.existsSync(inlineIconPath)) {
    let src = fs.readFileSync(inlineIconPath, 'utf8');
    const before = src;
    src = src.replace(
      'import InlineIconUI from "./inline_icon_ui.js";',
      'import InlineIconUI from "../../../../../src/ckeditor/inlineIconUi.js";',
    );
    if (src !== before) {
      fs.writeFileSync(inlineIconPath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5/src/plugins/inline_icon/inline_icon.ts`);
    }
  }

  const inlineIconToolbarPath = path.join(vendorDir, 'ckeditor5', 'src', 'plugins', 'inline_icon', 'inline_icon_toolbar.ts');
  if (fs.existsSync(inlineIconToolbarPath)) {
    let src = fs.readFileSync(inlineIconToolbarPath, 'utf8');
    const before = src;
    src = src.replace(
      'import InlineIconUI, { CHANGE_ICON } from "./inline_icon_ui.js";',
      'import InlineIconUI, { CHANGE_ICON } from "../../../../../src/ckeditor/inlineIconUi.js";',
    );
    // Upstream only offers horizontally centred positions (the default WidgetToolbarRepository
    // candidate list). Confirmed by a headless reproduction: an icon inserted near the left edge
    // of a narrow editing pane (a common case here - VS Code editor panes can be much narrower
    // than Trilium's own browser tab) gets a balloon centred over it that renders with a negative
    // `left`, i.e. partly off-screen. The same fix used below for the todo-list task-state balloon
    // (preferring CKEditor's `*West`/`*East` presets) turned out not to be enough here: those
    // presets still use a flat ~25px arrow offset regardless of how much room is actually left,
    // so a target within that distance of the edge (as in the reproduction) still clips. Use our
    // own edge-clamped positions (src/ckeditor/balloonPositions.ts) first instead, which size the
    // offset to the room actually available; the presets stay as a fallback.
    src = src.replace(
      'import {\n    addListToDropdown, Collection, type Command, createDropdown,\n    type ListDropdownItemDefinition, type LocaleTranslate, Plugin, UIModel, WidgetToolbarRepository\n} from "ckeditor5";',
      'import {\n    addListToDropdown, BalloonPanelView, Collection, type Command, createDropdown,\n    type ListDropdownItemDefinition, type LocaleTranslate, Plugin, UIModel, WidgetToolbarRepository\n} from "ckeditor5";\nimport { edgeClampedToolbarPositions } from "../../../../../src/ckeditor/balloonPositions.js";',
    );
    src = src.replace(
      '    afterInit() {\n        this.editor.plugins.get(WidgetToolbarRepository).register(ICON, {\n            ariaLabel: this.editor.t("Icon toolbar"),\n            items: [ CHANGE_ICON, ICON_TRANSFORM_COMMAND ],\n            getRelatedElement: (selection) => {',
      '    afterInit() {\n        const editor = this.editor;\n\n        editor.plugins.get(WidgetToolbarRepository).register(ICON, {\n            ariaLabel: editor.t("Icon toolbar"),\n            items: [ CHANGE_ICON, ICON_TRANSFORM_COMMAND ],\n            positions: [\n                ...edgeClampedToolbarPositions(editor),\n                BalloonPanelView.defaultPositions.northArrowSouthWest,\n                BalloonPanelView.defaultPositions.southArrowNorthWest,\n                BalloonPanelView.defaultPositions.northArrowSouth,\n                BalloonPanelView.defaultPositions.southArrowNorth,\n                BalloonPanelView.defaultPositions.northArrowSouthEast,\n                BalloonPanelView.defaultPositions.southArrowNorthEast\n            ],\n            getRelatedElement: (selection) => {',
    );
    if (src !== before) {
      fs.writeFileSync(inlineIconToolbarPath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5/src/plugins/inline_icon/inline_icon_toolbar.ts`);
    }
  }

  // Same "no @triliumnext/commons in this standalone extension" situation as the todo plugin
  // above - these two clipboard-paste plugins only need the one shared attribute-name constant.
  const clipboardPluginsDir = path.join(vendorDir, 'ckeditor5', 'src', 'plugins');
  for (const fileName of ['clipboard_image_embed.ts', 'clipboard_bare_image.ts']) {
    const filePath = path.join(clipboardPluginsDir, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    let src = fs.readFileSync(filePath, 'utf8');
    const before = src;
    src = src.replaceAll('from "@triliumnext/commons"', 'from "../../../../src/ckeditor/triliumCommons"');
    if (src !== before) {
      fs.writeFileSync(filePath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5/src/plugins/${fileName}`);
    }
  }

  // insert_date_time.ts formats "now" through Trilium's own app-level date service
  // (glob.getComponentByEl(editorEl).formatDateTime(...), for the user's configured
  // customDateTimeFormat) which has no equivalent here. Redirect to a small local formatter
  // (src/ckeditor/insertDateTimeFormat.ts) covering the same fixed preset formats the plugin
  // itself offers - there's no "custom format" setting in this extension to honour instead.
  const insertDateTimePath = path.join(vendorDir, 'ckeditor5', 'src', 'plugins', 'insert_date_time.ts');
  if (fs.existsSync(insertDateTimePath)) {
    let src = fs.readFileSync(insertDateTimePath, 'utf8');
    const before = src;
    // Unlike the replacements above, the search string here (the dateTimeIcon import) is not
    // itself removed by patching - it stays in the file with the new import appended after it -
    // so a second call (e.g. this repo's CI re-runs applyVendorPatches on a cache hit, against
    // an already-patched vendor/ tree) would insert a duplicate import. Guard on the new
    // import's own presence instead, the same way the other replacements are naturally guarded
    // by their search string disappearing once applied.
    if (!src.includes('insertDateTimeFormat.js')) {
      src = src.replace(
        "import dateTimeIcon from '../icons/date-time.svg?raw';",
        "import dateTimeIcon from '../icons/date-time.svg?raw';\nimport { formatDateTime } from '../../../../src/ckeditor/insertDateTimeFormat.js';",
      );
    }
    src = src.replace(
      /function formatNow\(editor: Editor, format\?: string\) \{\n[^\n]*\n[^\n]*\n\}/,
      'function formatNow(editor: Editor, format?: string) {\n    return formatDateTime(new Date(), format);\n}',
    );
    if (src !== before) {
      fs.writeFileSync(insertDateTimePath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5/src/plugins/insert_date_time.ts`);
    }
  }

  // Two Tier-1 plugins (see the toolbar-parity work) don't compile cleanly under this repo's
  // stricter tsconfig, same as the other type-only patches in this file - neither changes
  // behaviour, just satisfies the type checker.
  const copyToClipboardPath = path.join(vendorDir, 'ckeditor5', 'src', 'plugins', 'copy_to_clipboard_button.ts');
  if (fs.existsSync(copyToClipboardPath)) {
    let src = fs.readFileSync(copyToClipboardPath, 'utf8');
    const before = src;
    src = src.replace(
      'this.executeCallback = this.editor.config.get("clipboard")?.copy;',
      'this.executeCallback = (this.editor.config.get("clipboard") as { copy?: (text: string) => void } | undefined)?.copy;',
    );
    if (src !== before) {
      fs.writeFileSync(copyToClipboardPath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5/src/plugins/copy_to_clipboard_button.ts`);
    }
  }

  const moveBlockUpDownPath = path.join(vendorDir, 'ckeditor5', 'src', 'plugins', 'move_block_updown.ts');
  if (fs.existsSync(moveBlockUpDownPath)) {
    let src = fs.readFileSync(moveBlockUpDownPath, 'utf8');
    const before = src;
    src = src.replace(
      "const keyMap = {\n    ArrowUp: 'moveBlockUp',\n    ArrowDown: 'moveBlockDown'\n};",
      "const keyMap: Record<string, string> = {\n    ArrowUp: 'moveBlockUp',\n    ArrowDown: 'moveBlockDown'\n};",
    );
    if (src !== before) {
      fs.writeFileSync(moveBlockUpDownPath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5/src/plugins/move_block_updown.ts`);
    }
  }

  // cuttonote.ts's "Cut selection into a sub-note" button executes through Trilium's own
  // app-level command bus (glob.getComponentByEl(editorEl).triggerCommand('cutIntoNote')),
  // which has no equivalent here. Redirect to a config callback (wired in
  // triliumTextEditorProvider.ts to an ETAPI createNote() call) that returns whether the note
  // was actually created, and only then remove the selection - so a cancelled/failed creation
  // leaves the original content untouched. getSelectedHtml()/removeSelection() stay in place
  // (self-contained, no glob dependency) - only the trailing saveNoteDetailNow call is dropped,
  // since this extension's existing dirty-tracking/autosave already covers an immediate save.
  const cutToNotePath = path.join(vendorDir, 'ckeditor5', 'src', 'plugins', 'cuttonote.ts');
  if (fs.existsSync(cutToNotePath)) {
    let src = fs.readFileSync(cutToNotePath, 'utf8');
    const before = src;
    src = src.replace(
      "\t\t\t// Callback executed once the image is clicked.\n\t\t\tview.on('execute', () => {\n\t\t\t\tconst editorEl = this.editor.editing.view.getDomRoot();\n\t\t\t\tconst component = glob.getComponentByEl(editorEl);\n\n\t\t\t\tcomponent.triggerCommand('cutIntoNote');\n\t\t\t});",
      "\t\t\tview.on('execute', () => {\n\t\t\t\tconst html = this.getSelectedHtml();\n\t\t\t\tconst config = this.editor.config.get('cutToNote') as { execute?: (html: string, textPreview: string) => Promise<boolean> } | undefined;\n\t\t\t\tif (!html || !config?.execute) {\n\t\t\t\t\treturn;\n\t\t\t\t}\n\t\t\t\tconst textPreview = html.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();\n\t\t\t\tvoid config.execute(html, textPreview).then((created) => {\n\t\t\t\t\tif (created) {\n\t\t\t\t\t\tthis.removeSelection();\n\t\t\t\t\t}\n\t\t\t\t});\n\t\t\t});",
    );
    src = src.replace(
      "\tasync removeSelection() {\n\t\tconst model = this.editor.model;\n\n\t\tmodel.deleteContent(model.document.selection);\n\t\tthis.editor.execute(\"paragraph\");\n\n\t\tconst component = this.getComponent();\n\n\t\tawait component.triggerCommand('saveNoteDetailNow');\n\t}",
      "\tasync removeSelection() {\n\t\tconst model = this.editor.model;\n\n\t\tmodel.deleteContent(model.document.selection);\n\t\tthis.editor.execute(\"paragraph\");\n\t}",
    );
    // Only remaining glob reference in the file once the two patches above land - this
    // project's tsconfig doesn't compile vendor/ckeditor5/src/augmentation.ts (which declares
    // the ambient `glob` type), so an unused method referencing it still fails the typecheck.
    src = src.replace(
      "\n\tgetComponent() {\n\t\tconst editorEl = this.editor.editing.view.getDomRoot();\n\n\t\treturn glob.getComponentByEl( editorEl );\n\t}\n",
      "\n",
    );
    if (src !== before) {
      fs.writeFileSync(cutToNotePath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5/src/plugins/cuttonote.ts`);
    }
  }

  // copy_anchor_link.ts's "Copy anchor reference link" button (on the bookmark widget's
  // balloon toolbar) resolves the current note through glob.getActiveContextNote() and the
  // link's display title through glob.getReferenceLinkTitleSync() - both app-level lookups
  // with no equivalent here. A bookmark is always an anchor within the note being edited, so
  // both values are just the current note's own id/title, known once at editor creation -
  // read from a small static config instead (wired in triliumTextEditorProvider.ts, which
  // already has the note's id/title in scope when building the webview).
  const copyAnchorLinkPath = path.join(vendorDir, 'ckeditor5', 'src', 'plugins', 'copy_anchor_link.ts');
  if (fs.existsSync(copyAnchorLinkPath)) {
    let src = fs.readFileSync(copyAnchorLinkPath, 'utf8');
    const before = src;
    src = src.replace(
      '                    const noteId = glob.getActiveContextNote()?.noteId;',
      "                    const noteId = (editor.config.get('copyAnchorLink') as { noteId?: string } | undefined)?.noteId;",
    );
    src = src.replace(
      '                        const title = glob.getReferenceLinkTitleSync(href);',
      "                        const title = (editor.config.get('copyAnchorLink') as { noteTitle?: string } | undefined)?.noteTitle || href;",
    );
    if (src !== before) {
      fs.writeFileSync(copyAnchorLinkPath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5/src/plugins/copy_anchor_link.ts`);
    }
  }

  // markdownimport.ts's "Markdown import from clipboard" button executes through Trilium's
  // own app-level command bus (glob.getComponentByEl(editorEl).triggerCommand(
  // 'pasteMarkdownIntoText')), which has no equivalent here. Redirect to a config callback
  // (wired in triliumTextEditorProvider.ts to read the system clipboard via vscode.env.clipboard
  // and convert Markdown to HTML with the extension's existing TempFileManager.markdownToHtml())
  // that resolves the HTML to insert, then insert it at the current selection the same way
  // CKEditor's own clipboard pipeline would.
  const markdownImportPath = path.join(vendorDir, 'ckeditor5', 'src', 'plugins', 'markdownimport.ts');
  if (fs.existsSync(markdownImportPath)) {
    let src = fs.readFileSync(markdownImportPath, 'utf8');
    const before = src;
    src = src.replace(
      "    execute() {\n\t\tconst editorEl = this.editor.editing.view.getDomRoot();\n\t\tconst component = glob.getComponentByEl(editorEl);\n\n\t\tcomponent.triggerCommand('pasteMarkdownIntoText');\n    }",
      "    execute() {\n        const editor = this.editor;\n        const config = editor.config.get('markdownImport') as { execute?: () => Promise<string | undefined> } | undefined;\n        if (!config?.execute) {\n            return;\n        }\n        void config.execute().then((html) => {\n            if (!html) {\n                return;\n            }\n            const viewFragment = editor.data.processor.toView(html);\n            const modelFragment = editor.data.toModel(viewFragment);\n            editor.model.insertContent(modelFragment);\n        });\n    }",
    );
    if (src !== before) {
      fs.writeFileSync(markdownImportPath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5/src/plugins/markdownimport.ts`);
    }
  }

  // mention_customization.ts's "create new note from this @mention" action calls
  // glob.getComponentByEl(editorEl).createNoteForReferenceLink(title, intoInbox), which has no
  // equivalent here. Redirect to a config callback (wired in triliumTextEditorProvider.ts to an
  // ETAPI createNote() call, same "sub-note under the note being edited" shape as CutToNote)
  // that returns the created note's id, then insert the reference the same way an existing-note
  // pick does. The `#`/`~` attribute-editor branch above this one is left untouched - it's
  // unreachable here since this extension never configures a `#`/`~` mention feed (no attribute
  // editor), not a glob dependency.
  const mentionCustomizationPath = path.join(vendorDir, 'ckeditor5', 'src', 'plugins', 'mention_customization.ts');
  if (fs.existsSync(mentionCustomizationPath)) {
    let src = fs.readFileSync(mentionCustomizationPath, 'utf8');
    const before = src;
    src = src.replace(
      "\t\telse if (mention.action === 'create-note' || mention.action === 'create-child-note') {\n\t\t\tconst editorEl = this.editor.editing.view.getDomRoot();\n\t\t\tconst component = glob.getComponentByEl<EditorComponent>(editorEl);\n\t\t\tconst intoInbox = mention.action === 'create-note';\n\n\t\t\tcomponent.createNoteForReferenceLink(mention.noteTitle, intoInbox).then(notePath => {\n\t\t\t\tif (notePath) {\n\t\t\t\t\tthis.insertReference(range, notePath);\n\t\t\t\t}\n\t\t\t});\n\t\t}",
      "\t\telse if (mention.action === 'create-note' || mention.action === 'create-child-note') {\n\t\t\tconst config = this.editor.config.get('mention') as { createNote?: (title: string, intoInbox: boolean) => Promise<string | undefined> } | undefined;\n\t\t\tconst intoInbox = mention.action === 'create-note';\n\n\t\t\tif (!config?.createNote) {\n\t\t\t\treturn;\n\t\t\t}\n\n\t\t\tvoid config.createNote(mention.noteTitle, intoInbox).then(notePath => {\n\t\t\t\tif (notePath) {\n\t\t\t\t\tthis.insertReference(range, notePath);\n\t\t\t\t}\n\t\t\t});\n\t\t}",
    );
    if (src !== before) {
      fs.writeFileSync(mentionCustomizationPath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5/src/plugins/mention_customization.ts`);
    }
  }

  // slash_commands.ts's catalog pulls in three entries this standalone extension can't build
  // as vendored: the "icon" and "internal-link" entries import their commands from the
  // vendor's own unported inline_icon_ui.ts/internallink.ts (both still full of
  // glob.getComponentByEl()/EditorComponent/jQuery references - this extension never uses
  // those originals, see the inline_icon.ts patch above), and "include-note" imports
  // includenote.ts, which isn't ported at all yet (Tier 3c). Redirect the first two to this
  // extension's own local reimplementations (src/ckeditor/inlineIconUi.ts,
  // src/ckeditor/internalLink.ts - same command name, 'insertInternalLink') and drop the
  // include-note entry entirely until Tier 3c lands, rather than dragging in code that fails
  // the project's type-check.
  const slashCommandsPath = path.join(vendorDir, 'ckeditor5', 'src', 'plugins', 'mention', 'slash_commands.ts');
  if (fs.existsSync(slashCommandsPath)) {
    let src = fs.readFileSync(slashCommandsPath, 'utf8');
    const before = src;
    src = src.replace(
      'import noteIcon from "../../icons/note.svg?raw";\n',
      '',
    );
    src = src.replace(
      'import { COMMAND_NAME as INCLUDE_NOTE_COMMAND } from "../includenote.js";\n',
      '',
    );
    src = src.replace(
      'import InlineIconUI from "../inline_icon/inline_icon_ui.js";',
      'import InlineIconUI from "../../../../../src/ckeditor/inlineIconUi.js";',
    );
    src = src.replace(
      'import { COMMAND_NAME as INTERNAL_LINK_COMMAND } from "../internallink.js";',
      'import { COMMAND_NAME as INTERNAL_LINK_COMMAND } from "../../../../../src/ckeditor/internalLink.js";',
    );
    src = src.replace(
      '        {\n            id: "include-note",\n            title: t("Include note"),\n            description: t("Display the content of another note in this note"),\n            icon: noteIcon,\n            commandName: INCLUDE_NOTE_COMMAND\n        },\n',
      '',
    );
    // The "AI assistant" entry and the per-quick-action entries only ever apply to an
    // "AiAssistantUI" plugin this extension doesn't have and, per the Tier 3 scope doc, isn't
    // planning to build (VS Code's own AI tooling already covers that ground) - `editor.plugins
    // .get("AiAssistantUI")` resolves to the untyped `PluginInterface` fallback with no
    // `quickActions`/`runQuickAction` members, which fails the type-check even though the
    // `editor.plugins.has()` guard means it never runs here. Drop both along with the icon
    // import only they used.
    src = src.replace(
      'import aiIcon from "../ai_assistant/theme/icons/ai.svg?raw";\n',
      '',
    );
    src = src.replace(
      '        {\n            id: "ai-assistant",\n            title: t("AI assistant"),\n            description: t("Ask AI to rewrite the selection or generate new content."),\n            aliases: [ "ask ai", "assistant" ],\n            icon: aiIcon,\n            commandName: "aiAssistant"\n        },\n',
      '',
    );
    src = src.replace(
      /\n\/\*\*\n \* One entry per AI quick action[\s\S]*?\nfunction buildAiQuickActionSlashCommands\(editor: Editor\): SlashCommandDefinition\[\] \{[\s\S]*?\n\}\n/,
      '\n',
    );
    src = src.replace(
      '        ...buildAiQuickActionSlashCommands(editor)\n',
      '',
    );
    if (src !== before) {
      fs.writeFileSync(slashCommandsPath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5/src/plugins/mention/slash_commands.ts`);
    }
  }

  // SnippetsEditing seeds its live definitions collection from `snippets.definitions`, a config
  // path with no `EditorConfig` augmentation in this repo (TriliumSnippets, which would add one,
  // is a later Tier 3a item) - `editor.config.get()` falls back to the generic `{}` shape for an
  // unrecognized path, which `setDefinitions()` then rejects. slash_commands.ts imports this file
  // unconditionally for its snippet palette entries, so it has to type-check even before
  // TriliumSnippets registers the plugin. Assert the shape explicitly instead, same as the
  // config reads in cuttonote.ts/markdownimport.ts above.
  const snippetsEditingPath = path.join(vendorDir, 'ckeditor5', 'src', 'plugins', 'snippets', 'snippetsediting.ts');
  if (fs.existsSync(snippetsEditingPath)) {
    let src = fs.readFileSync(snippetsEditingPath, 'utf8');
    const before = src;
    src = src.replace(
      'const initial = editor.config.get("snippets.definitions") ?? [];',
      'const initial = (editor.config.get("snippets.definitions") ?? []) as SnippetDefinition[];',
    );
    if (src !== before) {
      fs.writeFileSync(snippetsEditingPath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5/src/plugins/snippets/snippetsediting.ts`);
    }
  }

  // Fresh vendor downloads can include the upstream CKEditor tsconfig with stale
  // monorepo-only settings that break the standalone extension type-check. Strip
  // the inherited base config and the declaration-only / extra ambient types that
  // are not valid in this repo's TypeScript setup.
  const vendorTsconfigPath = path.join(vendorDir, 'ckeditor5', 'tsconfig.lib.json');
  if (fs.existsSync(vendorTsconfigPath)) {
    let src = fs.readFileSync(vendorTsconfigPath, 'utf8');
    const before = src;
    try {
      const config = JSON.parse(src);
      const compilerOptions = config.compilerOptions ?? {};
      const hasLegacySettings = config.extends === '../../tsconfig.base.json'
        || compilerOptions.emitDeclarationOnly === true
        || (Array.isArray(compilerOptions.types) && compilerOptions.types.some(type => type === 'vite/client' || type === 'jquery'));

      if (hasLegacySettings) {
        delete config.extends;
        const { emitDeclarationOnly, types, ...safeCompilerOptions } = compilerOptions;
        config.compilerOptions = safeCompilerOptions;
        fs.writeFileSync(vendorTsconfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
        console.log(`${logPrefix} normalized stale ckeditor5 tsconfig.lib.json`);
      }
    } catch (error) {
      console.warn(`${logPrefix} unable to normalize stale ckeditor5 tsconfig.lib.json: ${error.message}`);
    }
    if (before === fs.readFileSync(vendorTsconfigPath, 'utf8')) {
      // Keep the existing file untouched when it is already compatible.
    }
  }
}
