/**
 * Intercepts `require('vscode')` and redirects it to the stub, allowing unit
 * tests to run outside of a VS Code extension host process.
 *
 * This file must be loaded by mocha before any test modules via the
 * `--require` option in .mocharc.json.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('module') as NodeModule & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};

const originalLoad = Module._load.bind(Module);

Module._load = function (request: string, parent: unknown, isMain: boolean): unknown {
  if (request === 'vscode') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./vscode-stub');
  }
  return originalLoad(request, parent, isMain);
};
