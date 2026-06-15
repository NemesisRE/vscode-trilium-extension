import fs from 'node:fs';
import path from 'node:path';

const packageJsonPath = path.resolve(process.cwd(), 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

function getDeclaredVersion(name) {
  return packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name] ?? null;
}

function parseMajor(versionRange) {
  if (!versionRange) {
    return null;
  }

  const match = versionRange.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function fail(message) {
  console.error(`[react-deps] ${message}`);
  process.exitCode = 1;
}

const react = getDeclaredVersion('react');
const reactDom = getDeclaredVersion('react-dom');
const typesReact = getDeclaredVersion('@types/react');
const typesReactDom = getDeclaredVersion('@types/react-dom');

if (!react || !reactDom || !typesReact || !typesReactDom) {
  fail('Missing one of required dependencies: react, react-dom, @types/react, @types/react-dom.');
} else {
  if (react !== reactDom) {
    fail(`react (${react}) and react-dom (${reactDom}) must use the exact same version range.`);
  }

  const reactMajor = parseMajor(react);
  const reactDomMajor = parseMajor(reactDom);
  const typesReactMajor = parseMajor(typesReact);
  const typesReactDomMajor = parseMajor(typesReactDom);

  if (reactMajor === null || reactDomMajor === null || typesReactMajor === null || typesReactDomMajor === null) {
    fail('Unable to parse major versions for React dependency alignment check.');
  } else {
    if (reactMajor !== reactDomMajor) {
      fail(`react major (${reactMajor}) and react-dom major (${reactDomMajor}) must match.`);
    }

    if (typesReactMajor !== reactMajor) {
      fail(`@types/react major (${typesReactMajor}) must match react major (${reactMajor}).`);
    }

    if (typesReactDomMajor !== reactDomMajor) {
      fail(`@types/react-dom major (${typesReactDomMajor}) must match react-dom major (${reactDomMajor}).`);
    }
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('[react-deps] React dependency alignment OK.');
