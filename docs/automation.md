# Automation

Programmatic note creation/import is available through regular VS Code commands.

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

## Maintainer Note

The Trilium plugin-ref update workflow can surface upstream CKEditor plugin drift, especially around package import paths and TypeScript strictness. When that happens, keep the compatibility fix in the local vendor patch flow at [scripts/apply-vendor-patches.mjs](/Users/skurz/Repos/vscode-trilium-extension/scripts/apply-vendor-patches.mjs) so future ref bumps reuse the same stabilization point after each download.
