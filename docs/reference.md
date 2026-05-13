# Reference

## Extension Settings

All settings are under the `trilium` namespace and can be changed in VS Code Settings.

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `trilium.serverUrl` | `string` | `http://localhost:8080` | URL of your Trilium server. |
| `trilium.rootNoteId` | `string` | `root` | Root note ID for the tree view. Change this to scope the tree to a subtree. |
| `trilium.editor.fontSize` | `number` (8-32) | `14` | Font size in pixels for the CKEditor content area. |
| `trilium.editor.spellcheck` | `boolean` | `false` | Enable the browser's built-in spellcheck in the CKEditor content area. |
| `trilium.editor.highlightTheme` | `string` | `vscode` | Theme used for code-block syntax highlighting in the editor. |
| `trilium.recentNotesMaxCount` | `number` (1-50) | `10` | Maximum number of notes shown in the Recent Notes view. |
| `trilium.autoRevealInTreeOnOpen` | `boolean` | `false` | Automatically reveal and focus a note in the tree after opening it in an editor. |
| `trilium.autoRefreshIntervalSeconds` | `number` (0-600) | `30` | Interval for polling external updates on open notes. Set `0` to disable. |
| `trilium.autoRefreshMaxConsecutiveFailures` | `number` (1-100) | `8` | Maximum consecutive refresh failures before an open note is untracked from polling. |
| `trilium.autoRefreshWarnAfterFailures` | `number` (1-50) | `3` | Show retry/reconnect warning after this many consecutive refresh failures (and every N failures after). |

## Commands

All commands are available via the Command Palette under the **Trilium** category.

| Command | Description |
| --- | --- |
| `Trilium: Connect to Trilium Server` | Enter server URL and ETAPI token. |
| `Trilium: Reconnect to Trilium Server` | Reconnect with current settings and token. |
| `Trilium: Refresh` | Reload the note tree from the server. |
| `Trilium: Open Note` | Open a note in its default editor flow: CKEditor for text, VS Code text editor for code, built-in Mermaid/Canvas/Mind Map editors for those special note types, and appropriate fallback handling for file-like notes. |
| `Trilium: Open as Markdown` | Open a text note converted to Markdown in the text editor and save it back as HTML. |
| `Trilium: Open as HTML` | Open a text note's raw HTML in a read-only editor view. |
| `Trilium: Open File` | Open a file note in a temporary local file for inspection. |
| `Trilium: New Note` | Quick-create a text note from the toolbar. |
| `Trilium: New Text Note` | Create a text note under the selected item. |
| `Trilium: New Code Note` | Create a code note and choose the language from a list. |
| `Trilium: New Mermaid Diagram` | Create a Mermaid diagram note with a starter template. |
| `Trilium: New Canvas (Excalidraw)` | Create an Excalidraw canvas note. |
| `Trilium: New Mind Map Note` | Create a mind map note (opens the interactive preview immediately). |
| `Trilium: Create Note With Content (programmatic)` | Programmatic command for creating one note without interactive prompts. |
| `Trilium: Import Notes from JSON` | Bulk-import a JSON tree of notes. |
| `Trilium: Rename Note` | Rename the selected note. |
| `Trilium: Delete Note` | Delete the selected note after confirmation. |
| `Trilium: Open Today's Journal Note` | Open the Trilium journal entry for today. |
| `Trilium: Open Calendar Note...` | Open today's, inbox, this week's, this month's, or this year's note. |
| `Trilium: Open Inbox Note` | Open the Trilium inbox note for today. |
| `Trilium: Open This Week's Note` | Open the current ISO week note. |
| `Trilium: Open This Month's Note` | Open the current month note. |
| `Trilium: Open This Year's Note` | Open the current year note. |
| `Trilium: Open Mermaid Diagram` | Open the built-in Mermaid editor for a Mermaid note, with live rendered preview, auto-save, and breadcrumb navigation. |
| `Trilium: Open Mermaid Source (.mmd)` | Open the raw Mermaid source for a Mermaid note in VS Code's text editor. |
| `Trilium: Open Canvas` | Open the built-in local Excalidraw editor for a canvas note, with auto-save and breadcrumb navigation. |
| `Trilium: Open Canvas JSON (.excalidraw)` | Open the pretty-printed raw Excalidraw JSON for a canvas note in VS Code's text editor. |
| `Trilium: Open Mind Map` | Open the interactive MindElixir editor for a mind-map note in the active editor group (default when clicking a mind-map note in the tree; also available as an editor title action when a mind-map JSON file is active). |
| `Trilium: Open Mind Map JSON` | Open the raw MindElixir JSON for a mind-map note in the text editor for manual editing or advanced/manual fixes. |
| `Trilium: Search Notes...` | Live full-text search with a debounced QuickPick. |
| `Trilium: Filter Tree...` | Filter the note tree by keyword using server-side search. |
| `Trilium: Clear Tree Filter` | Reset the tree to its normal hierarchical view. |
| `Trilium: View Attributes` | Show attributes for the selected note in the attributes view. |
| `Trilium: Copy Note ID` | Copy the selected note's ID to the clipboard. |
| `Trilium: Copy Trilium URL` | Copy the selected note's full Trilium URL to the clipboard. |
| `Trilium: Open in Browser` | Open the note in VS Code's Simple Browser. |
| `Trilium: Open in External Browser` | Open the note in the system browser. |
| `Trilium: Download File` | Download a file or image note to disk. |
| `Trilium: Show Note Revisions...` | Show saved revision history for a note. |
| `Trilium: Clone Note...` | Clone a note to a second location. |
| `Trilium: Move Note...` | Move a note to a new parent. |
| `Trilium: Reorder Child Notes...` | Reorder direct children of a note with drag and drop. |
| `Trilium: Export Subtree...` | Export a note and its descendants as an HTML or Markdown ZIP. |
| `Trilium: Clear Recent Notes` | Clear all entries in the Recent Notes view. |
| `Trilium: Reveal Note in Tree` | Reveal the current editor note inside the tree view. |
| `Trilium: Open Parent Note` | Open the parent of the current note. |
| `Trilium: Open Note by ID (internal)` | Internal helper command used by extension workflows. |
| `Trilium: Debug: List Language Model Tools` | Debug helper to list registered language model tools. |
