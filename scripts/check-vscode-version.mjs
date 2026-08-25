#!/usr/bin/env node
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const engineRange = packageJson.engines?.vscode;
const typesRange = packageJson.devDependencies?.['@types/vscode'];

const engineMatch = /^\^(\d+)\.(\d+)\.\d+$/.exec(engineRange ?? '');
const typesMatch = /^\^(\d+)\.(\d+)\.\d+$/.exec(typesRange ?? '');

if (!engineMatch || !typesMatch) {
  console.error('Expected engines.vscode and @types/vscode to use caret semver ranges.');
  process.exit(1);
}

const engineVersion = `${engineMatch[1]}.${engineMatch[2]}`;
const typesVersion = `${typesMatch[1]}.${typesMatch[2]}`;

if (engineVersion !== typesVersion) {
  console.error(`VS Code version mismatch: engines.vscode is ${engineRange}, but @types/vscode is ${typesRange}.`);
  process.exit(1);
}

console.log(`VS Code engine and @types/vscode are aligned at ${engineVersion}.x.`);