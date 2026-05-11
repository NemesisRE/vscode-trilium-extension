# Roadmap

This roadmap is a working list of improvements and ideas, not a strict milestone commitment.

## Recently Completed

- Text-note CKEditor tabs now use native unsaved-close protection semantics.
- Save flow for text notes is now server-first, so unresolved upstream conflicts do not silently clear dirty state.
- Conflict resolution for text notes now includes **Compare**, **Keep Ours**, and **Use Theirs**.
- Conflict diff now uses read-only **Theirs** and editable **Ours** with HTML pretty-printing for readable line-by-line comparison.
- Closing tabs now cleans up managed virtual/temp note documents more reliably.
- Tree protected-note presentation now follows Trilium more closely: protected entries are masked as `[protected]` and shown with a lock icon in the tree.
- Unchecked task-list checkboxes are now more visible in dark themes.
- Notes that cannot be rendered natively now offer clear browser fallback actions.
- Attachment/file opening now uses more predictable MIME-aware filename and extension handling.
- Section notes now open on click while keeping disclosure arrows for expand/collapse.
- Tree context menu now includes a right-click **View Attributes** action.
- Code notes now open directly in VS Code editor tabs regardless of attachment presence.
- Code-note extension detection now maps language MIME types more accurately (for example JavaScript to `.js`) instead of defaulting to `.txt`.
- PDF/file notes now open directly in VS Code by default, with separate download action retained.
- Webview notes now open VS Code's internal browser automatically when a URL-like attribute is present.
- Added a `highlight.js` theme setting and applied selected theme palettes in the editor.
- Inserted a trailing paragraph after trailing block elements (block quote, code block, admonition) so editing after them feels natural.
- Embedded PDF attachments now clearly show filename with dedicated open and download actions.
- Attachment-related failures now surface clearer, operation-specific error messages.
- Tree icons now resolve original Trilium Boxicons from `iconClass` (regular, solid, and logos) with safe fallback behavior.
- Search and destination quick picks now use iconClass-aware icon selection for more consistent visual presentation.
- Note-type labels are now normalized (for example `webView` → `web view`, `mindMap` → `mind map`) for clearer, more Trilium-like presentation.
- Tree note icons now use real Trilium Boxicons with theme-aware recoloring (plus codicon fallback), avoiding black icons while preserving visual fidelity across VS Code themes.
- Default tree note icons now follow Trilium behavior more closely, including section-folder defaults and MIME-aware file/image icon choices.
- Notes can now be moved in the tree via drag-and-drop (branch move), with subtree-safe cycle protection and same-parent no-op behavior.
- Tree context menu now includes a drag-based "Reorder Child Notes..." window to set precise sibling order and push notePosition updates.
- Notes show a rich hover tooltip in the tree with note type, child count, and a content preview (plain text for text notes, code block for code/mermaid notes).
- CKEditor dropdown button hover colors now correctly follow the active VS Code theme (split-button separator, list-item hover foreground, action-button hover state).
- A "Recent Notes" sidebar section tracks the last N (configurable via `trilium.recentNotesMaxCount`, default 10) opened notes with a clear-all toolbar button.
- Open notes are now silently refreshed when changed externally on the Trilium server. Controlled by `trilium.autoRefreshIntervalSeconds` (default 30 s, 0 = disabled); clean documents are updated automatically, dirty documents are left untouched.
- The text-note editor breadcrumb is now clickable, so parent-path navigation can open any ancestor note directly from the editor header.
- Added lightweight backlinks support: a dedicated Backlinks sidebar view for the currently selected/opened note plus an in-editor backlinks count badge in the breadcrumb header.
- Added "Reveal in Tree" and "Open Parent" editor navigation actions (available in editor title bar, tab context menu, and tree context menu) to speed up large-tree navigation; both commands work with all editor types (CKEditor, code, canvas, mermaid, mind-map).
- Fixed stale-cache reopen resilience: restored text-note editor tabs no longer throw errors on startup when disconnected. Instead, they show a safe placeholder and auto-refresh once reconnected, with automatic content fetch and update. Added unit test coverage for disconnected provider path.
- CKEditor image upload now routes inserted images through the extension host into Trilium attachments, then links them back into the note HTML automatically using Trilium's native attachment URL format.
- Fixed dirty-state regression for text notes: the editor now uses `CustomEditorProvider` so the tab dirty indicator (●) and native unsaved-close dialog are driven by content changes, not by the filesystem. Auto-save and Ctrl+S both push directly to Trilium via ETAPI; closing a dirty tab always triggers VS Code's native save prompt.
- LM tools `trilium_searchNotes`, `trilium_readNote`, `trilium_listChildren`, `trilium_updateNoteContent`, and `trilium_appendToNote` are now registered and discovered automatically by Copilot Chat. `trilium_readNote` strips all HTML tags before returning content to prevent prompt injection from note content.
- Protected-note warnings and LM tool error responses now use consistent, centralized messaging with clear guidance to unlock Protected Session in Trilium.
- Protected-note open flows now provide guided recovery actions (`Open in Browser`, `Open in External Browser`, `Reconnect`) instead of warning-only dead ends.
- Auto-refresh for open notes now keeps retrying through intermittent ETAPI/network failures, surfaces operation-specific recovery warnings, and supports configurable failure thresholds.
- Large-tree performance improved with short-lived note/branch fetch caching plus targeted subtree refresh calls for create/rename/delete/clone/move/reorder flows, reducing redundant ETAPI requests and full-tree redraws.
- Automated coverage now includes targeted tests for conflict-resolution save flows, reorder-panel validation/save behavior, tree refresh caching, and network-retry policy branches.
- Opening notes can now optionally auto-reveal and focus their location in the tree via `trilium.autoRevealInTreeOnOpen`.

