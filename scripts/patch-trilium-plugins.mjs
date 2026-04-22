#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';

const VENDOR_DIR = path.join(process.cwd(), 'vendor');

/**
 * Applies local patches to vendor files that are incompatible with the project's TypeScript setup.
 */
function patchPlugins() {
  // ckeditor5-math: remove the custom `declare global` block for window.mathVirtualKeyboard.
  // mathlive already declares `window.mathVirtualKeyboard: VirtualKeyboardInterface & EventTarget`
  // in its own types, so redefining it with a narrower type causes TS2687/TS2717.
  const mathInputViewPath = path.join(VENDOR_DIR, 'ckeditor5-math', 'src', 'ui', 'mathinputview.ts');
  if (fs.existsSync(mathInputViewPath)) {
    let src = fs.readFileSync(mathInputViewPath, 'utf8');
    const declareGlobalBlock = /^declare global \{[\s\S]*?\}\s*\n\n/m;
    if (declareGlobalBlock.test(src)) {
      src = src.replace(declareGlobalBlock, '');
      fs.writeFileSync(mathInputViewPath, src, 'utf8');
      console.log('[patch-plugins] ✓ Patched ckeditor5-math/src/ui/mathinputview.ts');
    }
  }
}

patchPlugins();
console.log('[patch-plugins] All patches applied.');
