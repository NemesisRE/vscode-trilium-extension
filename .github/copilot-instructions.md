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

### Work Autonomously, but Know What Needs Sign-off
- For a normal task (a bug fix, a small feature, a refactor the user described), just do it: make the change, verify it (build/lint/test as applicable), and report what changed. No upfront plan-and-wait step is required.
- Before doing something **hard to undo or broad in effect**, stop and ask first instead of proceeding silently:
  - adding, removing, or upgrading a dependency
  - a change that touches many files or restructures existing code beyond what the task needs
  - lowering `engines.vscode`, changing activation events to `*`, or other manifest changes with wide behavioral impact
  - anything destructive (deleting files/data, force-pushing, rewriting history)
  - a breaking change (`!` / `BREAKING CHANGE:`)
- If the user's intent is ambiguous, or two valid implementations have a real trade-off, ask a focused question rather than guessing — but don't block small, clearly-scoped work on approval that wasn't requested.
- If a fact about an API, version, or behavior is uncertain, resolve it via documentation lookup (see above) before proceeding; only ask the user when the lookup itself is inconclusive.

### Conventional Commits and Branch Naming
- Use Conventional Commit prefixes in commit messages and PR titles: `feat`, `fix`, `chore`, `docs`, and optional breaking marker `!` (for example `feat(api)!: remove legacy endpoint`).
- Prefer branch names with matching prefixes, e.g. `feat/<topic>`, `fix/<topic>`, `chore/<topic>`, `docs/<topic>`, `breaking-change/<topic>`.
- Keep commit type aligned with actual change intent to support release automation:
  - `feat` increments minor releases.
  - `fix` increments patch releases.
  - `!` or `BREAKING CHANGE:` marks major-release intent.
- When commit type is ambiguous, ask before choosing a prefix.

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

### Trilium Parity and Visual Design
- **The extension's UI/UX must match Trilium Notes' look and feel as closely as possible.** This includes:
  - Visual styling and presentation of note types
  - Math rendering engines and their output (use KaTeX to match Trilium's native math rendering)
  - Icon choices and colors
  - Editor toolbar and control appearance
  - Tree presentation (icons, spacing, indentation)
  - Dialog and notification styling
- When choosing between multiple valid implementations, prefer the option that achieves visual parity with Trilium.
- Plugin and library selection must consider visual/behavioral compatibility with Trilium, not just functionality.

---

## Code Quality Rules

- Match the existing code style in each file before introducing new patterns.
- Do not add new dependencies without asking first (see "Work Autonomously" above).
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

When referencing or verifying information, use these canonical sources — fetch live, never rely on training-data recall (versions and APIs both go stale):

| Topic | Source |
|---|---|
| VS Code Extension API | https://code.visualstudio.com/api |
| VS Code API type definitions | `node_modules/@types/vscode/index.d.ts` |
| VS Code Contribution Points | https://code.visualstudio.com/api/references/contribution-points |
| VS Code Built-in Commands | https://code.visualstudio.com/api/references/commands |
| Trilium Notes API / Docs | https://github.com/TriliumNext/trilium-notes/wiki (or upstream repo) |
| Latest stable version of an npm package | Fetch `https://registry.npmjs.org/{package}/latest`, read the `version` field |
| Latest version of a GitHub Action | The action's GitHub releases page (e.g. `https://github.com/{owner}/{repo}/releases/latest`) |
| Current stable Node.js LTS | `https://nodejs.org/dist/index.json` |
| TypeScript compiler option validity | https://www.typescriptlang.org/tsconfig or installed `typescript/lib/typescript.d.ts` |
| VS Code minimum engine version | `node_modules/@types/vscode/index.d.ts` — use the lowest version that exposes every API the code uses |

This applies whenever adding/upgrading a dependency, writing or bumping a GitHub Actions `uses:` pin, setting `engines.node`/`engines.vscode`/`target`/`lib`, or answering any "what's the latest/current version of X" question.

---

