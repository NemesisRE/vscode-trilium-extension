import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

let registered = false;

function registerLanguages() {
  if (registered) {
    return;
  }

  const registrations = [
    ['bash', bash],
    ['shell', bash],
    ['c', c],
    ['cpp', cpp],
    ['csharp', csharp],
    ['css', css],
    ['diff', diff],
    ['go', go],
    ['html', xml],
    ['java', java],
    ['javascript', javascript],
    ['json', json],
    ['kotlin', kotlin],
    ['markdown', markdown],
    ['php', php],
    ['powershell', powershell],
    ['python', python],
    ['ruby', ruby],
    ['rust', rust],
    ['scss', scss],
    ['sql', sql],
    ['swift', swift],
    ['typescript', typescript],
    ['xml', xml],
    ['yaml', yaml],
  ] as const;

  for (const [name, language] of registrations) {
    hljs.registerLanguage(name, language);
  }

  registered = true;
}

export function getHighlightJs() {
  registerLanguages();
  return hljs;
}

export function mapCodeBlockLanguage(language: string | null | undefined): string | null {
  if (!language || language === 'plaintext') {
    return null;
  }

  if (language === 'shell') {
    return 'bash';
  }

  if (language === 'html') {
    return 'xml';
  }

  return language;
}
