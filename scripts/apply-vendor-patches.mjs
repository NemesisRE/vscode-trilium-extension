import * as fs from 'fs';
import * as path from 'path';

/**
 * Applies local patches to vendor files that are incompatible with the project's TypeScript setup.
 * These patches are the intended stabilization point when Trilium plugin-ref updates
 * pull in upstream CKEditor changes that do not compile cleanly in this repo.
 */
export function applyVendorPatches(vendorDir, logPrefix = '[patch-plugins]') {
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
      "\t\t\t\teditor.model.change( writer => {",
      "\t\t\t\tconst target = event.target as HTMLInputElement | null;\n\t\t\t\tif ( !target ) {\n\t\t\t\t\treturn;\n\t\t\t\t}\n\n\t\t\t\teditor.model.change( writer => {",
    );
    src = src.replace(
      "\t\t\t\t\twriter.setAttribute( 'source', event.target.value, data.item as ModelNode );",
      "\t\t\t\t\twriter.setAttribute( 'source', target.value, data.item as ModelNode );",
    );
    if (src !== before) {
      fs.writeFileSync(mermaidEditingPath, src, 'utf8');
      console.log(`${logPrefix} patched ckeditor5-mermaid/src/mermaidediting.ts`);
    }
  }
}
