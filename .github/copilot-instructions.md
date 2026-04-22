# VS Code Extension Development — Agent Instructions

## Core Behavioral Rules

### No Guessing or Hallucination
- **Never** invent, assume, or guess API signatures, extension host APIs, contribution point names, configuration keys, activation events, or any other VS Code or Trilium API details.
- If a fact is uncertain, **stop and ask** the user or look it up in official documentation before proceeding.
- Do not fabricate package versions, extension manifest fields, or command IDs.

### Verify Everything Before Acting
- All VS Code API usage must be confirmed against the [official VS Code Extension API docs](https://code.visualstudio.com/api) or retrieved from the installed type definitions (`@types/vscode`).
- All Trilium API or data model assumptions must be verified against upstream Trilium documentation or source before use.
- When adding a dependency, check its current version on npm registry — do not hardcode version numbers from memory.
- Before referencing a `vscode.*` namespace, method, or event, confirm it exists in the target `engines.vscode` version.

### Use Live Documentation, Not Training Data
**Training-data API knowledge is stale.** Package APIs, compiler options, GitHub Actions inputs, and framework behaviour all change between releases. After resolving the version of any dependency or tool (see Version Lookup Policy below), always fetch the matching upstream documentation before writing code or configuration against it.

| Situation | What to fetch |
|---|---|
| Using or upgrading an npm package | Fetch the package README or docs URL from `https://registry.npmjs.org/{package}/latest` → `readme` / `homepage` |
| TypeScript compiler options | Fetch `https://www.typescriptlang.org/tsconfig` for the resolved TS version |
| GitHub Actions inputs/outputs | Fetch `https://github.com/{owner}/{repo}/blob/{tag}/action.yml` for the resolved action tag |
| Node.js built-in APIs | Fetch `https://nodejs.org/docs/latest-v{major}.x/api/{module}.html` for the resolved major |
| VS Code API | Check `node_modules/@types/vscode/index.d.ts` for the resolved engine version |

Never rely on recalled API shapes for a package you haven't verified at the resolved version. If the docs fetch fails or the API surface is ambiguous, surface the uncertainty to the user before writing code.

### Always Present a Plan First
- Before writing or modifying any code, configuration, or file, produce a concise numbered plan describing:
  1. What will be changed and why
  2. Which files will be created, modified, or deleted
  3. Any assumptions that require user confirmation
- **Wait for explicit user approval** before executing the plan.
- If a step becomes unclear during execution, pause and re-confirm rather than making a judgment call.

### Ask When in Doubt
- If the user's intent is ambiguous, ask a focused clarifying question before proceeding.
- If two valid implementation approaches exist with meaningful trade-offs, present them briefly and ask which to use.
- Do not silently pick the "easier" or "faster" option without disclosure.

---

## VS Code Extension Specific Rules

### manifest (`package.json`)
- Every `contributes.*` entry must map to a real contribution point documented in the VS Code API reference.
- `activationEvents` must be intentional — avoid `*` (activate on startup) unless explicitly required and approved.
- `engines.vscode` must reflect the minimum API surface actually used; do not lower it without checking breaking changes.

### Extension Host Context
- Never use Node.js built-ins (e.g., `fs`, `path`, `child_process`) directly in web-compatible extension code without gating on `vscode.env.uiKind`.
- Do not access `process.env` from the extension host without noting it is unavailable in web extensions.
- Use `vscode.Uri` instead of raw path strings wherever the API accepts it.

### Security
- Do not construct webview HTML using unescaped user input — always sanitize and use a strict CSP.
- Secrets (API keys, tokens) must be stored via `vscode.SecretStorage`, never in `globalState` or settings.
- Do not execute arbitrary shell commands constructed from user-provided strings.

### Testing
- Unit tests must not depend on a running VS Code instance unless using the extension test runner (`@vscode/test-electron` / `@vscode/test-web`).
- Mock `vscode` APIs using the `@vscode/test-electron` test helpers or a manual stub — do not assume global availability.

---

## Code Quality Rules

- Match the existing code style in each file before introducing new patterns.
- Do not add new dependencies without listing them in the plan and getting approval.
- Do not refactor, rename, or restructure existing code unless it is directly required by the task.
- Prefer small, focused changes over large rewrites.
- Remove dead code only when explicitly asked.

---

## Documentation & Comments

- Do not add comments that merely restate what the code already clearly expresses.
- Only add JSDoc/TSDoc when the function is part of a public-facing API or its behavior is non-obvious.
- Do not generate a separate markdown change-log or summary document unless explicitly requested.

---

## Upstream Documentation Sources

When referencing or verifying information, use these canonical sources:

| Topic | Source |
|---|---|
| VS Code Extension API | https://code.visualstudio.com/api |
| VS Code API type definitions | `node_modules/@types/vscode/index.d.ts` |
| VS Code Contribution Points | https://code.visualstudio.com/api/references/contribution-points |
| VS Code Built-in Commands | https://code.visualstudio.com/api/references/commands |
| Trilium Notes API / Docs | https://github.com/TriliumNext/trilium-notes/wiki (or upstream repo) |
| npm package versions | https://www.npmjs.com (fetch live, do not guess) |

### Version Lookup Policy

**Never use training-data version numbers.** Versions in the model's training data are stale by definition. For every version reference — npm packages, GitHub Actions, Node.js, TypeScript compiler options, VS Code engine ranges — look it up at the authoritative source before writing it.

| What you need | How to get it |
|---|---|
| Latest stable version of an npm package | Fetch `https://registry.npmjs.org/{package}/latest` and read the `version` field |
| Latest version of a GitHub Action | Fetch the action's GitHub releases page (e.g. `https://github.com/{owner}/{repo}/releases/latest`) |
| Current stable Node.js LTS | Fetch `https://nodejs.org/en/download/` or `https://nodejs.org/dist/index.json` |
| TypeScript compiler option validity | Fetch `https://www.typescriptlang.org/tsconfig` or check installed `typescript/lib/typescript.d.ts` |
| VS Code minimum engine version | Check `node_modules/@types/vscode/index.d.ts` — use the lowest version that exposes every API the code uses |

Apply this policy whenever:
- Adding or upgrading a dependency in `package.json`
- Writing or updating a GitHub Actions workflow (`uses: action@vX`)
- Setting `engines.node`, `engines.vscode`, or any `"target"` / `"lib"` in `tsconfig.json`
- Answering any question that requires knowing the "latest" or "current" version of anything

---

## Trilium Note Creation (for contributors using Copilot)

The extension registers two **Language Model Tools** (`trilium_createNote` and
`trilium_importNotes`) via `vscode.lm.registerTool`. Copilot Chat discovers
and invokes these automatically for all end users — no `executeCommand` wiring
needed for note-creation tasks.

When working on this codebase and the user asks you to create notes or
documentation in Trilium, prefer invoking the tools directly via chat rather
than writing `executeCommand` calls.

### Content format guidelines

| Note type | `content` format |
|---|---|
| `text` | CKEditor HTML — e.g. `<h1>Title</h1><p>Body text</p>` |
| `code` | Raw source code; also supply `mime` (e.g. `text/javascript`) |
| `mermaid` | Mermaid diagram syntax only — no code fences |
| `canvas` | Excalidraw JSON string — `{"type":"excalidraw","version":2,"elements":[],"appState":{}}` |

### Rules when generating Trilium notes

- For `text` notes, always wrap content in valid HTML tags (at minimum `<p>...</p>`).
- For `mermaid` notes, content must be valid Mermaid syntax only — no code fences.
- For `canvas` notes, use the minimal Excalidraw JSON shown above as a starting point.
- Never fabricate noteIds; use `'root'` as the default parent unless the user specifies otherwise.
