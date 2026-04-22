#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const workspaceRoot = process.cwd();
const nodeModulesDir = path.join(workspaceRoot, 'node_modules');
const requiredPackages = [
  path.join(nodeModulesDir, 'tar', 'package.json'),
  path.join(nodeModulesDir, 'esbuild', 'package.json'),
  path.join(nodeModulesDir, 'typescript', 'package.json'),
];

function run(command, args) {
  const isWindows = process.platform === 'win32';
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    stdio: 'inherit',
    shell: isWindows,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function needsInstall() {
  if (!fs.existsSync(nodeModulesDir)) {
    return true;
  }

  return requiredPackages.some(pkgPath => !fs.existsSync(pkgPath));
}

if (needsInstall()) {
  console.log('[bootstrap-build] node_modules is missing or incomplete, running npm install...');
  run('npm', ['install']);
}

console.log('[bootstrap-build] Running npm run build...');
run('npm', ['run', 'build']);
