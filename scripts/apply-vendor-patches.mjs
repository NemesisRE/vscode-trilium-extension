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

  // ckeditor5-math: remove the custom `declare global` block for window.mathVirtualKeyboard.
  // mathlive already declares `window.mathVirtualKeyboard: VirtualKeyboardInterface & EventTarget`
  // in its own types, so redefining it with a narrower type causes TS2687/TS2717.
  const mathInputViewPath = path.join(vendorDir, 'ckeditor5-math', 'src', 'ui', 'mathinputview.ts');
  if (fs.existsSync(mathInputViewPath)) {
    let src = fs.readFileSync(mathInputViewPath, 'utf8');
    const declareGlobalBlock = /^declare global \{[\s\S]*?\}\s*\n\n/m;
    if (declareGlobalBlock.test(src)) {
      src = src.replace(declareGlobalBlock, '');
      fs.writeFileSync(mathInputViewPath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5-math/src/ui/mathinputview.ts`);
    }
  }

  // ckeditor5-math: newer upstream refs import raw SVG files from a package path
  // that no longer exists in our installed CKEditor icon package. Rewrite these
  // imports to the supported named exports from @ckeditor/ckeditor5-icons.
  const mainFormViewPath = path.join(vendorDir, 'ckeditor5-math', 'src', 'ui', 'mainformview.ts');
  if (fs.existsSync(mainFormViewPath)) {
    let src = fs.readFileSync(mainFormViewPath, 'utf8');
    const before = src;
    src = src.replace(
      'import IconCheck from "@ckeditor/ckeditor5-icons/theme/icons/check.svg?raw";',
      'import { IconCheck, IconCancel } from "@ckeditor/ckeditor5-icons";',
    );
    src = src.replace(
      'import IconCancel from "@ckeditor/ckeditor5-icons/theme/icons/cancel.svg?raw";\n',
      '',
    );
    if (src !== before) {
      fs.writeFileSync(mainFormViewPath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5-math/src/ui/mainformview.ts`);
    }
  }

  // ckeditor5-math: renderMathJax3 leaves behind previous renders if called multiple times,
  // causing duplicate equations. We need to clear all children before appending the new render.
  const mathUtilsPath = path.join(vendorDir, 'ckeditor5-math', 'src', 'utils.ts');
  if (fs.existsSync(mathUtilsPath)) {
    let src = fs.readFileSync(mathUtilsPath, 'utf8');
    const before = src;
    src = src.replace(
      "if ( element.firstChild ) {\n\t\t\t\telement.removeChild( element.firstChild );\n\t\t\t}",
      "while ( element.firstChild ) {\n\t\t\t\telement.removeChild( element.firstChild );\n\t\t\t}"
    );
    if (src !== before) {
      fs.writeFileSync(mathUtilsPath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5-math/src/utils.ts`);
    }
  }

  // ckeditor5-mermaid: newer upstream refs leave the debounced textarea listener
  // callback parameter implicitly typed, which fails under this repo's strict TS config.
  const mermaidEditingPath = path.join(vendorDir, 'ckeditor5-mermaid', 'src', 'mermaidediting.ts');
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
      console.log(`${logPrefix} patched ckeditor5-mermaid/src/mermaidediting.ts`);
    }
  }

  // ckeditor5-collapsible: upstream package imports monorepo workspace deps.
  // Rewrite those imports to local repo paths so our standalone build can bundle them.
  const legacyCollapsibleEditingPath = path.join(vendorDir, 'ckeditor5-collapsible', 'src', 'collapsible-editing.ts');
  if (fs.existsSync(legacyCollapsibleEditingPath)) {
    let src = fs.readFileSync(legacyCollapsibleEditingPath, 'utf8');
    const before = src;
    src = src.replace(
      'import { formatShortcut, joinShortcut } from "@triliumnext/commons";',
      'import { formatShortcut, joinShortcut } from "../../../src/ckeditor/shortcut.ts";',
    );
    src = src.replace(
      'import { ContentHintManager, type HintHandle } from "@triliumnext/ckeditor5-utils";',
      'import { ContentHintManager, type HintHandle } from "../../ckeditor5-utils/src/index.ts";',
    );
    if (src !== before) {
      fs.writeFileSync(legacyCollapsibleEditingPath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5-collapsible/src/collapsible-editing.ts`);
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
