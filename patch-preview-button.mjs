import fs from 'fs';

let ext = fs.readFileSync('src/extension.ts', 'utf8');

const contextUpdateFn = `
  const updateActiveNoteContext = () => {
    const activeId = getActiveNoteId(tempFileManager);
    if (activeId && tempFileManager.isMindMapNote(activeId)) {
      void vscode.commands.executeCommand('setContext', 'trilium.activeNoteType', 'mindMap');
    } else {
      void vscode.commands.executeCommand('setContext', 'trilium.activeNoteType', '');
    }
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateActiveNoteContext));
  updateActiveNoteContext();

  context.subscriptions.push(
`;
ext = ext.replace("  context.subscriptions.push(\n    triliumChatParticipant,", contextUpdateFn + "    triliumChatParticipant,");
fs.writeFileSync('src/extension.ts', ext);

let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

// find existing editor/title commands in menus
const editorTitle = pkg.contributes.menus["editor/title"] || [];
editorTitle.push({
  command: "trilium.previewMindMap",
  when: "trilium.activeNoteType == 'mindMap'",
  group: "navigation@10"
});

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + "\n");
console.log('patched');
