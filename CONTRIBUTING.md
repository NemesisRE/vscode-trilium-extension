# Contributing to vscode-trilium-extension

## Prerequisites

- **Node.js** 24 (matches CI)
- **npm** (comes with Node.js)
- **VS Code** 1.116 or later (desktop)
- **npx** / **@vscode/vsce** — installed automatically via `npm ci`

---

## Setup

```bash
git clone https://github.com/NemesisRE/vscode-trilium-extension
cd vscode-trilium-extension
npm ci
```

Press **F5** in VS Code to launch the Extension Development Host with the extension loaded.

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run compile` | Type-check with `tsc --noEmit` (no output files) |
| `npm run prebuild` | Download Trilium CKEditor plugins to `vendor/` |
| `npm run build` | Bundle extension with esbuild (development, with sourcemaps). **Note:** npm automatically runs `prebuild` first. |
| `npm run build:prod` | Bundle extension with esbuild (production, minified). Runs `prebuild` first. |
| `npm run watch` | Rebuild on every file save |
| `npm test` | Compile tests + run all unit tests with Mocha |
| `npm run package` | Package the extension into a `.vsix` file |

---

## Project Structure

```text
src/
  extension.ts            Entry point — activate(), deactivate(), command registrations
  etapiClient.ts          HTTP client wrapping the Trilium ETAPI REST API
  noteTreeProvider.ts     VS Code TreeDataProvider + FileDecorationProvider for the note tree
  settings.ts             Read serverUrl from configuration, read/write ETAPI token via SecretStorage; getEditorFontSize() / getEditorSpellcheck() for CKEditor settings
  tempFileManager.ts      Create/manage temp files for editing notes; HTML↔Markdown and MindMap conversions (fallback path)
  triliumTextEditorProvider.ts  CustomTextEditorProvider serving the CKEditor 5 WYSIWYG webview for text notes
  virtualDocumentProvider.ts   TextDocumentContentProvider backing the trilium-text:// URI scheme used by the WYSIWYG editor
  attributesViewProvider.ts  WebviewViewProvider rendering the Attributes sidebar panel
  ckeditor-build.ts       Custom CKEditor 5 build with Trilium plugins
  types/vendor.d.ts       TypeScript declarations for vendored modules and SVG imports

vendor/                   Trilium CKEditor plugins (downloaded during prebuild, gitignored)
  admonition/
  footnotes/
  keyboard-marker/
  math/
  mermaid/

scripts/
  download-trilium-plugins.mjs  Fetches Trilium plugin source from GitHub during prebuild

test/
  helpers/
    vscode-stub.ts        Minimal stubs for vscode.* APIs (ThemeIcon, ThemeColor, Uri, FileDecoration, …)
    vscode-mock.ts        Intercepts require('vscode') and returns the stubs above
  unit/
    etapiClient.test.ts   Unit tests for EtapiClient
    noteTreeProvider.test.ts  Unit tests for NoteTreeProvider / NoteItem
    tempFileManager.test.ts   Unit tests for TempFileManager conversions

.github/
  workflows/ci.yml        CI: type-check, test, build, package + release asset upload
  release-drafter.yml     Auto-drafts release notes from PR labels
  ISSUE_TEMPLATE/         Bug report and feature request templates
  copilot-instructions.md  Copilot agent rules for this repo
```

---

## Trilium CKEditor Plugins

The extension uses five custom CKEditor 5 plugins from Trilium Notes:

| Plugin | Purpose |
| --- | --- |
| **admonition** | Styled callout blocks (note, tip, warning, danger) |
| **footnotes** | Inline reference management with auto-numbering |
| **keyboard-marker** | Visual `<kbd>` tags for keyboard shortcuts |
| **math** | KaTeX LaTeX formula rendering (inline and block) |
| **mermaid** | Inline diagram syntax (flowcharts, sequence diagrams, etc.) |

### Plugin Download

Plugins are **not checked into Git**. They are downloaded from the [Trilium source repository](https://github.com/TriliumNext/Trilium) during the build process via the `prebuild` script.

**How it works:**

1. The `prebuild` script invokes `scripts/download-trilium-plugins.mjs`
2. npm automatically runs `prebuild` before the `build` script (due to the `pre` prefix naming convention)
3. For `build:prod` and `vscode:prepublish`, `prebuild` is called explicitly (npm's auto-hook doesn't work for script names with colons)
4. The script downloads the latest `main` branch tarball from `https://github.com/TriliumNext/Trilium/archive/main.tar.gz`
5. It extracts only the five plugin directories from `src/public/app/widgets/type_widgets/text/ckeditor_plugins/`
6. Plugins are written to `vendor/{plugin}/` (e.g., `vendor/admonition/`, `vendor/math/`)
7. The `vendor/` directory is gitignored

**To update plugins:**

```bash
# Remove existing vendor directory
rm -r vendor

# Re-run prebuild to download latest
npm run prebuild
```

The `prebuild` script ensures plugins are always downloaded before building, whether in development or CI.

**CI Caching:**

The GitHub Actions workflow caches the `vendor/` directory to avoid re-downloading plugins on every CI run. The cache key is based on the hash of `scripts/download-trilium-plugins.mjs`, so:

