import { Attribute, EtapiClient, Note } from './etapiClient';
import { noteTypeToLabel } from './noteTreeProvider';

export interface TriliumNoteContextChild {
  noteId: string;
  title: string;
  type: Note['type'];
}

export interface TriliumNoteContext {
  note: Note;
  pathTitles: string[];
  pathNoteIds: string[];
  children: TriliumNoteContextChild[];
  hasMoreChildren: boolean;
}

export function stripHtmlForLm(raw: string): string {
  return raw
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function buildAncestorChain(client: EtapiClient, noteId: string): Promise<Note[]> {
  const chain: Note[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = noteId;

  while (currentId) {
    if (visited.has(currentId)) {
      throw new Error(`Cycle detected while resolving Trilium path for note ${noteId}`);
    }

    visited.add(currentId);
    const note = await client.getNote(currentId);
    chain.unshift(note);
    currentId = note.parentNoteIds[0];
  }

  return chain;
}

export async function buildNoteContext(
  client: EtapiClient,
  noteId: string,
  childLimit = 12,
): Promise<TriliumNoteContext> {
  const chain = await buildAncestorChain(client, noteId);
  const note = chain[chain.length - 1];
  if (!note) {
    throw new Error(`Note ${noteId} was not found`);
  }

  const childIds = note.childNoteIds.slice(0, Math.max(0, childLimit));
  const children = await Promise.all(childIds.map(async (childId) => {
    const child = await client.getNote(childId);
    return {
      noteId: child.noteId,
      title: child.title,
      type: child.type,
    } satisfies TriliumNoteContextChild;
  }));

  return {
    note,
    pathTitles: chain.map((entry) => entry.title),
    pathNoteIds: chain.map((entry) => entry.noteId),
    children,
    hasMoreChildren: note.childNoteIds.length > childIds.length,
  };
}

function formatAttributes(attributes: Attribute[] | undefined): string {
  if (!attributes || attributes.length === 0) {
    return '- none';
  }

  return attributes
    .map((attribute) => {
      const inheritable = attribute.isInheritable ? ' (inheritable)' : '';
      const value = attribute.value ? ` = ${attribute.value}` : '';
      return `- ${attribute.type}:${attribute.name}${value}${inheritable}`;
    })
    .join('\n');
}

function formatChildren(context: TriliumNoteContext): string {
  if (context.children.length === 0) {
    return '- none';
  }

  const rows = context.children.map((child) =>
    `- noteId: ${child.noteId} | title: "${child.title}" | type: ${noteTypeToLabel(child.type)}`,
  );
  if (context.hasMoreChildren) {
    rows.push(`- ... ${context.note.childNoteIds.length - context.children.length} more child note(s)`);
  }
  return rows.join('\n');
}

export function formatNoteContextForLm(context: TriliumNoteContext): string {
  return [
    `Title: ${context.note.title}`,
    `Note ID: ${context.note.noteId}`,
    `Type: ${context.note.type}`,
    `Path: ${context.pathTitles.join(' / ')}`,
    `Path Note IDs: ${context.pathNoteIds.join(' / ')}`,
    `Protected: ${context.note.isProtected ? 'yes' : 'no'}`,
    '',
    'Attributes:',
    formatAttributes(context.note.attributes),
    '',
    `Direct Children (${context.note.childNoteIds.length} total):`,
    formatChildren(context),
  ].join('\n');
}
