# Trilium Notes for VS Code

Browse, search, and edit your [Trilium Notes](https://github.com/zadam/trilium) directly inside VS Code using the [ETAPI REST API](https://triliumnotes.org/api).

---

## Features

### Note Tree

- Browse your entire Trilium note hierarchy in the VS Code Activity Bar sidebar.
- Notes with children can be expanded; leaf notes open on single click.
- Note type is shown as a description badge (e.g. `code`, `mermaid`, `canvas`).
- Note icons are resolved from the `#iconClass` label attribute (Boxicons class name → VS Code Codicon). Each note type has a sensible default icon when no attribute is set.
- Note colors are driven by the `#color` label attribute and are shown as tree item color decorations.

### Open & Edit Notes

- **Text notes** — opened as Markdown. Changes are converted back to HTML and saved to Trilium on file save.
- **Code notes** — opened with the correct language (Python, JavaScript, TypeScript, SQL, …). Changes saved directly.
- **Mermaid notes** — opened as `.mmd`. Rendered visually if the [Mermaid Preview](https://marketplace.visualstudio.com/items?itemName=vstirbu.vscode-mermaid-preview) or [Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid) extension is installed.
- **Canvas notes** — opened as `.excalidraw` JSON. Rendered visually if the [Excalidraw](https://marketplace.visualstudio.com/items?itemName=pomdtr.excalidraw-editor) extension is installed.

### Open as HTML

Right-click any **text** note and choose **Open as HTML** to view the raw CKEditor HTML without Markdown conversion — useful for notes with complex tables, custom styles, or embedded widgets.

### Open in Browser (Internal)

Right-click any note and choose **Open in Browser** to open it in VS Code's built-in Simple Browser. Falls back to your system browser if the Simple Browser is not available.

### Open in External Browser

Right-click any note and choose **Open in External Browser** to open it in your default system browser with the full note path (`#root/…/noteId`).

### Download File / Image Notes

Right-click a **file** or **image** note and choose **Download File** to save the binary content locally via a save-file dialog.

### Create Notes

- Click the **+** button in the panel toolbar to quickly create a new text note under the root.
- Click the **$(cloud-upload) Import Notes** button in the toolbar to bulk-import a JSON tree.
- Right-click any note and choose **New Note...** to open a submenu with five note-type options:
  - **New Text Note** — rich text (HTML stored, Markdown in editor)
  - **New Code Note** — choose language from a QuickPick list
  - **New Mermaid Diagram** — opens as `.mmd` with a starter diagram
  - **New Canvas (Excalidraw)** — opens as `.excalidraw` JSON
  - **New Mind Map Note** — opens as `.md` (Markdown heading hierarchy)
- Right-click on empty space in the panel to create a new note at the root level.

### Rename Notes

Right-click any note and choose **Rename Note**, or press **F2** while the tree has focus.

### Delete Notes

Right-click any note and choose **Delete Note**. A confirmation dialog is shown before deletion. If the note is currently open in an editor, the editor tab is closed automatically.

### Today's Journal Note

Click the **calendar** button in the panel toolbar (or run **Trilium: Open Today's Journal Note** from the Command Palette) to open the Trilium journal entry for today. Trilium creates the note automatically if it does not exist yet.

### Mind Map Notes

- **Mind Map notes** — the MindElixir JSON is converted to a Markdown heading hierarchy and opened as `.md`. Changes are converted back to MindElixir JSON and saved to Trilium on file save. Install the [Markdown MindMap](https://marketplace.visualstudio.com/items?itemName=MindElixir.mark-elixir) extension to render the file as a visual mind map.

### Attributes Sidebar

Select any note in the tree to see its **labels** and **relations** in the **Attributes** panel below the note tree. Labels are shown as `#name = value`; relations as `~name → targetId`.

---

## AI / Programmatic Note Creation

### GitHub Copilot Chat (automatic)

The extension registers two **Language Model Tools** that Copilot Chat discovers automatically. No setup required — just ask Copilot while the extension is connected:

> *"Create a Trilium note called 'Meeting Notes' with today's agenda."*
> *"Add a project documentation tree to Trilium with an overview page, a Mermaid architecture diagram, and three API reference pages."*

Copilot will invoke the `trilium_createNote` or `trilium_importNotes` tool directly and confirm before making changes.

#### Content format guidelines

| Note type | Content format |
| --- | --- |
| `text` | CKEditor HTML — e.g. `<h1>Title</h1><p>Body</p>` |
| `code` | Raw source code; also supply a `mime` (e.g. `text/javascript`) |
| `mermaid` | Mermaid diagram syntax only — no code fences |
| `canvas` | Excalidraw JSON string — e.g. `{"type":"excalidraw","version":2,"elements":[],"appState":{}}` |

---

### Programmatic / Automation Scripts

Two commands can also be invoked via `vscode.commands.executeCommand` from any VS Code extension or automation script.

#### `trilium.createNoteWithContent`

Create a single note programmatically without any UI.

```typescript
const result = await vscode.commands.executeCommand(
  'trilium.createNoteWithContent',
  'root',          // parentNoteId (string)
  'My Note',       // title (string)
  'text',          // type: 'text' | 'code' | 'mermaid' | 'canvas'
  '<p>Hello</p>',  // content (string — HTML for text, raw for others)
  undefined,       // mime (string | undefined, required for code notes)
);
// result: { noteId: string }
```

#### `trilium.importNotes`

Create an entire documentation hierarchy recursively from a JSON array.

```typescript
const result = await vscode.commands.executeCommand(
  'trilium.importNotes',
  'root',   // parentNoteId (string | undefined — defaults to 'root')
  JSON.stringify([
    {
      title: 'Project Docs',
      type: 'text',
      content: '<h1>Project Docs</h1><p>Overview...</p>',
      children: [
        {
          title: 'Architecture',
          type: 'mermaid',
          content: 'graph TD\n    Client --> API\n    API --> DB',
        },
        {
          title: 'Data Model',
          type: 'canvas',
          content: JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {} }),
        },
        {
          title: 'API Reference',
          type: 'text',
          content: '<h2>Endpoints</h2>',
          children: [
            { title: 'GET /notes', type: 'text', content: '<p>Returns all notes.</p>' },
          ],
        },
      ],
    },
  ]),
);
// result: { created: number }
```

#### `NoteImportSpec` schema

```typescript
interface NoteImportSpec {
  title: string;                                      // required
  type?: 'text' | 'code' | 'mermaid' | 'canvas';     // default: 'text'
  mime?: string;                                      // required for code notes
  content?: string;                                   // HTML for text, raw for others
  children?: NoteImportSpec[];                        // nested child notes
}
```

> **Tip:** When using the programmatic `trilium.importNotes` command, you can ask Copilot to generate the JSON spec — e.g. *"Generate a trilium.importNotes JSON for a project with an overview page, a Mermaid architecture diagram, and three API endpoint pages."* Or just ask Copilot Chat directly — the extension's built-in LM tools will handle everything automatically.

---

## Requirements

- VS Code **1.116** or later (desktop only — web/Codespaces not supported).
- A running **Trilium Notes** server reachable from your machine.
- An **ETAPI token** generated in Trilium: `Options → ETAPI → Create new ETAPI token`.

---

## Getting Started

1. Install the extension.
2. Open the **Trilium Notes** panel in the Activity Bar (tree icon).
3. Click the **connect** icon (plug) or run the command **Trilium: Connect to Trilium Server** from the Command Palette (`Ctrl+Shift+P`).
4. Enter your server URL (e.g. `http://localhost:8080`) and your ETAPI token.
5. Your note tree will appear. Click any note to open it.

---

## Extension Settings

| Setting | Default | Description |
| --- | --- | --- |
| `trilium.serverUrl` | `http://localhost:8080` | URL of your Trilium Notes server. |

The ETAPI token is stored securely in VS Code's `SecretStorage` (system keychain) and is never written to settings files.

---

## Commands

All commands are available via the Command Palette (`Ctrl+Shift+P`) under the **Trilium** category.

| Command | Description |
| --- | --- |
| `Trilium: Connect to Trilium Server` | Enter server URL and ETAPI token. |
| `Trilium: Refresh` | Reload the note tree from the server. |
| `Trilium: Open Note` | Open a text/code/mermaid/canvas/mind-map note in the editor. |
| `Trilium: Open as HTML` | Open a text note's raw HTML in the editor. |
| `Trilium: New Note` | Quick-create a text note under the root (toolbar button). |
| `Trilium: New Text Note` | Create a text note under the selected item (right-click submenu). |
| `Trilium: New Code Note` | Create a code note — choose language from a list. |
| `Trilium: New Mermaid Diagram` | Create a Mermaid diagram note. |
| `Trilium: New Canvas (Excalidraw)` | Create an Excalidraw canvas note. |
| `Trilium: New Mind Map Note` | Create a Mind Map note (edited as Markdown, saved as MindElixir JSON). |
| `Trilium: Import Notes from JSON` | Bulk-import a JSON tree of notes (toolbar button or programmatic). |
| `Trilium: Rename Note` | Rename the selected note (also F2). |
| `Trilium: Delete Note` | Delete the selected note (confirmation required). |
| `Trilium: Open Today's Journal Note` | Open the Trilium journal entry for today (toolbar button). |
| `Trilium: Open in Browser` | Open the note in VS Code's Simple Browser. |
| `Trilium: Open in External Browser` | Open the note in the system browser. |
| `Trilium: Download File` | Download a file/image note to disk. |

---

## Known Limitations

- **Protected notes** are not currently supported (ETAPI requires the note to be unlocked first). Attempting to open a protected note shows a warning — unlock the note in Trilium first (**Options → Protected Session**).
- Only the plain-text content of notes is synced; attributes (labels and relations) are shown read-only in the Attributes sidebar.
- Canvas (Excalidraw) notes are opened as raw JSON. Install the [Excalidraw VS Code extension](https://marketplace.visualstudio.com/items?itemName=pomdtr.excalidraw-editor) for a visual editor.
- Mind map notes are converted to/from a Markdown heading hierarchy; MindElixir node properties (colors, styles, layout direction) are not preserved on round-trip.
- ALT+click to open externally is not supported due to VS Code tree API limitations; use the right-click **Open in External Browser** menu item instead.

---

## License

GNU General Public License v2.0 — see [LICENSE](LICENSE) for the full text.
