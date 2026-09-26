import { strict as assert } from 'assert';
import { EtapiClient, EtapiError } from '../../src/etapiClient';

// Store the real global fetch so we can restore it after each test.
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(status: number, body: unknown, ok = status >= 200 && status < 300): void {
  globalThis.fetch = async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const isJson = typeof body === 'object' && body !== null;
    return {
      ok,
      status,
      json: async () => body,
      text: async () => (isJson ? JSON.stringify(body) : String(body)),
    } as Response;
  };
}

type FetchCapture = { url: string; init?: RequestInit };

function capturingFetch(status: number, body: unknown): FetchCapture {
  const capture: FetchCapture = { url: '' };
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capture.url = url.toString();
    capture.init = init;
    const isJson = typeof body === 'object' && body !== null;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => (isJson ? JSON.stringify(body) : String(body)),
    } as Response;
  };
  return capture;
}

describe('EtapiClient', () => {
  describe('getNote', () => {
    it('sends a GET request with the correct URL and Authorization header', async () => {
      const mockNote = {
        noteId: 'abc123',
        title: 'Hello World',
        type: 'text',
        mime: 'text/html',
        isProtected: false,
        blobId: 'blob1',
        childNoteIds: [],
        parentNoteIds: ['root'],
        childBranchIds: [],
        parentBranchIds: [],
        dateCreated: '2024-01-01 00:00:00+0000',
        dateModified: '2024-01-01 00:00:00+0000',
        utcDateCreated: '2024-01-01T00:00:00Z',
        utcDateModified: '2024-01-01T00:00:00Z',
      };

      const capture = capturingFetch(200, mockNote);

      const client = new EtapiClient('http://localhost:8080', 'mytoken');
      const note = await client.getNote('abc123');

      assert.strictEqual(capture.url, 'http://localhost:8080/etapi/notes/abc123');
      assert.strictEqual(
        (capture.init?.headers as Record<string, string>)?.Authorization,
        'mytoken',
      );
      assert.strictEqual(note.noteId, 'abc123');
      assert.strictEqual(note.title, 'Hello World');
    });

    it('throws EtapiError with status code on a non-ok response', async () => {
      mockFetch(404, 'Not Found', false);

      const client = new EtapiClient('http://localhost:8080', 'mytoken');
      await assert.rejects(
        () => client.getNote('missing'),
        (err: unknown) => {
          assert.ok(err instanceof EtapiError);
          assert.strictEqual(err.statusCode, 404);
          return true;
        },
      );
    });

    it('strips trailing slash from server URL', async () => {
      const capture = capturingFetch(200, { noteId: 'x', title: 'X', type: 'text', mime: '', childNoteIds: [] });

      const client = new EtapiClient('http://localhost:8080/', 'token');
      await client.getNote('x').catch(() => undefined);

      assert.ok(
        capture.url.startsWith('http://localhost:8080/etapi'),
        `URL should not have double slash: ${capture.url}`,
      );
    });
  });

  describe('getNoteContent', () => {
    it('returns the response body as text', async () => {
      globalThis.fetch = async (): Promise<Response> =>
        ({ ok: true, status: 200, text: async () => '<p>content</p>' }) as Response;

      const client = new EtapiClient('http://localhost:8080', 'tok');
      const content = await client.getNoteContent('n1');
      assert.strictEqual(content, '<p>content</p>');
    });

    it('throws EtapiError on failure', async () => {
      mockFetch(403, 'Forbidden', false);

      const client = new EtapiClient('http://localhost:8080', 'tok');
      await assert.rejects(
        () => client.getNoteContent('n1'),
        (err: unknown) => {
          assert.ok(err instanceof EtapiError);
          assert.strictEqual(err.statusCode, 403);
          return true;
        },
      );
    });
  });

  describe('putNoteContent', () => {
    it('sends a PUT request with text/plain content type and Authorization header', async () => {
      const capture = capturingFetch(204, '');

      const client = new EtapiClient('http://localhost:8080', 'mytoken');
      await client.putNoteContent('n1', '<p>updated</p>');

      assert.strictEqual(capture.init?.method, 'PUT');
      assert.strictEqual(
        (capture.init?.headers as Record<string, string>)?.['Content-Type'],
        'text/plain',
      );
      assert.strictEqual(capture.init?.body, '<p>updated</p>');
    });

    it('throws EtapiError when the server rejects the update', async () => {
      mockFetch(403, 'Protected', false);

      const client = new EtapiClient('http://localhost:8080', 'tok');
      await assert.rejects(
        () => client.putNoteContent('n1', 'content'),
        (err: unknown) => err instanceof EtapiError,
      );
    });
  });

  describe('getAppInfo', () => {
    it('returns parsed app info', async () => {
      const info = { appVersion: '1.2.3', dbVersion: 200, utcDateTime: '2024-01-01T00:00:00Z' };
      mockFetch(200, info);

      const client = new EtapiClient('http://localhost:8080', 'tok');
      const result = await client.getAppInfo();
      assert.strictEqual(result.appVersion, '1.2.3');
    });
  });

  describe('createNote', () => {
    it('posts to /etapi/create-note with type and content', async () => {
      const response = { note: { noteId: 'new1', title: 'T', type: 'text', mime: 'text/html', childNoteIds: [] }, branch: {} };
      const capture = capturingFetch(200, response);

      const client = new EtapiClient('http://localhost:8080', 'tok');
      const result = await client.createNote('root', 'T', 'text', 'hello');

      assert.ok(capture.url.endsWith('/create-note'));
      assert.strictEqual(capture.init?.method, 'POST');
      const body = JSON.parse(capture.init?.body as string);
      assert.strictEqual(body.parentNoteId, 'root');
      assert.strictEqual(body.title, 'T');
      assert.strictEqual(body.type, 'text');
      assert.strictEqual(body.content, 'hello');
      assert.strictEqual(result.note.noteId, 'new1');
    });

    it('includes mime in the body when provided', async () => {
      const response = { note: { noteId: 'new2', title: 'Code', type: 'code', mime: 'text/javascript', childNoteIds: [] }, branch: {} };
      const capture = capturingFetch(200, response);

      const client = new EtapiClient('http://localhost:8080', 'tok');
      await client.createNote('root', 'Code', 'code', 'const x = 1;', 'text/javascript');

      const body = JSON.parse(capture.init?.body as string);
      assert.strictEqual(body.mime, 'text/javascript');
    });

    it('does not include mime in the body when not provided', async () => {
      const response = { note: { noteId: 'new3', title: 'M', type: 'mermaid', mime: '', childNoteIds: [] }, branch: {} };
      const capture = capturingFetch(200, response);

      const client = new EtapiClient('http://localhost:8080', 'tok');
      await client.createNote('root', 'M', 'mermaid', 'graph TD\n  A-->B');

      const body = JSON.parse(capture.init?.body as string);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(body, 'mime'), false);
    });
  });

  describe('getDayNote', () => {
    it('sends GET to /etapi/calendar/days/{date} with the given date', async () => {
      const mockNote = {
        noteId: 'day1',
        title: '2025-01-15',
        type: 'text',
        mime: 'text/html',
        isProtected: false,
        blobId: 'blob1',
        childNoteIds: [],
        parentNoteIds: ['month1'],
        childBranchIds: [],
        parentBranchIds: [],
        dateCreated: '2025-01-15 00:00:00+0000',
        dateModified: '2025-01-15 00:00:00+0000',
        utcDateCreated: '2025-01-15T00:00:00Z',
        utcDateModified: '2025-01-15T00:00:00Z',
      };

      const capture = capturingFetch(200, mockNote);

      const client = new EtapiClient('http://localhost:8080', 'mytoken');
      const note = await client.getDayNote('2025-01-15');

      assert.strictEqual(capture.url, 'http://localhost:8080/etapi/calendar/days/2025-01-15');
      assert.strictEqual(capture.init?.method, 'GET');
      assert.strictEqual(
        (capture.init?.headers as Record<string, string>)?.Authorization,
        'mytoken',
      );
      assert.strictEqual(note.noteId, 'day1');
      assert.strictEqual(note.title, '2025-01-15');
    });
  });

  describe('patchNote', () => {
    it('sends PATCH to /etapi/notes/{noteId} with the patch body', async () => {
      const updatedNote = { noteId: 'n1', title: 'New Title', type: 'text', mime: 'text/html', childNoteIds: [] };
      const capture = capturingFetch(200, updatedNote);

      const client = new EtapiClient('http://localhost:8080', 'tok');
      const result = await client.patchNote('n1', { title: 'New Title' });

      assert.ok(capture.url.endsWith('/notes/n1'));
      assert.strictEqual(capture.init?.method, 'PATCH');
      const body = JSON.parse(capture.init?.body as string);
      assert.strictEqual(body.title, 'New Title');
      assert.strictEqual(result.title, 'New Title');
    });

    it('throws EtapiError on failure', async () => {
      mockFetch(404, 'Not Found', false);

      const client = new EtapiClient('http://localhost:8080', 'tok');
      await assert.rejects(
        () => client.patchNote('missing', { title: 'X' }),
        (err: unknown) => {
          assert.ok(err instanceof EtapiError);
          assert.strictEqual(err.statusCode, 404);
          return true;
        },
      );
    });
  });

  describe('getNoteContentBuffer', () => {
    it('returns an ArrayBuffer of the response body', async () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      globalThis.fetch = async (): Promise<Response> =>
        ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer }) as unknown as Response;

      const client = new EtapiClient('http://localhost:8080', 'tok');
      const buf = await client.getNoteContentBuffer('n1');
      assert.ok(buf instanceof ArrayBuffer);
      assert.strictEqual(buf.byteLength, 4);
    });

    it('throws EtapiError on failure', async () => {
      mockFetch(403, 'Forbidden', false);

      const client = new EtapiClient('http://localhost:8080', 'tok');
      await assert.rejects(
        () => client.getNoteContentBuffer('n1'),
        (err: unknown) => {
          assert.ok(err instanceof EtapiError);
          assert.strictEqual(err.statusCode, 403);
          return true;
        },
      );
    });
  });

  describe('deleteNote', () => {
    it('sends DELETE to /etapi/notes/{noteId}', async () => {
      const capture = capturingFetch(204, '');

      const client = new EtapiClient('http://localhost:8080', 'tok');
      await client.deleteNote('n1');

      assert.ok(capture.url.endsWith('/notes/n1'));
      assert.strictEqual(capture.init?.method, 'DELETE');
    });

    it('includes Authorization header', async () => {
      const capture = capturingFetch(204, '');

      const client = new EtapiClient('http://localhost:8080', 'mytoken');
      await client.deleteNote('abc');

      assert.strictEqual(
        (capture.init?.headers as Record<string, string>)?.Authorization,
        'mytoken',
      );
    });

    it('throws EtapiError when server rejects deletion', async () => {
      mockFetch(404, 'Not Found', false);

      const client = new EtapiClient('http://localhost:8080', 'tok');
      await assert.rejects(
        () => client.deleteNote('missing'),
        (err: unknown) => {
          assert.ok(err instanceof EtapiError);
          assert.strictEqual(err.statusCode, 404);
          return true;
        },
      );
    });
  });

  describe('patchBranch', () => {
    it('sends PATCH to /etapi/branches/{branchId} with notePosition patch body', async () => {
      const updatedBranch = {
        branchId: 'b1',
        noteId: 'n1',
        parentNoteId: 'p1',
        prefix: '',
        notePosition: 30,
        isExpanded: true,
        utcDateModified: '2024-01-01T00:00:00Z',
      };
      const capture = capturingFetch(200, updatedBranch);

      const client = new EtapiClient('http://localhost:8080', 'tok');
      const result = await client.patchBranch('b1', { notePosition: 30 });

      assert.ok(capture.url.endsWith('/branches/b1'));
      assert.strictEqual(capture.init?.method, 'PATCH');
      const body = JSON.parse(capture.init?.body as string);
      assert.strictEqual(body.notePosition, 30);
      assert.strictEqual(result.notePosition, 30);
    });
  });

  describe('getBranch', () => {
    it('sends GET request to /etapi/branches/{branchId}', async () => {
      const branch = {
        branchId: 'b1',
        noteId: 'n1',
        parentNoteId: 'parent',
        prefix: '',
        notePosition: 0,
        isExpanded: true,
        utcDateModified: '2024-01-01T00:00:00Z',
      };
      const capture = capturingFetch(200, branch);

      const client = new EtapiClient('http://localhost:8080', 'tok');
      const result = await client.getBranch('b1');

      assert.ok(capture.url.endsWith('/branches/b1'));
      assert.strictEqual(capture.init?.method, 'GET');
      assert.strictEqual(result.branchId, 'b1');
      assert.strictEqual(result.noteId, 'n1');
    });
  });

  describe('URL-encoding of path segments', () => {
    it('encodes special characters in noteId so they cannot corrupt the request path', async () => {
      const capture = capturingFetch(200, { noteId: 'a/b?c', title: 'X', type: 'text', mime: '', childNoteIds: [] });

      const client = new EtapiClient('http://localhost:8080', 'tok');
      await client.getNote('a/b?c');

      assert.strictEqual(capture.url, 'http://localhost:8080/etapi/notes/a%2Fb%3Fc');
    });
  });

  describe('searchNotes', () => {
    it('builds the query string from all provided options', async () => {
      const capture = capturingFetch(200, { results: [] });

      const client = new EtapiClient('http://localhost:8080', 'tok');
      await client.searchNotes('#book', {
        fastSearch: true,
        includeArchivedNotes: true,
        ancestorNoteId: 'root',
        limit: 10,
        orderBy: 'note.title',
        orderDirection: 'desc',
      });

      const url = new URL(capture.url);
      assert.strictEqual(url.pathname, '/etapi/notes');
      assert.strictEqual(url.searchParams.get('search'), '#book');
      assert.strictEqual(url.searchParams.get('fastSearch'), 'true');
      assert.strictEqual(url.searchParams.get('includeArchivedNotes'), 'true');
      assert.strictEqual(url.searchParams.get('ancestorNoteId'), 'root');
      assert.strictEqual(url.searchParams.get('limit'), '10');
      assert.strictEqual(url.searchParams.get('orderBy'), 'note.title');
      assert.strictEqual(url.searchParams.get('orderDirection'), 'desc');
    });

    it('returns the results array, including each note\'s attributes', async () => {
      const note = { noteId: 'n1', title: 'X', type: 'text', mime: '', childNoteIds: [], attributes: [{ attributeId: 'a1', noteId: 'n1', type: 'relation', name: 'rel', value: 'target', position: 0, isInheritable: false }] };
      mockFetch(200, { results: [note] });

      const client = new EtapiClient('http://localhost:8080', 'tok');
      const { results } = await client.searchNotes('note.targetRelationCount > 0');

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].attributes?.[0].value, 'target');
    });
  });

  describe('calendar notes', () => {
    it('getInboxNote sends GET to /etapi/inbox/{date}', async () => {
      const capture = capturingFetch(200, { noteId: 'inbox1', title: 'Inbox', type: 'text', mime: '', childNoteIds: [] });
      const client = new EtapiClient('http://localhost:8080', 'tok');
      await client.getInboxNote('2025-01-15');
      assert.strictEqual(capture.url, 'http://localhost:8080/etapi/inbox/2025-01-15');
    });

    it('getWeekNote sends GET to /etapi/calendar/weeks/{week}', async () => {
      const capture = capturingFetch(200, { noteId: 'w1', title: 'Week', type: 'text', mime: '', childNoteIds: [] });
      const client = new EtapiClient('http://localhost:8080', 'tok');
      await client.getWeekNote('2025-W03');
      assert.strictEqual(capture.url, 'http://localhost:8080/etapi/calendar/weeks/2025-W03');
    });

    it('getMonthNote sends GET to /etapi/calendar/months/{month}', async () => {
      const capture = capturingFetch(200, { noteId: 'm1', title: 'Month', type: 'text', mime: '', childNoteIds: [] });
      const client = new EtapiClient('http://localhost:8080', 'tok');
      await client.getMonthNote('2025-01');
      assert.strictEqual(capture.url, 'http://localhost:8080/etapi/calendar/months/2025-01');
    });

    it('getYearNote sends GET to /etapi/calendar/years/{year}', async () => {
      const capture = capturingFetch(200, { noteId: 'y1', title: 'Year', type: 'text', mime: '', childNoteIds: [] });
      const client = new EtapiClient('http://localhost:8080', 'tok');
      await client.getYearNote('2025');
      assert.strictEqual(capture.url, 'http://localhost:8080/etapi/calendar/years/2025');
    });
  });

  describe('revisions', () => {
    it('getNoteRevisions sends GET to /etapi/notes/{noteId}/revisions', async () => {
      const revision = {
        revisionId: 'r1', noteId: 'n1', type: 'text', mime: 'text/html', isProtected: false,
        title: 'T', blobId: 'b1', dateLastEdited: '', dateCreated: '', utcDateLastEdited: '',
        utcDateCreated: '', utcDateModified: '', contentLength: 10,
      };
      const capture = capturingFetch(200, [revision]);
      const client = new EtapiClient('http://localhost:8080', 'tok');
      const revisions = await client.getNoteRevisions('n1');
      assert.strictEqual(capture.url, 'http://localhost:8080/etapi/notes/n1/revisions');
      assert.strictEqual(revisions[0].revisionId, 'r1');
    });

    it('getRevisionContent returns the response body as text', async () => {
      globalThis.fetch = async (): Promise<Response> =>
        ({ ok: true, status: 200, text: async () => '<p>old content</p>' }) as Response;
      const client = new EtapiClient('http://localhost:8080', 'tok');
      const content = await client.getRevisionContent('r1');
      assert.strictEqual(content, '<p>old content</p>');
    });

    it('getRevisionContent throws EtapiError on failure', async () => {
      mockFetch(404, 'Not Found', false);
      const client = new EtapiClient('http://localhost:8080', 'tok');
      await assert.rejects(
        () => client.getRevisionContent('missing'),
        (err: unknown) => err instanceof EtapiError,
      );
    });
  });

  describe('branch CRUD', () => {
    it('createBranch posts to /etapi/branches with the clone/move body', async () => {
      const branch = { branchId: 'b2', noteId: 'n1', parentNoteId: 'p2', prefix: '', notePosition: 10, isExpanded: false, utcDateModified: '' };
      const capture = capturingFetch(200, branch);
      const client = new EtapiClient('http://localhost:8080', 'tok');
      await client.createBranch('n1', 'p2', 10);

      assert.ok(capture.url.endsWith('/branches'));
      assert.strictEqual(capture.init?.method, 'POST');
      const body = JSON.parse(capture.init?.body as string);
      assert.strictEqual(body.noteId, 'n1');
      assert.strictEqual(body.parentNoteId, 'p2');
      assert.strictEqual(body.notePosition, 10);
    });

    it('createBranch omits notePosition from the body when not provided', async () => {
      const capture = capturingFetch(200, { branchId: 'b3' });
      const client = new EtapiClient('http://localhost:8080', 'tok');
      await client.createBranch('n1', 'p2');

      const body = JSON.parse(capture.init?.body as string);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(body, 'notePosition'), false);
    });

    it('deleteBranch sends DELETE to /etapi/branches/{branchId}', async () => {
      const capture = capturingFetch(204, '');
      const client = new EtapiClient('http://localhost:8080', 'tok');
      await client.deleteBranch('b1');
      assert.ok(capture.url.endsWith('/branches/b1'));
      assert.strictEqual(capture.init?.method, 'DELETE');
    });

    it('refreshNoteOrdering posts to /etapi/refresh-note-ordering/{parentNoteId}', async () => {
      const capture = capturingFetch(204, '');
      const client = new EtapiClient('http://localhost:8080', 'tok');
      await client.refreshNoteOrdering('parent1');
      assert.ok(capture.url.endsWith('/refresh-note-ordering/parent1'));
      assert.strictEqual(capture.init?.method, 'POST');
    });
  });

  describe('attributes', () => {
    it('getAttribute sends GET to /etapi/attributes/{attributeId}', async () => {
      const attr = { attributeId: 'a1', noteId: 'n1', type: 'label', name: 'x', value: '', position: 0, isInheritable: false };
      const capture = capturingFetch(200, attr);
      const client = new EtapiClient('http://localhost:8080', 'tok');
      const result = await client.getAttribute('a1');
      assert.ok(capture.url.endsWith('/attributes/a1'));
      assert.strictEqual(result.attributeId, 'a1');
    });

    it('createAttribute posts to /etapi/attributes with type/name/value/isInheritable', async () => {
      const capture = capturingFetch(200, { attributeId: 'a2' });
      const client = new EtapiClient('http://localhost:8080', 'tok');
      await client.createAttribute('n1', 'relation', 'rel', 'target', true);

      assert.ok(capture.url.endsWith('/attributes'));
      const body = JSON.parse(capture.init?.body as string);
      assert.strictEqual(body.noteId, 'n1');
      assert.strictEqual(body.type, 'relation');
      assert.strictEqual(body.name, 'rel');
      assert.strictEqual(body.value, 'target');
      assert.strictEqual(body.isInheritable, true);
    });

    it('patchAttribute sends PATCH to /etapi/attributes/{attributeId}', async () => {
      const capture = capturingFetch(200, { attributeId: 'a1', value: 'new' });
      const client = new EtapiClient('http://localhost:8080', 'tok');
      await client.patchAttribute('a1', { value: 'new' });
      assert.ok(capture.url.endsWith('/attributes/a1'));
      assert.strictEqual(capture.init?.method, 'PATCH');
    });

    it('deleteAttribute sends DELETE to /etapi/attributes/{attributeId}', async () => {
      const capture = capturingFetch(204, '');
      const client = new EtapiClient('http://localhost:8080', 'tok');
      await client.deleteAttribute('a1');
      assert.ok(capture.url.endsWith('/attributes/a1'));
      assert.strictEqual(capture.init?.method, 'DELETE');
    });
  });

  describe('attachments', () => {
    it('getNoteAttachments sends GET to /etapi/notes/{noteId}/attachments', async () => {
      const attachment = {
        attachmentId: 'att1', ownerId: 'n1', role: 'file', mime: 'text/plain', title: 'f.txt',
        position: 0, blobId: 'b1', dateModified: '', utcDateModified: '', contentLength: 5,
      };
      const capture = capturingFetch(200, [attachment]);
      const client = new EtapiClient('http://localhost:8080', 'tok');
      const attachments = await client.getNoteAttachments('n1');
      assert.strictEqual(capture.url, 'http://localhost:8080/etapi/notes/n1/attachments');
      assert.strictEqual(attachments[0].attachmentId, 'att1');
    });

    it('getAttachmentContent returns an ArrayBuffer and throws EtapiError on failure', async () => {
      const bytes = new Uint8Array([9, 8, 7]);
      globalThis.fetch = async (): Promise<Response> =>
        ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer }) as unknown as Response;
      const client = new EtapiClient('http://localhost:8080', 'tok');
      const buf = await client.getAttachmentContent('att1');
      assert.strictEqual(buf.byteLength, 3);

      mockFetch(404, 'Not Found', false);
      await assert.rejects(
        () => client.getAttachmentContent('missing'),
        (err: unknown) => err instanceof EtapiError,
      );
    });

    it('createAttachment posts to /etapi/attachments with ownerId/role/mime/title/content', async () => {
      const capture = capturingFetch(200, { attachmentId: 'att2' });
      const client = new EtapiClient('http://localhost:8080', 'tok');
      await client.createAttachment('n1', 'file', 'text/plain', 'f.txt', 'base64content');

      assert.ok(capture.url.endsWith('/attachments'));
      const body = JSON.parse(capture.init?.body as string);
      assert.strictEqual(body.ownerId, 'n1');
      assert.strictEqual(body.role, 'file');
      assert.strictEqual(body.title, 'f.txt');
      assert.strictEqual(body.content, 'base64content');
    });

    it('deleteAttachment sends DELETE to /etapi/attachments/{attachmentId}', async () => {
      const capture = capturingFetch(204, '');
      const client = new EtapiClient('http://localhost:8080', 'tok');
      await client.deleteAttachment('att1');
      assert.ok(capture.url.endsWith('/attachments/att1'));
      assert.strictEqual(capture.init?.method, 'DELETE');
    });
  });

  describe('exportNoteSubtree', () => {
    it('sends GET to /etapi/notes/{noteId}/export?format={format} and returns an ArrayBuffer', async () => {
      const bytes = new Uint8Array([1, 2]);
      let capturedUrl = '';
      globalThis.fetch = async (url: string | URL | Request): Promise<Response> => {
        capturedUrl = url.toString();
        return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer } as unknown as Response;
      };
      const client = new EtapiClient('http://localhost:8080', 'tok');
      const buf = await client.exportNoteSubtree('n1', 'markdown');
      assert.strictEqual(capturedUrl, 'http://localhost:8080/etapi/notes/n1/export?format=markdown');
      assert.strictEqual(buf.byteLength, 2);
    });

    it('throws EtapiError on failure', async () => {
      mockFetch(500, 'Server Error', false);
      const client = new EtapiClient('http://localhost:8080', 'tok');
      await assert.rejects(
        () => client.exportNoteSubtree('n1', 'html'),
        (err: unknown) => err instanceof EtapiError,
      );
    });
  });

  describe('fetchRaw', () => {
    it('fetches a server-relative URL with auth headers and returns buffer + content-type', async () => {
      const bytes = new Uint8Array([5, 6]);
      const capture: { url: string; init?: RequestInit } = { url: '' };
      globalThis.fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        capture.url = url.toString();
        capture.init = init;
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'image/png']]) as unknown as Headers,
          arrayBuffer: async () => bytes.buffer,
        } as unknown as Response;
      };
      const client = new EtapiClient('http://localhost:8080', 'mytoken');
      const result = await client.fetchRaw('api/images/n1/pic.png');

      assert.strictEqual(capture.url, 'http://localhost:8080/api/images/n1/pic.png');
      assert.strictEqual(
        (capture.init?.headers as Record<string, string>)?.Authorization,
        'mytoken',
      );
      assert.strictEqual(result.contentType, 'image/png');
      assert.strictEqual(result.buffer.byteLength, 2);
    });

    it('throws EtapiError on a non-ok response', async () => {
      mockFetch(404, 'Not Found', false);
      const client = new EtapiClient('http://localhost:8080', 'tok');
      await assert.rejects(
        () => client.fetchRaw('api/images/missing/pic.png'),
        (err: unknown) => {
          assert.ok(err instanceof EtapiError);
          assert.strictEqual(err.statusCode, 404);
          return true;
        },
      );
    });
  });

  describe('failure modes not covered by status-code checks', () => {
    it('propagates a network-level fetch rejection instead of an HTTP-status EtapiError', async () => {
      globalThis.fetch = async (): Promise<Response> => {
        throw new TypeError('fetch failed');
      };

      const client = new EtapiClient('http://localhost:8080', 'tok');
      await assert.rejects(
        () => client.getNote('n1'),
        (err: unknown) => {
          // Not an EtapiError - refreshPolicy's classifyRefreshFailure() falls
          // back to matching "fetch"/"network"/etc. in the message for exactly
          // this case, so callers still classify it as a transient failure.
          assert.ok(!(err instanceof EtapiError));
          assert.ok(err instanceof Error);
          assert.match(err.message.toLowerCase(), /fetch/);
          return true;
        },
      );
    });

    it('propagates a JSON parse failure when the server returns a malformed body', async () => {
      globalThis.fetch = async (): Promise<Response> =>
        ({
          ok: true,
          status: 200,
          json: async () => { throw new SyntaxError('Unexpected token in JSON'); },
        }) as unknown as Response;

      const client = new EtapiClient('http://localhost:8080', 'tok');
      await assert.rejects(
        () => client.getNote('n1'),
        (err: unknown) => err instanceof SyntaxError,
      );
    });

    it('passes an AbortSignal to fetch so an unresponsive server can be timed out', async () => {
      const capture = capturingFetch(200, { noteId: 'n1', title: 'X', type: 'text', mime: '', childNoteIds: [] });
      const client = new EtapiClient('http://localhost:8080', 'tok');
      await client.getNote('n1');
      assert.ok(capture.init?.signal instanceof AbortSignal);
    });
  });

  describe('putAttachmentContentBinary', () => {
    it('sends PUT to /etapi/attachments/{attachmentId}/content with binary headers', async () => {
      const capture = capturingFetch(204, '');

      const client = new EtapiClient('http://localhost:8080', 'tok');
      await client.putAttachmentContentBinary('a1', new Uint8Array([1, 2, 3]));

      assert.ok(capture.url.endsWith('/attachments/a1/content'));
      assert.strictEqual(capture.init?.method, 'PUT');
      assert.strictEqual(
        (capture.init?.headers as Record<string, string>)?.['Content-Type'],
        'application/octet-stream',
      );
      assert.strictEqual(
        (capture.init?.headers as Record<string, string>)?.['Content-Transfer-Encoding'],
        'binary',
      );
      assert.ok(capture.init?.body instanceof ArrayBuffer);
      assert.strictEqual((capture.init?.body as ArrayBuffer).byteLength, 3);
    });

    it('throws EtapiError when attachment upload fails', async () => {
      mockFetch(400, 'Bad Request', false);

      const client = new EtapiClient('http://localhost:8080', 'tok');
      await assert.rejects(
        () => client.putAttachmentContentBinary('a1', new Uint8Array([1, 2, 3])),
        (err: unknown) => {
          assert.ok(err instanceof EtapiError);
          assert.strictEqual(err.statusCode, 400);
          return true;
        },
      );
    });
  });
});
