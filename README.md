# Trilium Notes for VS Code

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![VS Code Engine](https://img.shields.io/badge/VS%20Code-%5E1.116.0-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![CI](https://github.com/NemesisRE/vscode-trilium-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/NemesisRE/vscode-trilium-extension/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/NemesisRE/vscode-trilium-extension?style=flat&logo=github&label=release)](https://github.com/NemesisRE/vscode-trilium-extension/releases/latest)
[![GitHub Downloads](https://img.shields.io/github/downloads/NemesisRE/vscode-trilium-extension/total?style=flat&logo=github&label=downloads)](https://github.com/NemesisRE/vscode-trilium-extension/releases)
[![GitHub Stars](https://img.shields.io/github/stars/NemesisRE/vscode-trilium-extension?style=flat&logo=github)](https://github.com/NemesisRE/vscode-trilium-extension/stargazers)

Browse, search, and edit your [Trilium Notes](https://github.com/TriliumNext/trilium-notes) directly inside VS Code using the [ETAPI REST API](https://triliumnotes.org/api).

---

> [!NOTE]
> **This extension is vibe-coded.** It was built with heavy AI assistance — but a lot of deliberate thought, design decisions, and real-world testing went into every feature. Architecture choices were made consciously, edge cases were considered, and the code was reviewed and refined rather than blindly accepted. "Vibe-coded" here means the process was fluid and AI-assisted, not that quality was an afterthought.

---

## Features

### Note Tree

- Browse your entire Trilium note hierarchy in the VS Code Activity Bar sidebar.
- Notes with children can be expanded; leaf notes open on single click.
- Note type is shown as a description badge (e.g. `code`, `mermaid`, `canvas`).
- Note icons are resolved from the `#iconClass` label attribute (Boxicons class name → VS Code Codicon). Each note type has a sensible default icon when no attribute is set.
- Note colors are driven by the `#color` label attribute and are shown as tree item color decorations.

### Open & Edit Notes

- **Text notes** — opened in a full **CKEditor 5 WYSIWYG** editor embedded in a VS Code webview. The editor operates directly on Trilium's native HTML — no Markdown conversion. Native VS Code undo/redo and `Ctrl+S` save are fully supported. The editor includes Trilium's custom CKEditor plugins and toolbar:
  - Headings (H2–H6), font size
  - Bold, italic, underline, strikethrough, superscript, subscript
  - Font colour, background colour, remove formatting
  - Bulleted list, numbered list, to-do list (with list style options, start index, reversed)
  - Block quote, table (with column/row controls, cell properties, table properties, caption)
  - Inline code, code block
  - **Math equations** (KaTeX) — insert inline or block LaTeX formulas
  - **Mermaid diagrams** — insert inline flowcharts, sequence diagrams, and more
  - **Admonitions** (callouts) — styled note/tip/warning/danger blocks
  - **Footnotes** — inline references with automatic footnote numbering
  - **Keyboard markers** — visual `<kbd>` tags for keyboard shortcuts
  - Insert menu: link, bookmark, image upload, media embed, special characters, horizontal line, page break
  - Text alignment (left, centre, right, justify), indent / outdent
  - Find & replace
  - Undo / redo
- **Code notes** — opened with the correct language (Python, JavaScript, TypeScript, SQL, …). Changes saved directly.
- **Mermaid notes** — opened as `.mmd`. Rendered visually if the [Mermaid Preview](https://marketplace.visualstudio.com/items?itemName=vstirbu.vscode-mermaid-preview) or [Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid) extension is installed.
- **Canvas notes** — opened as `.excalidraw` JSON. Rendered visually if the [Excalidraw](https://marketplace.visualstudio.com/items?itemName=pomdtr.excalidraw-editor) extension is installed.
- **Mind Map notes** — the MindElixir JSON is converted to a Markdown heading hierarchy and opened as `.md`. Changes are converted back to MindElixir JSON and saved to Trilium on file save. Install the [Markdown MindMap](https://marketplace.visualstudio.com/items?itemName=MindElixir.mark-elixir) extension to render the file as a visual mind map.

A **breadcrumb bar** above the CKEditor content area shows the full parent path of the open note (e.g. `Root › Projects › My Project`), updated automatically when the note loads.

### Theme Integration

The CKEditor webview automatically follows the active VS Code theme (light, dark, or high-contrast) — no manual configuration required. All editor colours are mapped from VS Code's CSS variables to CKEditor's CSS variables at runtime.

### Open as… (Fallback Formats)

Right-click any **text** note and choose **Open as…** for alternative views:

- **Open as Markdown** — converts the note's HTML to Markdown and opens it in VS Code's text editor. Saving converts back to HTML and syncs to Trilium. Useful as a plain-text fallback.
- **Open as HTML** — opens the raw CKEditor HTML without any conversion. Read-only view; saving to this file does **not** sync back to Trilium. Useful for inspecting complex markup.

### Open in Browser

Right-click any note and choose:

- **Open in Browser** — opens the note in VS Code's built-in Simple Browser. Falls back to the system browser if Simple Browser is not available.
- **Open in External Browser** — opens the note directly in your default system browser with the full note path (`#root/…/noteId`).

### Download File / Image Notes

Right-click a **file** or **image** note and choose **Download File** to save the binary content locally via a save-file dialog.

### Create Notes

- Click the **+** button in the panel toolbar to quickly create a new text note under the root.
- Click the **Import Notes** button in the toolbar to bulk-import a JSON tree.
- Right-click any note and choose **New Note…** to open a submenu with five note-type options:
  - **New Text Note** — rich text (WYSIWYG CKEditor, HTML stored in Trilium)
  - **New Code Note** — choose language from a QuickPick list
  - **New Mermaid Diagram** — opens as `.mmd` with a starter `graph TD` diagram
  - **New Canvas (Excalidraw)** — opens as `.excalidraw` JSON
  - **New Mind Map Note** — opens as `.md` (Markdown heading hierarchy)
- Right-click on empty space in the panel to create a new note at the root level.

### Rename Notes

Right-click any note and choose **Rename Note**, or press **F2** while the tree has focus.

### Delete Notes

Right-click any note and choose **Delete Note**. A confirmation dialog is shown before deletion. If the note is currently open in an editor, the editor tab is closed automatically.

### Today's Journal Note

Click the **calendar** button in the panel toolbar (or run **Trilium: Open Today's Journal Note** from the Command Palette) to open the Trilium journal entry for today. Trilium creates the note automatically if it does not exist yet.

### Attributes & Attachments Sidebar

Select any note in the tree to see its **labels**, **relations**, and **attachments** in the **Attributes** panel below the note tree. When connected, everything is fully editable:

- Label values are displayed as inline text fields — click to edit, press **Enter** or click away to save, press **Escape** to cancel.
- Each attribute has a **×** delete button.
- **+ Add Label** and **+ Add Relation** buttons create new attributes.
- The **Attachments** section lists all file attachments on the note, with their name and size.
  - Click **⬇** to download an attachment to disk via a save dialog.
  - Click **×** to permanently delete an attachment (no confirmation).
  - Click **＋ Upload file…** to upload any local file as a new attachment (binary files are base64-encoded automatically).

### Revision History

Right-click any note and choose **Show Note Revisions…** to see all saved revisions, most recent first. For each revision you can:

- Click the **(→)** button or press Enter to open the revision in a read-only tab.
- Click the **(⊟)** button to open a diff view comparing the revision against the current note content.

### Clone & Move Notes

Right-click any note in the tree for these placement commands:

- **Clone Note…** — places the note in a second location in the tree (Trilium's linked-note model). A live-search picker lets you choose the destination parent.
- **Move Note…** — moves the note to a new parent by creating the new branch and deleting the old one. Moving is blocked if the note has only one location (which would effectively delete it); use Clone in that case.

### Export Subtree

Right-click any note and choose **Export Subtree…** to export the note and all its descendants as a ZIP archive. Two formats are available:

- **HTML ZIP** — full HTML export with embedded assets.
- **Markdown ZIP** — plain-text Markdown export.

---

## AI / Programmatic Note Creation

### GitHub Copilot Chat (automatic)

The extension registers **five Language Model Tools** that Copilot Chat discovers automatically. No setup required — just ask Copilot while the extension is connected:

> *"Create a Trilium note called 'Meeting Notes' with today's agenda."*
> *"Add a project documentation tree to Trilium with an overview page, a Mermaid architecture diagram, and three API reference pages."*
> *"Search my Trilium notes for anything about Kubernetes."*
> *"What does my 'Project Overview' note say?"*
> *"List the children of the root note."*

Copilot will invoke the appropriate tool directly and confirm before making changes.

#### Available tools

| Tool | Description |
| --- | --- |
| `trilium_createNote` | Create a single note (text, code, mermaid, canvas). |
| `trilium_importNotes` | Recursively create an entire note hierarchy from a JSON spec. |
| `trilium_searchNotes` | Full-text search — returns noteId, title, type, and parent for each match. |
| `trilium_readNote` | Read a note's content by noteId (HTML stripped to plain text). |
| `trilium_listChildren` | List the direct children of any note by noteId. |

#### Content format guidelines

| Note type | Content format |
| --- | --- |
| `text` | CKEditor HTML — e.g. `<h2>Title</h2><p>Body</p>` |
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
      content: '<h2>Project Docs</h2><p>Overview...</p>',
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
5. Your note tree will appear. Click any text note to open it in the WYSIWYG editor.

---

## Extension Settings

All settings are under the `trilium` namespace and can be changed in **Settings** (`Ctrl+,`).

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `trilium.serverUrl` | `string` | `http://localhost:8080` | URL of your Trilium Notes server. |
| `trilium.rootNoteId` | `string` | `root` | Root note ID for the tree view. Change to scope the tree to a subtree. |
| `trilium.editor.fontSize` | `number` (8–32) | `14` | Font size in pixels for the CKEditor content area. |
| `trilium.editor.spellcheck` | `boolean` | `false` | Enable the browser's built-in spellcheck in the CKEditor content area. |

> The ETAPI token is stored securely in VS Code's `SecretStorage` (system keychain) and is never written to settings files.

---

## Commands

All commands are available via the Command Palette (`Ctrl+Shift+P`) under the **Trilium** category.

| Command | Description |
| --- | --- |
| `Trilium: Connect to Trilium Server` | Enter server URL and ETAPI token. |
| `Trilium: Refresh` | Reload the note tree from the server. |
| `Trilium: Open Note` | Open a text/code/mermaid/canvas/mind-map note in the editor. |
| `Trilium: Open as Markdown` | Open a text note converted to Markdown in the text editor (saves back as HTML). |
| `Trilium: Open as HTML` | Open a text note's raw HTML in the editor (read-only view, no sync on save). |
| `Trilium: New Note` | Quick-create a text note (toolbar button). |
| `Trilium: New Text Note` | Create a text note under the selected item (right-click submenu). |
| `Trilium: New Code Note` | Create a code note — choose language from a list. |
| `Trilium: New Mermaid Diagram` | Create a Mermaid diagram note with a starter template. |
| `Trilium: New Canvas (Excalidraw)` | Create an Excalidraw canvas note. |
| `Trilium: New Mind Map Note` | Create a Mind Map note (edited as Markdown heading hierarchy, saved as MindElixir JSON). |
| `Trilium: Import Notes from JSON` | Bulk-import a JSON tree of notes (toolbar button or programmatic). |
| `Trilium: Rename Note` | Rename the selected note (also **F2**). |
| `Trilium: Delete Note` | Delete the selected note (confirmation required). |
| `Trilium: Open Today's Journal Note` | Open the Trilium journal entry for today (toolbar button). |
| `Trilium: Open Calendar Note…` | QuickPick to open today's, inbox, this week's, this month's, or this year's note. |
| `Trilium: Open Inbox Note` | Open the Trilium inbox note for today. |
| `Trilium: Open This Week's Note` | Open the calendar note for the current ISO week. |
| `Trilium: Open This Month's Note` | Open the calendar note for the current month. |
| `Trilium: Open This Year's Note` | Open the calendar note for the current year. |
| `Trilium: Search Notes…` | Live full-text search with debounced QuickPick — opens selected note. |
| `Trilium: Filter Tree…` | Filter the note tree by keyword (server search, flat results). |
| `Trilium: Clear Tree Filter` | Reset the tree to its normal hierarchical view. |
| `Trilium: Copy Note ID` | Copy the selected note's ID to the clipboard (right-click). |
| `Trilium: Copy Trilium URL` | Copy the selected note's full Trilium URL to the clipboard (right-click). |
| `Trilium: Open in Browser` | Open the note in VS Code's Simple Browser. |
| `Trilium: Open in External Browser` | Open the note in the system browser. |
| `Trilium: Download File` | Download a file/image note to disk. |
| `Trilium: Show Note Revisions…` | Show saved revision history for a note — open read-only or diff against current. |
| `Trilium: Clone Note…` | Clone a note to a second location (live-search destination picker). |
| `Trilium: Move Note…` | Move a note to a new parent (blocked if it's the only location). |
| `Trilium: Export Subtree…` | Export a note and all its descendants as an HTML or Markdown ZIP. |

---

## Known Limitations

- **Protected notes** are not supported — ETAPI requires the note to be unlocked first. Attempting to open a protected note shows a warning; unlock it in Trilium first (**Options → Protected Session**).
- **Canvas notes** are opened as raw JSON. Install the [Excalidraw VS Code extension](https://marketplace.visualstudio.com/items?itemName=pomdtr.excalidraw-editor) for a visual editor.
- **Mind map notes** are converted to/from a Markdown heading hierarchy. MindElixir node properties (colours, styles, layout direction) are not preserved on round-trip.
- **Image upload** in the WYSIWYG editor requires a server-side upload handler; images cannot be uploaded to Trilium directly from the editor toolbar in the current version. Use the Attachments section in the sidebar to attach images as note attachments instead.
- ALT+click to open externally is not supported due to VS Code tree API limitations; use the right-click **Open in External Browser** menu item instead.
- Desktop only — web extensions and Codespaces are not supported.

---

## Credits

The extension icon (`media/trilium.svg`) is the original Trilium Notes logo, taken from the [Trilium Notes](https://github.com/TriliumNext/trilium-notes) project by the [TriliumNext](https://github.com/TriliumNext) organization, used under the [GNU Affero General Public License v3.0](https://github.com/TriliumNext/trilium-notes/blob/master/LICENSE).

**CKEditor plugins** — The extension incorporates five custom CKEditor 5 plugins from the Trilium Notes project, downloaded and vendored during the build process:

- **Math** — KaTeX LaTeX formula rendering
- **Mermaid** — inline diagram syntax support  
- **Admonitions** — styled callout blocks
- **Footnotes** — inline reference management
- **Keyboard Marker** — visual `<kbd>` tags

These plugins are sourced from [TriliumNext/Trilium](https://github.com/TriliumNext/Trilium) and are licensed under AGPL-3.0.

---

## License

GNU Affero General Public License v3.0 or later — see [LICENSE](LICENSE) for the full text.

This extension incorporates source code from [Trilium Notes](https://github.com/TriliumNext/Trilium), which is licensed under AGPL-3.0. Accordingly, this extension is also distributed under AGPL-3.0-or-later.
