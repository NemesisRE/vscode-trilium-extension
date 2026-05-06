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
});
