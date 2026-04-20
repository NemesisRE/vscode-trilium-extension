/**
 * Typed client for the Trilium ETAPI (REST API).
 * Spec: https://docs.triliumnotes.org/user-guide/advanced-usage/etapi/api-reference.html
 */

export interface Attribute {
  attributeId: string;
  noteId: string;
  type: 'label' | 'relation';
  name: string;
  value: string;
  position: number;
  isInheritable: boolean;
}

export interface Note {
  noteId: string;
  title: string;
  type:
    | 'text'
    | 'code'
    | 'file'
    | 'image'
    | 'search'
    | 'book'
    | 'relationMap'
    | 'render'
    | 'noteMap'
    | 'mermaid'
    | 'canvas'
    | 'webView'
    | 'mindMap'
    | 'shortcut'
    | 'doc'
    | 'contentWidget'
    | 'launcher';
  mime: string;
  isProtected: boolean;
  blobId: string;
  childNoteIds: string[];
  parentNoteIds: string[];
  childBranchIds: string[];
  parentBranchIds: string[];
  dateCreated: string;
  dateModified: string;
  utcDateCreated: string;
  utcDateModified: string;
  attributes?: Attribute[];
}

export interface AppInfo {
  appVersion: string;
  dbVersion: number;
  syncVersion: number;
  buildDate: string;
  buildRevision: string;
  dataDirectory: string;
  utcDateTime: string;
}

export interface Branch {
  branchId: string;
  noteId: string;
  parentNoteId: string;
  prefix: string;
  notePosition: number;
  isExpanded: boolean;
  utcDateModified: string;
}

export interface CreateNoteResponse {
  note: Note;
  branch: Branch;
}

export class EtapiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'EtapiError';
  }
}

export class EtapiClient {
  constructor(
    private readonly serverUrl: string,
    private readonly token: string,
  ) {}

  private baseUrl(): string {
    return `${this.serverUrl.replace(/\/$/, '')}/etapi`;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: this.token };
  }

  private async jsonRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      ...this.authHeaders(),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    };

    const response = await fetch(`${this.baseUrl()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new EtapiError(
        `ETAPI ${method} ${path} failed with status ${response.status}: ${text}`,
        response.status,
      );
    }

    if (response.status === 204) {
      return undefined as unknown as T;
    }

    return response.json() as Promise<T>;
  }

  async getAppInfo(): Promise<AppInfo> {
    return this.jsonRequest<AppInfo>('GET', '/app-info');
  }

  async getNote(noteId: string): Promise<Note> {
    return this.jsonRequest<Note>('GET', `/notes/${noteId}`);
  }

  async patchNote(noteId: string, patch: Partial<Pick<Note, 'title' | 'type' | 'mime'>>): Promise<Note> {
    return this.jsonRequest<Note>('PATCH', `/notes/${noteId}`, patch);
  }

  async createNote(
    parentNoteId: string,
    title: string,
    type: 'text' | 'code' | 'mermaid' | 'canvas' | 'mindMap' = 'text',
    content = '',
    mime?: string,
  ): Promise<CreateNoteResponse> {
    return this.jsonRequest<CreateNoteResponse>('POST', '/create-note', {
      parentNoteId,
      title,
      type,
      content,
      ...(mime ? { mime } : {}),
    });
  }

  async getNoteContent(noteId: string): Promise<string> {
    const response = await fetch(`${this.baseUrl()}/notes/${noteId}/content`, {
      headers: this.authHeaders(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new EtapiError(
        `Failed to get content for note ${noteId}: ${response.status} ${text}`,
        response.status,
      );
    }

    return response.text();
  }

  async getNoteContentBuffer(noteId: string): Promise<ArrayBuffer> {
    const response = await fetch(`${this.baseUrl()}/notes/${noteId}/content`, {
      headers: this.authHeaders(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new EtapiError(
        `Failed to get content for note ${noteId}: ${response.status} ${text}`,
        response.status,
      );
    }

    return response.arrayBuffer();
  }

  async getDayNote(date: string): Promise<Note> {
    return this.jsonRequest<Note>('GET', `/calendar/days/${date}`);
  }

  async putNoteContent(noteId: string, content: string): Promise<void> {
    const response = await fetch(`${this.baseUrl()}/notes/${noteId}/content`, {
      method: 'PUT',
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'text/plain',
      },
      body: content,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new EtapiError(
        `Failed to update content for note ${noteId}: ${response.status} ${text}`,
        response.status,
      );
    }
  }

  async deleteNote(noteId: string): Promise<void> {
    return this.jsonRequest<void>('DELETE', `/notes/${noteId}`);
  }
}
