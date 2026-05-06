# Roadmap

This roadmap is a working list of improvements and ideas, not a strict milestone commitment.

## Recently Completed

- Text-note CKEditor tabs now use native unsaved-close protection semantics.
- Save flow for text notes is now server-first, so unresolved upstream conflicts do not silently clear dirty state.
- Conflict resolution for text notes now includes **Compare**, **Keep Ours**, and **Use Theirs**.
- Conflict diff now uses read-only **Theirs** and editable **Ours** with HTML pretty-printing for readable line-by-line comparison.
- Closing tabs now cleans up managed virtual/temp note documents more reliably.
- Tree notes that are locked/protected are now visually marked so status is obvious in the tree.
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

## Editor Polish

- Render math elements visually as math instead of exposing raw LaTeX where possible.

## Richer Views

- Add a calendar view for notes that use `viewType=calendar`.
- Fix mind map support so mind map notes open in a native format for the MindElixir extension instead of round-tripping through Markdown.

## Visual Fidelity with Trilium

- Continue improving icon, color, and note-type presentation so the tree more closely matches Trilium itself.

## Reliability and UX

- Extend native-style dirty-state and conflict handling consistency from text notes to all editable note types.
