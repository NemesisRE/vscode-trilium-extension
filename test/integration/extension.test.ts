/**
 * Integration test suite — runs inside a real VS Code extension host.
 *
 * These tests verify that the extension activates correctly and that all
 * commands declared in package.json are actually registered at runtime.
 * They do NOT require a live Trilium server.
 */

import { strict as assert } from 'assert';
import * as vscode from 'vscode';

// The extension id comes from publisher + name in package.json.
const EXTENSION_ID = 'NemesisRE.trilium-notes';

// All commands declared under contributes.commands in package.json.
const EXPECTED_COMMANDS = [
  'trilium.refresh',
  'trilium.connect',
  'trilium.createNote',
  'trilium.createNoteText',
  'trilium.createNoteCode',
  'trilium.createNoteMermaid',
  'trilium.createNoteCanvas',
  'trilium.createNoteMindMap',
  'trilium.openTodayNote',
  'trilium.openInBrowser',
  'trilium.openInBrowserExternal',
  'trilium.downloadFile',
  'trilium.renameNote',
  'trilium.deleteNote',
  'trilium.openNote',
  'trilium.openNoteAsMarkdown',
  'trilium.openNoteAsHtml',
  'trilium.searchNotes',
  'trilium.filterTree',
  'trilium.clearTreeFilter',
  'trilium.copyNoteId',
  'trilium.showRevisions',
  'trilium.cloneNote',
  'trilium.moveNote',
  'trilium.exportSubtree',
];

suite('Extension activation', () => {
  let extension: vscode.Extension<unknown>;

  suiteSetup(async () => {
    extension = vscode.extensions.getExtension(EXTENSION_ID)!;
    assert.ok(extension, `Extension "${EXTENSION_ID}" not found`);
    // Activate if not already active (the test runner may have done so).
    if (!extension.isActive) {
      await extension.activate();
    }
  });

  test('extension is active', () => {
    assert.ok(extension.isActive, 'Extension should be active after activation');
  });

  test('all expected commands are registered', async () => {
    const registered = await vscode.commands.getCommands(true);
    const registeredSet = new Set(registered);
    const missing = EXPECTED_COMMANDS.filter(cmd => !registeredSet.has(cmd));
    assert.deepEqual(
      missing,
      [],
      `Missing commands: ${missing.join(', ')}`,
    );
  });
});
