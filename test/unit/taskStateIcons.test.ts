import * as fs from 'fs';
import * as path from 'path';
import { strict as assert } from 'assert';
import {
  boxiconSvgRelativePath,
  mergeTaskStates,
  svgToCssUrl,
  taskStateCssIdentifier,
} from '../../src/taskStateIcons';

describe('boxiconSvgRelativePath', () => {
  it('resolves a regular Trilium icon class to a bundled SVG path', () => {
    assert.strictEqual(boxiconSvgRelativePath('bx bx-x'), 'regular/bx-x.svg');
  });

  it('resolves solid and logo variants to their own folders', () => {
    assert.strictEqual(boxiconSvgRelativePath('bx bxs-lock'), 'solid/bxs-lock.svg');
    assert.strictEqual(boxiconSvgRelativePath('bx bxl-github'), 'logos/bxl-github.svg');
  });

  it('returns undefined for values that are not boxicon classes', () => {
    assert.strictEqual(boxiconSvgRelativePath(''), undefined);
    assert.strictEqual(boxiconSvgRelativePath('✕'), undefined);
    assert.strictEqual(boxiconSvgRelativePath('bx'), undefined);
  });
});

describe('svgToCssUrl', () => {
  it('wraps the SVG in a double-quoted data URL', () => {
    const url = svgToCssUrl('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>');

    assert.ok(url.startsWith('url("data:image/svg+xml;charset=utf-8,'));
    assert.ok(url.endsWith('")'));
  });

  it('escapes characters that would terminate the CSS url() value', () => {
    const url = svgToCssUrl('<svg fill="none"></svg>');

    assert.ok(!url.slice('url("'.length, -2).includes('"'));
    assert.ok(url.includes('%22'));
  });
});

describe('taskStateCssIdentifier', () => {
  it('keeps names that are already valid class fragments', () => {
    assert.strictEqual(taskStateCssIdentifier('cancelled'), 'cancelled');
    assert.strictEqual(taskStateCssIdentifier('in_progress-2'), 'in_progress-2');
  });

  it('replaces characters that are invalid inside a class selector', () => {
    assert.strictEqual(taskStateCssIdentifier('in progress'), 'in-progress');
    assert.strictEqual(taskStateCssIdentifier('naja?!'), 'naja--');
  });
});

describe('built-in task state icons', () => {
  // A class that does not resolve to a bundled asset leaves the menu button blank,
  // which is what the Boxicons webfont used to hide behind a tofu box.
  const builtInIconClasses = [
    'bx bx-checkbox',
    'bx bx-checkbox-checked',
    'bx bx-loader',
    'bx bx-question-mark',
    'bx bx-x',
  ];

  it('resolve to SVG assets that ship with the boxicons package', () => {
    const svgRoot = path.join(__dirname, '..', '..', '..', 'node_modules', 'boxicons', 'svg');

    for (const iconClass of builtInIconClasses) {
      const relativePath = boxiconSvgRelativePath(iconClass);
      assert.ok(relativePath, `${iconClass} is not a resolvable boxicon class`);
      assert.ok(
        fs.existsSync(path.join(svgRoot, relativePath)),
        `${iconClass} has no bundled SVG at ${relativePath}`,
      );
    }
  });
});

describe('mergeTaskStates', () => {
  const anchors = [{ name: 'none' }, { name: 'done' }];

  it('keeps anchor states first and appends the configured states', () => {
    const merged = mergeTaskStates(anchors, [
      { name: 'doing' },
      { name: 'maybe' },
      { name: 'cancelled' },
    ]);

    assert.deepStrictEqual(merged.map((state) => state.name), [
      'none',
      'done',
      'doing',
      'maybe',
      'cancelled',
    ]);
  });

  it('does not let a configured state shadow an anchor state', () => {
    const merged = mergeTaskStates(anchors, [{ name: 'done' }, { name: 'doing' }]);

    assert.deepStrictEqual(merged.map((state) => state.name), ['none', 'done', 'doing']);
  });

  it('drops duplicates within the configured states', () => {
    const merged = mergeTaskStates(anchors, [{ name: 'doing' }, { name: 'doing' }]);

    assert.deepStrictEqual(merged.map((state) => state.name), ['none', 'done', 'doing']);
  });
});
