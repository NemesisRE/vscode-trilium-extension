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
| `npm run build` | Bundle extension with esbuild (development, with sourcemaps) |
| `npm run build:prod` | Bundle extension with esbuild (production, minified) |
| `npm run watch` | Rebuild on every file save |
| `npm test` | Compile tests + run all unit tests with Mocha |
| `npm run package` | Package the extension into a `.vsix` file |

---

## Project Structure

```
src/
  extension.ts            Entry point — activate(), deactivate(), command registrations
  etapiClient.ts          HTTP client wrapping the Trilium ETAPI REST API
  noteTreeProvider.ts     VS Code TreeDataProvider + FileDecorationProvider for the note tree
  settings.ts             Read serverUrl from configuration, read/write ETAPI token via SecretStorage
  tempFileManager.ts      Create/manage temp files for editing notes; HTML↔Markdown and MindMap conversions
  attributesViewProvider.ts  WebviewViewProvider rendering the Attributes sidebar panel

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

## Architecture Notes

### ETAPI Client (`etapiClient.ts`)

Thin wrapper around `fetch`. All methods throw an `EtapiError` (with `.code` and `.message`) on non-2xx responses. The ETAPI token is passed as the `Authorization: Basic` header (base64 of `user:token`, per Trilium's ETAPI spec — the "user" field is ignored).

### Note Tree (`noteTreeProvider.ts`)

`NoteItem` extends `vscode.TreeItem`. Icon is resolved from the `#iconClass` label attribute (BoxIcon name) via a static `BOXICON_TO_CODICON` lookup table, falling back to a per-type default. Color is resolved from the `#color` label attribute via `NoteTreeDecorationProvider`, which returns a `vscode.FileDecoration` using `charts.*` theme colors.

### Temp File Manager (`tempFileManager.ts`)

Notes are edited as local temp files under `os.tmpdir()/vscode-trilium/`. A `onDidSaveTextDocument` listener in `extension.ts` converts the file back (Markdown→HTML for text notes, Markdown heading hierarchy→MindElixir JSON for mind map notes) and calls `client.putNoteContent`. A `.markdownlintignore` file with `**` is written to the temp directory on startup to suppress markdownlint warnings.

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
