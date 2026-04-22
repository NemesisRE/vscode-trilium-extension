#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as tar from 'tar';
import { promisify } from 'util';

const TRILIUM_REPO = 'TriliumNext/Trilium';
const TRILIUM_REF = 'main';
const VENDOR_DIR = path.join(process.cwd(), 'vendor');

const PLUGINS = [
  'ckeditor5-admonition',
  'ckeditor5-footnotes',
  'ckeditor5-keyboard-marker',
  'ckeditor5-math',
  'ckeditor5-mermaid',
];

/**
 * Downloads the entire Trilium repository tarball once and extracts all plugins.
 */
async function downloadAllPlugins() {
  const url = `https://github.com/${TRILIUM_REPO}/archive/${TRILIUM_REF}.tar.gz`;
  
  console.log(`[download-plugins] Downloading Trilium repository tarball...`);

  // Create vendor directory if it doesn't exist
  if (!fs.existsSync(VENDOR_DIR)) {
    fs.mkdirSync(VENDOR_DIR, { recursive: true });
  }

  // Clean and recreate each plugin directory
  for (const plugin of PLUGINS) {
    const targetDir = path.join(VENDOR_DIR, plugin);
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  }

  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        https.get(response.headers.location, (redirectResponse) => {
          if (redirectResponse.statusCode !== 200) {
            reject(new Error(`Failed to download: ${redirectResponse.statusCode}`));
            return;
          }
          extractPlugins(redirectResponse, resolve, reject);
        }).on('error', reject);
      } else if (response.statusCode === 200) {
        extractPlugins(response, resolve, reject);
      } else {
        reject(new Error(`Failed to download: ${response.statusCode}`));
      }
    }).on('error', reject);
  });
}

/**
 * Extract only the plugin directories we need from the tarball stream.
 */
function extractPlugins(stream, resolve, reject) {
  const repoPrefix = `Trilium-${TRILIUM_REF}/packages/`;
  
  stream.pipe(tar.extract({
    cwd: VENDOR_DIR,
    filter: (filepath) => {
      // Only extract files from plugin directories we care about
      return PLUGINS.some(plugin => {
        const prefix = `${repoPrefix}${plugin}/`;
        return filepath.startsWith(prefix);
      });
    },
    // Don't strip - we'll handle the path transformation in onentry
    onentry: (entry) => {
      // Transform path from 'Trilium-main/packages/ckeditor5-admonition/src/...'
      // to 'ckeditor5-admonition/src/...'
      const pathParts = entry.path.split('/');
      if (pathParts.length > 3 && pathParts[0].startsWith('Trilium-') && pathParts[1] === 'packages') {
        // Remove 'Trilium-main' and 'packages' prefix
        entry.path = pathParts.slice(2).join('/');
      }
    }
  }))
  .on('finish', () => {
    console.log('[download-plugins] ✓ All plugins extracted successfully');
    resolve();
  })
  .on('error', reject);
}

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
      console.log('[download-plugins] ✓ Patched ckeditor5-math/src/ui/mathinputview.ts');
    }
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('[download-plugins] Downloading Trilium CKEditor plugins...');
  console.log(`[download-plugins] Source: ${TRILIUM_REPO}@${TRILIUM_REF}`);
  console.log(`[download-plugins] Target: ${VENDOR_DIR}`);
  console.log(`[download-plugins] Plugins: ${PLUGINS.join(', ')}`);

  try {
    await downloadAllPlugins();
    patchPlugins();
    console.log('[download-plugins] All plugins downloaded successfully.');
  } catch (error) {
    console.error('[download-plugins] Error:', error.message);
    process.exit(1);
  }
}

main();
