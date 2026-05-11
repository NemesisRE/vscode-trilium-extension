# Automation

## GitHub Copilot Chat

The extension registers nine Language Model Tools that Copilot Chat discovers automatically. Once the extension is connected, you can ask Copilot to search, inspect context, stage drafts, read, create, import, replace, or append note content directly.

For more deterministic note-authoring workflows, the extension also contributes an `@trilium` chat participant. This participant is meant for requests where Copilot should inspect your existing Trilium subtree, gather enough local context, and then stage one note or a note tree as new Trilium child-note drafts.

Example prompts:

> *"Create a Trilium note called 'Meeting Notes' with today's agenda."*
> *"Add a project documentation tree to Trilium with an overview page, a Mermaid architecture diagram, and three API reference pages."*
> *"Search my Trilium notes for anything about Kubernetes."*
> *"What does my 'Project Overview' note say?"*
> *"List the children of the root note."*
> *"Rewrite note abc123 with this updated section."*
> *"Append today's meeting summary to note abc123."*

### `@trilium` Participant

Use `@trilium` when you want Copilot to behave like a Trilium-aware documentation assistant instead of only opportunistically calling tools.

### How To: Create Documentation Drafts With Copilot

1. Connect the extension to your Trilium server.
2. Select the destination section in the Trilium tree. For example, select `Homelab` if the new documentation should be created somewhere inside the `Homelab` subtree.
3. Open Copilot Chat and ask `@trilium` for the documentation you want.
4. The participant will inspect nearby notes for context, then create new child notes in Trilium as draft tabs.
5. Review and edit those draft tabs locally.
6. Run `Trilium: Confirm Draft Notes` to save the generated content to Trilium, or `Trilium: Discard Draft Notes` to remove the staged draft notes.

This workflow is designed so the target section acts as the subtree boundary. New documentation is staged somewhere below that section in the tree instead of being appended directly into the section note. Copilot can place notes directly under the targeted section or inside deeper subsections when that produces a clearer structure, and those staged notes can also have their own child notes.

Example prompts:

> *"@trilium Write documentation on how to build a local AI and add it to my Homelab section."*
> *"@trilium /document Use my existing homelab notes to create a cleaner local-LLM guide under the current section."*

Behavior:

- If you have a note selected in the Trilium tree, `@trilium` treats that note as the default destination scope unless your prompt clearly points somewhere else.
- The participant inspects the destination note context first, including ancestor path and child-note summary.
- It then uses the normal Trilium LM tools to read related notes, synthesize content, and create new child-note drafts somewhere inside that section's subtree instead of editing the section note directly.
- The generated structure can be flat or nested. If a deeper subsection or a note with its own children makes more sense, Copilot can stage that structure below the targeted section.
- Draft notes are created in Trilium immediately, but their generated content stays local and dirty in the editor until you explicitly confirm the draft session.
- Use `Trilium: Confirm Draft Notes` to save the staged draft content to Trilium, or `Trilium: Discard Draft Notes` to delete the staged child notes.
- Requests for “online information” still depend on Copilot's grounding/web capabilities in your VS Code environment. The participant does not add a separate external search provider.
- This is most useful for turning rough knowledge-base areas into cleaner documentation trees without committing the generated content immediately.

### Available Tools

| Tool | Description |
| --- | --- |
| `trilium_createNote` | Create a single note of type text, code, mermaid, or canvas. |
| `trilium_importNotes` | Recursively create an entire note hierarchy from a JSON spec. |
| `trilium_stageDraftNotes` | Create new Trilium child notes as locally dirty draft tabs that require explicit confirmation before their content is saved. |
| `trilium_searchNotes` | Full-text search that returns note ID, title, type, full path, and parent note ID for each match. |
| `trilium_getNoteContext` | Return a note's full ancestor path, attributes, and direct-child summary. |
| `trilium_readNote` | Read a note's content by note ID with HTML stripped to plain text. |
| `trilium_listChildren` | List the direct children of a note by note ID. |
| `trilium_updateNoteContent` | Replace the full content of an existing note by note ID. |
| `trilium_appendToNote` | Append content to an existing note, with an optional separator. |

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

## Maintainer Note

The Trilium plugin-ref update workflow can surface upstream CKEditor plugin drift, especially around package import paths and TypeScript strictness. When that happens, keep the compatibility fix in the local vendor patch flow at [scripts/apply-vendor-patches.mjs](/Users/skurz/Repos/vscode-trilium-extension/scripts/apply-vendor-patches.mjs) so future ref bumps reuse the same stabilization point after each download.
