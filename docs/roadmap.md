# Roadmap

This roadmap is a working list of improvements and ideas, not a strict milestone commitment.

## Recently Completed

- Text-note CKEditor tabs now use native unsaved-close protection semantics.
- Save flow for text notes is now server-first, so unresolved upstream conflicts do not silently clear dirty state.
- Conflict resolution for text notes now includes **Compare**, **Keep Ours**, and **Use Theirs**.
- Conflict diff now uses read-only **Theirs** and editable **Ours** with HTML pretty-printing for readable line-by-line comparison.
- Closing tabs now cleans up managed virtual/temp note documents more reliably.

## Editor Polish

- Fix CKEditor dropdown button hover colors for insert actions such as code block and footnote.
- Insert a trailing newline after block elements such as block quotes, code blocks, and admonitions so editing after them feels natural.
- Render math elements visually as math instead of exposing raw LaTeX where possible.
- Add a `highlight.js` theme setting and apply the selected theme in the editor.
- Make unchecked checkboxes more visible in dark themes.
- Improve embedded PDF handling so notes show at least the file name, plus open and download actions.

## Note Opening and Navigation

- Open section notes on click instead of only expanding or collapsing them.
- Support middle click to select a note without opening it.
- Add a right-click action for **View Attributes**.
- Open code notes directly in a VS Code editor tab even when the note has attachments.
- Improve file extension detection for code notes so JavaScript opens as `.js` and other languages use the best matching extension instead of `.txt`.

## Media and External Content

- Open PDF notes directly inside VS Code instead of forcing download.
- Open VS Code's internal browser automatically when a webview note has a URL attribute.
- Improve attachment-aware note handling so embedded and linked files behave more predictably.

## Richer Views

- Add a calendar view for notes that use `viewType=calendar`.
- Fix mind map support so mind map notes open in a native format for the MindElixir extension instead of round-tripping through Markdown.

## Visual Fidelity with Trilium

- Use original Trilium Boxicons more accurately by reading the `iconClass` attribute.
- Make locked or protected notes visually distinct in the tree so their status is obvious at a glance.
- Continue improving icon, color, and note-type presentation so the tree more closely matches Trilium itself.

## Reliability and UX

- Extend native-style dirty-state and conflict handling consistency from text notes to all editable note types.
- Refresh open editors more predictably when notes are renamed, moved, or modified externally.
- Add clearer fallback behavior when a note type cannot be rendered natively.
- Improve error messages around attachments and binary note handling.

## Good Next Additions

- Add quick backlinks and parent-path navigation.
- Add a lightweight recent notes or pinned notes view.
- Add note preview on hover in the tree.
- Add optional auto-refresh for externally changed notes.
