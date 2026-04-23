# Automation

## GitHub Copilot Chat

The extension registers five Language Model Tools that Copilot Chat discovers automatically. Once the extension is connected, you can ask Copilot to search, read, create, or import notes directly.

Example prompts:

> *"Create a Trilium note called 'Meeting Notes' with today's agenda."*
> *"Add a project documentation tree to Trilium with an overview page, a Mermaid architecture diagram, and three API reference pages."*
> *"Search my Trilium notes for anything about Kubernetes."*
> *"What does my 'Project Overview' note say?"*
> *"List the children of the root note."*

### Available Tools

| Tool | Description |
| --- | --- |
| `trilium_createNote` | Create a single note of type text, code, mermaid, or canvas. |
| `trilium_importNotes` | Recursively create an entire note hierarchy from a JSON spec. |
| `trilium_searchNotes` | Full-text search that returns note ID, title, type, and parent for each match. |
| `trilium_readNote` | Read a note's content by note ID with HTML stripped to plain text. |
| `trilium_listChildren` | List the direct children of a note by note ID. |

### Content Format Guidelines

| Note type | Content format |
| --- | --- |
| `text` | CKEditor HTML, for example `<h2>Title</h2><p>Body</p>` |
| `code` | Raw source code with a `mime`, for example `text/javascript` |
| `mermaid` | Mermaid diagram syntax only, with no code fences |
| `canvas` | Excalidraw JSON string, for example `{"type":"excalidraw","version":2,"elements":[],"appState":{}}` |

## Programmatic Commands

Two commands can also be invoked via `vscode.commands.executeCommand` from any VS Code extension or automation script.

### `trilium.createNoteWithContent`

Create a single note programmatically without any UI.

```typescript
const result = await vscode.commands.executeCommand(
  'trilium.createNoteWithContent',
  'root',
  'My Note',
  'text',
  '<p>Hello</p>',
  undefined,
);
// result: { noteId: string }
```

### `trilium.importNotes`

Create an entire documentation hierarchy recursively from a JSON array.

```typescript
const result = await vscode.commands.executeCommand(
  'trilium.importNotes',
  'root',
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

### `NoteImportSpec` schema

```typescript
interface NoteImportSpec {
  title: string;
  type?: 'text' | 'code' | 'mermaid' | 'canvas';
  mime?: string;
  content?: string;
  children?: NoteImportSpec[];
}
```

When using the programmatic `trilium.importNotes` command, you can ask Copilot to generate the JSON spec for you and then pass it directly into the command.