- If the download script changes, the cache is invalidated and plugins are re-downloaded
- Otherwise, the cached plugins are reused across workflow runs
- To force a fresh download, update the download script or manually clear the cache via GitHub's UI

### Plugin Source

- **Repository:** [Trilium source repository](https://github.com/TriliumNext/Trilium)
- **Path:** `src/public/app/widgets/type_widgets/text/ckeditor_plugins/`
- **License:** AGPL-3.0 (same as Trilium)

The vendored plugins are compiled into the CKEditor build (`out/ckeditor-build.js`) via `src/ckeditor-build.ts`.

---

## Architecture Notes

### ETAPI Client (`etapiClient.ts`)

Thin wrapper around `fetch`. All methods throw an `EtapiError` (with `.code` and `.message`) on non-2xx responses. The ETAPI token is passed as the `Authorization: Basic` header (base64 of `user:token`, per Trilium's ETAPI spec — the "user" field is ignored).

### Note Tree (`noteTreeProvider.ts`)

`NoteItem` extends `vscode.TreeItem`. Icon is resolved from the `#iconClass` label attribute (BoxIcon name) via a static `BOXICON_TO_CODICON` lookup table, falling back to a per-type default. Color is resolved from the `#color` label attribute via `NoteTreeDecorationProvider`, which returns a `vscode.FileDecoration` using `charts.*` theme colors.

### WYSIWYG Text Editor (`triliumTextEditorProvider.ts` + `virtualDocumentProvider.ts`)

`TriliumTextEditorProvider` implements `CustomTextEditorProvider` and registers for `*.trilium-text` virtual file URIs. It serves a webview containing CKEditor 5 Classic build. The webview communicates with the extension host via `postMessage` — `init` (load content), `update` (content changed in editor), and `getContent` / `returnContent` (save flow). A `pendingWebviewUpdate` flag prevents re-entrant update loops when the extension applies an edit in response to a webview message.

The CSS injects a `--ck-color-*` → `--vscode-*` variable bridge so the editor follows the active VS Code theme automatically, including high-contrast themes.

`VirtualDocumentProvider` implements `TextDocumentContentProvider` for the `trilium-text://` scheme. It holds the current HTML content in memory and serves it to the virtual document when VS Code requests it.

### Temp File Manager (`tempFileManager.ts`)

Used for the **fallback edit paths** only — code notes, Mermaid, canvas, mind map, and the **Open as Markdown** command for text notes. Notes are edited as local temp files under `os.tmpdir()/vscode-trilium/`. A `onDidSaveTextDocument` listener in `extension.ts` converts the file back (Markdown→HTML for text notes via the fallback path, Markdown heading hierarchy→MindElixir JSON for mind map notes) and calls `client.putNoteContent`. A `.markdownlintignore` file with `**` is written to the temp directory on startup to suppress markdownlint warnings.

### Attributes Panel (`attributesViewProvider.ts`)

A `WebviewViewProvider` that renders note labels and relations as read-only HTML. All note data is HTML-escaped before rendering. CSP: `default-src 'none'; style-src 'unsafe-inline'`.

---

## Testing

Tests run entirely in Node.js — no VS Code instance is required. The `test/helpers/vscode-mock.ts` module intercepts `require('vscode')` and returns stubs from `vscode-stub.ts`.

```bash
npm test
```

When adding a new source file, add a corresponding test file under `test/unit/`. When adding a new `vscode.*` API usage, add the required stub to `test/helpers/vscode-stub.ts`.

---

## Adding a New Command

1. Implement the handler function in `src/extension.ts` (or a helper module it imports).
2. Register it with `vscode.commands.registerCommand('trilium.<name>', handler)` inside `activate()` and push it to `context.subscriptions`.
3. Add the command entry to `package.json` → `contributes.commands`.
4. If it should appear in the tree context menu, add a `view/item/context` entry to `package.json` → `contributes.menus` with an appropriate `when` clause.
5. Add the command to the commands table in `README.md`.

---

## Releasing

Releases are managed through GitHub's release UI, assisted by [Release Drafter](https://github.com/release-drafter/release-drafter).

### Step-by-step

1. **Label every merged PR** with one of: `feature` / `enhancement`, `fix` / `bug`, `chore` / `maintenance` / `dependencies` / `documentation`. Release Drafter uses these labels to categorise changes and determine the next version number (major / minor / patch).

2. **Draft release** — Release Drafter automatically maintains a draft release at the top of the [Releases page](https://github.com/NemesisRE/vscode-trilium-extension/releases). Review the draft, edit the title/notes if needed.

3. **Publish the draft release** on GitHub. This triggers the `release` event in CI.

4. **CI runs automatically** — the `package` job extracts the version from the release tag, updates `package.json` automatically, builds the VSIX, and attaches it to the GitHub Release as a downloadable asset.

The `.vsix` file is named `trilium-notes-<version>.vsix` and appears in the release assets within a few minutes of publishing.

### Version synchronization

The CI workflow automatically extracts the version from the Git tag (e.g., `v1.0.1` → `1.0.1`) and updates `package.json` before building. You don't need to manually update `package.json` before creating a release — the tag is the single source of truth.