## Next Priorities

These are the most useful and needed improvements based on current capabilities and known limitations.

### Near-Term Execution Order

### Editing Fidelity and Format Safety

- Implement true native mind-map editing for `mindMap` notes so the extension opens and saves MindElixir JSON directly (no Markdown round-trip and no metadata loss for node styles, colors, or layout).
- Add visual math rendering in text notes while preserving stable source editing and save fidelity.

### Reliability and Conflict Handling

- Extend server-first save + conflict tooling beyond text notes to all editable note types where safe and applicable.

### Trilium Compatibility and UX Parity

- Add a calendar note view for notes using `viewType=calendar`.
- Continue improving visual parity with Trilium for icon, color, and note-type presentation details.

### Tree and Navigation Workflows

- Extend recent-notes workflow with optional pinning and jump actions for frequently revisited notes.

### Copilot and Automation Tools

#### Write-Safe Operations

- Add `trilium_renameNote` LM tool: rename a note title with confirmation boundary.
- Add `trilium_moveNote` LM tool: move a note to a new parent with cycle-safety check and explicit confirmation.
- Add `trilium_deleteNote` LM tool: delete a note, gated behind a required `confirmed: true` input field so accidental deletion is not possible through an LM invocation.
- Add `trilium_getAttributes` / `trilium_setAttributes` LM tools to read and write labels and relations on a note, enabling AI-driven tagging and linking workflows.

#### Search and Context Gathering

- Add optional search modes for LM tools: title-only vs. full-text, and scoped subtree search by `ancestorNoteId`.
- Add a `trilium_getNoteContext` LM tool that returns a note's full ancestor path, its own attributes, and a summary of direct children in a single call — reducing the number of round-trips needed to ground LM context before generating or editing content.

#### AI-Driven Workflows

- AI-assisted note templating: allow Copilot to instantiate a structured note tree from a template note, filling placeholders from user-provided parameters.
- Subtree summarization: use `trilium_listChildren` + `trilium_readNote` in sequence to let Copilot produce a structured summary or table-of-contents for a notebook section.
- Batch label/attribute operations: expose a `trilium_batchSetAttributes` tool that accepts an array of `{ noteId, attributes }` records so LM-driven bulk-tagging workflows do not require a separate tool call per note.
- Expose Trilium note-tree structure as VS Code `.instructions.md` context fragments so agents working in other workspaces can reference the user's knowledge base without requiring explicit search calls.

#### Output Structure and Safety

- Improve LM tool output structure for downstream automation: return stable IDs, parent-path metadata, and consistent result blocks across all tools.
- Add per-tool `confirmationMessages` (VS Code LM tool `prepareInvocation` `confirmationMessages` field) to destructive write tools so Copilot Chat shows a confirmation dialog before executing delete or bulk-move operations.

### Quality, Tests, and Documentation

- Expand automated coverage for conflict resolution, auto-refresh behavior, drag-and-drop move/reorder, and code-note MIME/extension mapping.
- Add regression tests for stale-cache reopen and network-retry flows.
- Keep docs synchronized with shipped settings/commands (including new refresh, recent-notes, and backlinks behaviors) and call out compatibility caveats clearly.
