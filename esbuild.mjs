import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Plugin to handle SVG imports with ?raw suffix.
 * Trilium plugins use Vite's ?raw syntax to import SVG as strings.
 */
const svgRawPlugin = {
  name: 'svg-raw',
  setup(build) {
    build.onResolve({ filter: /\.svg\?raw$/ }, args => {
      return {
        path: path.resolve(args.resolveDir, args.path.replace('?raw', '')),
        namespace: 'svg-raw',
      };
    });

    build.onLoad({ filter: /.*/, namespace: 'svg-raw' }, async args => {
      const svg = await fs.promises.readFile(args.path, 'utf8');
      return {
        contents: `export default ${JSON.stringify(svg)}`,
        loader: 'js',
      };
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const extensionBuildOptions = {
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

/** @type {import('esbuild').BuildOptions} */
const ckeditorBuildOptions = {
  entryPoints: ['src/ckeditor-build.ts'],
  bundle: true,
  outfile: 'out/ckeditor/ckeditor.js',
  format: 'iife',
  platform: 'browser',
  sourcemap: !production,
  minify: production,
  target: ['es2020'],
  logLevel: 'info',
  loader: {
    '.svg': 'text',
    '.css': 'css',
  },
  plugins: [svgRawPlugin],
  // Mark mathlive CSS as external - it's an optional dependency that
  // the math plugin can work without
  external: ['mathlive/fonts.css', 'mathlive/static.css'],
};

/**
 * Build both the extension and CKEditor.
 */
async function buildAll() {
  console.log('[esbuild] Building extension...');
  await esbuild.build(extensionBuildOptions);
  
  console.log('[esbuild] Building CKEditor...');
  await esbuild.build(ckeditorBuildOptions);
  
  console.log('[esbuild] Build complete!');
}

/**
 * Watch mode for development.
 */
async function watchAll() {
  console.log('[esbuild] Starting watch mode...');
  
  const extensionCtx = await esbuild.context(extensionBuildOptions);
  const ckeditorCtx = await esbuild.context(ckeditorBuildOptions);
  
  await Promise.all([
    extensionCtx.watch(),
    ckeditorCtx.watch(),
  ]);
  
  console.log('[esbuild] Watching for changes...');
}

if (watch) {
  await watchAll();
} else {
  await buildAll();
}
