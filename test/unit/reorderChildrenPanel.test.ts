import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import { openReorderChildrenPanel } from '../../src/reorderChildrenPanel';
import { NoteItem } from '../../src/noteTreeProvider';
import type { Branch, Note } from '../../src/etapiClient';
import type { EtapiClient } from '../../src/etapiClient';

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    noteId: 'testId',
    title: 'Test Note',
    type: 'text',
    mime: 'text/html',
    isProtected: false,
    blobId: 'blobId',
    childNoteIds: [],
    parentNoteIds: ['root'],
    childBranchIds: [],
    parentBranchIds: [],
    dateCreated: '2024-01-01 00:00:00+0000',
    dateModified: '2024-01-01 00:00:00+0000',
    utcDateCreated: '2024-01-01T00:00:00Z',
    utcDateModified: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('openReorderChildrenPanel', () => {
  let originalCreateWebviewPanel: unknown;
  let originalShowInformationMessage: unknown;
  let originalShowErrorMessage: unknown;
  let originalViewColumn: unknown;

  beforeEach(() => {
    originalCreateWebviewPanel = (vscode.window as any).createWebviewPanel;
    originalShowInformationMessage = vscode.window.showInformationMessage;
    originalShowErrorMessage = vscode.window.showErrorMessage;
    originalViewColumn = (vscode as any).ViewColumn;

    (vscode as any).ViewColumn = { Beside: 2 };
  });

  afterEach(() => {
    (vscode.window as any).createWebviewPanel = originalCreateWebviewPanel;
    (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    (vscode as any).ViewColumn = originalViewColumn;
  });

  it('shows an info message and exits when the parent has no children', async () => {
    const messages: string[] = [];
    let createWebviewCalls = 0;
    const parent = makeNote({ noteId: 'parent', title: 'Parent', childNoteIds: [], childBranchIds: [] });
    const client = {
      getNote: async () => parent,
    } as unknown as EtapiClient;

    (vscode.window as any).showInformationMessage = async (message: string) => {
      messages.push(message);
      return undefined;
    };
    (vscode.window as any).createWebviewPanel = () => {
      createWebviewCalls += 1;
      return {};
    };

    await openReorderChildrenPanel(
      { subscriptions: [] } as unknown as vscode.ExtensionContext,
      client,
      new NoteItem(parent, 'root/parent', 'branch-parent'),
      () => undefined,
    );

    assert.strictEqual(createWebviewCalls, 0);
    assert.strictEqual(messages.length, 1);
    assert.ok(messages[0]?.includes('has no child notes to reorder'));
  });

  it('rejects invalid reorder payload length', async () => {
    let receiveMessage: ((message: { type: string; orderedNoteIds?: string[] }) => void | Promise<void>) | undefined;
    const errors: string[] = [];
    const parent = makeNote({
      noteId: 'parent',
      title: 'Parent',
      childNoteIds: ['c1', 'c2'],
      childBranchIds: ['b1', 'b2'],
    });
    const children = new Map<string, Note>([
      ['parent', parent],
      ['c1', makeNote({ noteId: 'c1', title: 'Child 1' })],
      ['c2', makeNote({ noteId: 'c2', title: 'Child 2' })],
    ]);
    const client = {
      getNote: async (noteId: string) => {
        const note = children.get(noteId);
        if (!note) {
          throw new Error(`Missing note ${noteId}`);
        }
        return note;
      },
      patchBranch: async (_branchId: string, _patch: Partial<Branch>) => undefined,
      refreshNoteOrdering: async (_parentNoteId: string) => undefined,
    } as unknown as EtapiClient;

    (vscode.window as any).showErrorMessage = async (message: string) => {
      errors.push(message);
      return undefined;
    };
    (vscode.window as any).createWebviewPanel = () => ({
      webview: {
        cspSource: 'csp',
        html: '',
        onDidReceiveMessage: (handler: typeof receiveMessage) => {
          receiveMessage = handler;
          return { dispose: () => undefined };
        },
      },
      onDidDispose: () => ({ dispose: () => undefined }),
      dispose: () => undefined,
    });

    await openReorderChildrenPanel(
      { subscriptions: [] } as unknown as vscode.ExtensionContext,
      client,
      new NoteItem(parent, 'root/parent', 'branch-parent'),
      () => undefined,
    );
    await receiveMessage?.({ type: 'save', orderedNoteIds: ['c1'] });

    assert.deepStrictEqual(errors, ['Trilium: Invalid reorder payload.']);
  });

  it('rejects invalid reorder selections', async () => {
    let receiveMessage: ((message: { type: string; orderedNoteIds?: string[] }) => void | Promise<void>) | undefined;
    const errors: string[] = [];
    const parent = makeNote({
      noteId: 'parent',
      title: 'Parent',
      childNoteIds: ['c1', 'c2'],
      childBranchIds: ['b1', 'b2'],
    });
    const children = new Map<string, Note>([
      ['parent', parent],
      ['c1', makeNote({ noteId: 'c1', title: 'Child 1' })],
      ['c2', makeNote({ noteId: 'c2', title: 'Child 2' })],
    ]);
    const client = {
      getNote: async (noteId: string) => {
        const note = children.get(noteId);
        if (!note) {
          throw new Error(`Missing note ${noteId}`);
        }
        return note;
      },
      patchBranch: async (_branchId: string, _patch: Partial<Branch>) => undefined,
      refreshNoteOrdering: async (_parentNoteId: string) => undefined,
    } as unknown as EtapiClient;

    (vscode.window as any).showErrorMessage = async (message: string) => {
      errors.push(message);
      return undefined;
    };
    (vscode.window as any).createWebviewPanel = () => ({
      webview: {
        cspSource: 'csp',
        html: '',
        onDidReceiveMessage: (handler: typeof receiveMessage) => {
          receiveMessage = handler;
          return { dispose: () => undefined };
        },
      },
      onDidDispose: () => ({ dispose: () => undefined }),
      dispose: () => undefined,
    });

    await openReorderChildrenPanel(
      { subscriptions: [] } as unknown as vscode.ExtensionContext,
      client,
      new NoteItem(parent, 'root/parent', 'branch-parent'),
      () => undefined,
    );
    await receiveMessage?.({ type: 'save', orderedNoteIds: ['c1', 'missing'] });

    assert.deepStrictEqual(errors, ['Trilium: Invalid reorder selection.']);
  });

  it('patches branch order and refreshes the parent on valid save', async () => {
    let receiveMessage: ((message: { type: string; orderedNoteIds?: string[] }) => void | Promise<void>) | undefined;
    let disposeCalls = 0;
    let onAppliedCalls = 0;
    const infoMessages: string[] = [];
    const branchPatches: Array<{ branchId: string; notePosition: number | undefined }> = [];
    const refreshCalls: string[] = [];
    const parent = makeNote({
      noteId: 'parent',
      title: 'Parent',
      childNoteIds: ['c1', 'c2'],
      childBranchIds: ['b1', 'b2'],
    });
    const children = new Map<string, Note>([
      ['parent', parent],
      ['c1', makeNote({ noteId: 'c1', title: 'Child 1' })],
      ['c2', makeNote({ noteId: 'c2', title: 'Child 2' })],
    ]);
    const client = {
      getNote: async (noteId: string) => {
        const note = children.get(noteId);
        if (!note) {
          throw new Error(`Missing note ${noteId}`);
        }
        return note;
      },
      patchBranch: async (branchId: string, patch: Partial<Branch>) => {
        branchPatches.push({ branchId, notePosition: patch.notePosition });
      },
      refreshNoteOrdering: async (parentNoteId: string) => {
        refreshCalls.push(parentNoteId);
      },
    } as unknown as EtapiClient;

    (vscode.window as any).showInformationMessage = async (message: string) => {
      infoMessages.push(message);
      return undefined;
    };
    (vscode.window as any).showErrorMessage = async () => undefined;
    (vscode.window as any).createWebviewPanel = () => ({
      webview: {
        cspSource: 'csp',
        html: '',
        onDidReceiveMessage: (handler: typeof receiveMessage) => {
          receiveMessage = handler;
          return { dispose: () => undefined };
        },
      },
      onDidDispose: () => ({ dispose: () => undefined }),
      dispose: () => {
        disposeCalls += 1;
      },
    });

    await openReorderChildrenPanel(
      { subscriptions: [] } as unknown as vscode.ExtensionContext,
      client,
      new NoteItem(parent, 'root/parent', 'branch-parent'),
      () => {
        onAppliedCalls += 1;
      },
    );
    await receiveMessage?.({ type: 'save', orderedNoteIds: ['c2', 'c1'] });

    assert.deepStrictEqual(branchPatches, [
      { branchId: 'b2', notePosition: 10 },
      { branchId: 'b1', notePosition: 20 },
    ]);
    assert.deepStrictEqual(refreshCalls, ['parent']);
    assert.strictEqual(onAppliedCalls, 1);
    assert.strictEqual(disposeCalls, 1);
    assert.strictEqual(infoMessages.length, 1);
    assert.ok(infoMessages[0]?.includes('Saved child order'));
  });
});
