# Reference

## Extension Settings

All settings are under the `trilium` namespace and can be changed in VS Code Settings.

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `trilium.serverUrl` | `string` | `http://localhost:8080` | URL of your Trilium server. |
| `trilium.rootNoteId` | `string` | `root` | Root note ID for the tree view. Change this to scope the tree to a subtree. |
| `trilium.editor.fontSize` | `number` (8-32) | `14` | Font size in pixels for the CKEditor content area. |
| `trilium.editor.spellcheck` | `boolean` | `false` | Enable the browser's built-in spellcheck in the CKEditor content area. |

## Commands

All commands are available via the Command Palette under the **Trilium** category.

| Command | Description |
| --- | --- |
| `Trilium: Connect to Trilium Server` | Enter server URL and ETAPI token. |
| `Trilium: Refresh` | Reload the note tree from the server. |
| `Trilium: Open Note` | Open a text, code, mermaid, canvas, or mind-map note in the editor. |
| `Trilium: Open as Markdown` | Open a text note converted to Markdown in the text editor and save it back as HTML. |
| `Trilium: Open as HTML` | Open a text note's raw HTML in a read-only editor view. |
| `Trilium: New Note` | Quick-create a text note from the toolbar. |
| `Trilium: New Text Note` | Create a text note under the selected item. |
| `Trilium: New Code Note` | Create a code note and choose the language from a list. |
| `Trilium: New Mermaid Diagram` | Create a Mermaid diagram note with a starter template. |
| `Trilium: New Canvas (Excalidraw)` | Create an Excalidraw canvas note. |
| `Trilium: New Mind Map Note` | Create a mind map note. |
| `Trilium: Import Notes from JSON` | Bulk-import a JSON tree of notes. |
| `Trilium: Rename Note` | Rename the selected note. |
| `Trilium: Delete Note` | Delete the selected note after confirmation. |
| `Trilium: Open Today's Journal Note` | Open the Trilium journal entry for today. |
| `Trilium: Open Calendar Note...` | Open today's, inbox, this week's, this month's, or this year's note. |
| `Trilium: Open Inbox Note` | Open the Trilium inbox note for today. |
| `Trilium: Open This Week's Note` | Open the current ISO week note. |
| `Trilium: Open This Month's Note` | Open the current month note. |
| `Trilium: Open This Year's Note` | Open the current year note. |
| `Trilium: Search Notes...` | Live full-text search with a debounced QuickPick. |
| `Trilium: Filter Tree...` | Filter the note tree by keyword using server-side search. |
| `Trilium: Clear Tree Filter` | Reset the tree to its normal hierarchical view. |
| `Trilium: Copy Note ID` | Copy the selected note's ID to the clipboard. |
| `Trilium: Copy Trilium URL` | Copy the selected note's full Trilium URL to the clipboard. |
| `Trilium: Open in Browser` | Open the note in VS Code's Simple Browser. |
| `Trilium: Open in External Browser` | Open the note in the system browser. |
| `Trilium: Download File` | Download a file or image note to disk. |
| `Trilium: Show Note Revisions...` | Show saved revision history for a note. |
| `Trilium: Clone Note...` | Clone a note to a second location. |
| `Trilium: Move Note...` | Move a note to a new parent. |
| `Trilium: Export Subtree...` | Export a note and its descendants as an HTML or Markdown ZIP. |
