import { parseBoxiconClass } from './noteTreeProvider';

/**
 * Trilium stores task-state icons as Boxicons *classes* (e.g. `bx bx-x`) and renders them
 * through the Boxicons webfont. The webview resolves them to the SVG assets bundled with the
 * extension instead, so glyphs also render when the font cannot be loaded.
 */
export function boxiconSvgRelativePath(iconClass: string): string | undefined {
  const parsed = parseBoxiconClass(iconClass);
  return parsed ? `${parsed.style}/${parsed.fileName}` : undefined;
}

/** Inline an SVG as a CSS `url()` value, usable as a `mask-image`. */
export function svgToCssUrl(svg: string): string {
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}

/** Sanitize a task-state name so it can be used inside a CSS class selector. */
export function taskStateCssIdentifier(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-');
}

/**
 * Combine the built-in anchor states with the states configured on the server.
 * The first definition per name wins, so a server-side `none`/`done` cannot shadow an anchor.
 */
export function mergeTaskStates<T extends { name: string }>(
  anchors: readonly T[],
  custom: readonly T[],
): T[] {
  const merged: T[] = [];
  const seen = new Set<string>();

  for (const state of [...anchors, ...custom]) {
    if (seen.has(state.name)) {
      continue;
    }

    seen.add(state.name);
    merged.push(state);
  }

  return merged;
}
