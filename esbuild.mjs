import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: !production,
  minify: production,
  target: 'node24',
  logLevel: 'info',
};

/**
 * Copy CKEditor assets to out/ckeditor/ for bundling.
 * This ensures CKEditor is available when the extension is packaged.
 */
function copyCKEditorAssets() {
  const sourceDir = path.join('node_modules', '@ckeditor', 'ckeditor5-build-classic', 'build');
  const targetDir = path.join('out', 'ckeditor');

  if (!fs.existsSync(sourceDir)) {
    console.warn('[esbuild] Warning: CKEditor not found in node_modules. Run npm install first.');
    return;
  }

  // Create target directory
  fs.mkdirSync(targetDir, { recursive: true });

  // Copy all files from CKEditor build directory
  const files = fs.readdirSync(sourceDir);
  for (const file of files) {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(targetDir, file);
    
    if (fs.statSync(sourcePath).isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
      console.log(`[esbuild] Copied ${file} to ${targetDir}`);
    }
  }
}

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('[esbuild] watching for changes...');
  
  // Copy CKEditor assets on initial watch
  copyCKEditorAssets();
} else {
  await esbuild.build(buildOptions);
  
  // Copy CKEditor assets after build
  copyCKEditorAssets();
}
