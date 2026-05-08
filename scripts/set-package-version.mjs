import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rawVersion = process.argv[2];

if (!rawVersion) {
  console.error('Usage: node scripts/set-package-version.mjs <version>');
  process.exit(1);
}

const version = rawVersion.startsWith('v') ? rawVersion.slice(1) : rawVersion;

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Expected semver version in the form major.minor.patch, got: ${rawVersion}`);
  process.exit(1);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.resolve(scriptDirectory, '..', 'package.json');
const packageJsonText = await fs.readFile(packageJsonPath, 'utf8');
const packageJson = JSON.parse(packageJsonText);

if (packageJson.version === version) {
  console.log(`package.json already uses version ${version}`);
  process.exit(0);
}

packageJson.version = version;
await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

console.log(`Updated package.json version to ${version}`);
