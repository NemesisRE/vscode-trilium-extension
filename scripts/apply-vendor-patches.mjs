import * as fs from 'fs';
import * as path from 'path';

/**
 * Applies local patches to vendor files that are incompatible with the project's TypeScript setup.
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
}
