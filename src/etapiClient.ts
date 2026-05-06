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

export interface Revision {
  revisionId: string;
  noteId: string;
  type: string;
  mime: string;
  isProtected: boolean;
  title: string;
  blobId: string;
  dateLastEdited: string;
  dateCreated: string;
  utcDateLastEdited: string;
  utcDateCreated: string;
  utcDateModified: string;
  contentLength: number;
}

export interface Attachment {
  attachmentId: string;
  ownerId: string;
  role: string;
  mime: string;
  title: string;
  position: number;
  blobId: string;
  dateModified: string;
  utcDateModified: string;
  contentLength: number;
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

  getServerUrl(): string { return this.serverUrl; }
  getToken(): string { return this.token; }

  /** Fetch any URL relative to the server root with auth headers (no ETAPI prefix). */
  async fetchRaw(relativeUrl: string): Promise<{ buffer: ArrayBuffer; contentType: string }> {
    const url = `${this.serverUrl.replace(/\/$/, '')}/${relativeUrl.replace(/^\//, '')}`;
    const response = await fetch(url, { headers: this.authHeaders() });
    if (!response.ok) {
      throw new EtapiError(
        `GET ${relativeUrl} failed with status ${response.status}`,
        response.status,
      );
    }
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    return { buffer, contentType };
  }

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

  async getAttribute(attributeId: string): Promise<Attribute> {
    return this.jsonRequest<Attribute>('GET', `/attributes/${attributeId}`);
  }

  async createAttribute(
    noteId: string,
    type: 'label' | 'relation',
    name: string,
    value = '',
    isInheritable = false,
  ): Promise<Attribute> {
    return this.jsonRequest<Attribute>('POST', '/attributes', {
      noteId, type, name, value, isInheritable,
    });
  }

  async patchAttribute(attributeId: string, patch: Partial<Pick<Attribute, 'value' | 'isInheritable'>>): Promise<Attribute> {
    return this.jsonRequest<Attribute>('PATCH', `/attributes/${attributeId}`, patch);
  }

  async deleteAttribute(attributeId: string): Promise<void> {
    return this.jsonRequest<void>('DELETE', `/attributes/${attributeId}`);
  }

  async searchNotes(
    search: string,
    options: {
      fastSearch?: boolean;
      includeArchivedNotes?: boolean;
      ancestorNoteId?: string;
      limit?: number;
      orderBy?: string;
      orderDirection?: 'asc' | 'desc';
    } = {},
  ): Promise<{ results: Note[] }> {
    const params = new URLSearchParams({ search });
    if (options.fastSearch !== undefined) { params.set('fastSearch', String(options.fastSearch)); }
    if (options.includeArchivedNotes !== undefined) { params.set('includeArchivedNotes', String(options.includeArchivedNotes)); }
    if (options.ancestorNoteId) { params.set('ancestorNoteId', options.ancestorNoteId); }
    if (options.limit !== undefined) { params.set('limit', String(options.limit)); }
    if (options.orderBy) { params.set('orderBy', options.orderBy); }
    if (options.orderDirection) { params.set('orderDirection', options.orderDirection); }
    return this.jsonRequest<{ results: Note[] }>('GET', `/notes?${params.toString()}`);
  }

  async getInboxNote(date: string): Promise<Note> {
    return this.jsonRequest<Note>('GET', `/inbox/${date}`);
  }

  async getWeekNote(week: string): Promise<Note> {
    return this.jsonRequest<Note>('GET', `/calendar/weeks/${week}`);
  }

  async getMonthNote(month: string): Promise<Note> {
    return this.jsonRequest<Note>('GET', `/calendar/months/${month}`);
  }

  async getYearNote(year: string): Promise<Note> {
    return this.jsonRequest<Note>('GET', `/calendar/years/${year}`);
  }

  // ---------------------------------------------------------------------------
  // Revisions  (Phase 5a)
  // ---------------------------------------------------------------------------

  async getNoteRevisions(noteId: string): Promise<Revision[]> {
    return this.jsonRequest<Revision[]>('GET', `/notes/${noteId}/revisions`);
  }

  async getRevisionContent(revisionId: string): Promise<string> {
    const response = await fetch(`${this.baseUrl()}/revisions/${revisionId}/content`, {
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new EtapiError(
        `Failed to get revision content ${revisionId}: ${response.status} ${text}`,
        response.status,
      );
    }
    return response.text();
  }

  // ---------------------------------------------------------------------------
  // Branches — clone & move  (Phase 5b)
  // ---------------------------------------------------------------------------

  async createBranch(noteId: string, parentNoteId: string, notePosition?: number): Promise<Branch> {
    return this.jsonRequest<Branch>('POST', '/branches', {
      noteId,
      parentNoteId,
      ...(notePosition !== undefined ? { notePosition } : {}),
    });
  }

  async patchBranch(
    branchId: string,
    patch: Partial<Pick<Branch, 'notePosition' | 'prefix' | 'isExpanded'>>,
  ): Promise<Branch> {
    return this.jsonRequest<Branch>('PATCH', `/branches/${branchId}`, patch);
  }

  async deleteBranch(branchId: string): Promise<void> {
    return this.jsonRequest<void>('DELETE', `/branches/${branchId}`);
  }

  async refreshNoteOrdering(parentNoteId: string): Promise<void> {
    return this.jsonRequest<void>('POST', `/refresh-note-ordering/${parentNoteId}`);
  }

  // ---------------------------------------------------------------------------
  // Attachments  (Phase 5c)
  // ---------------------------------------------------------------------------

  async getNoteAttachments(noteId: string): Promise<Attachment[]> {
    return this.jsonRequest<Attachment[]>('GET', `/notes/${noteId}/attachments`);
  }

  async getAttachmentContent(attachmentId: string): Promise<ArrayBuffer> {
    const response = await fetch(`${this.baseUrl()}/attachments/${attachmentId}/content`, {
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new EtapiError(
        `Failed to get attachment content ${attachmentId}: ${response.status} ${text}`,
        response.status,
      );
    }
    return response.arrayBuffer();
  }

  async createAttachment(
    ownerId: string,
    role: string,
    mime: string,
    title: string,
    content: string,
  ): Promise<Attachment> {
    return this.jsonRequest<Attachment>('POST', '/attachments', {
      ownerId, role, mime, title, content,
    });
  }

  async deleteAttachment(attachmentId: string): Promise<void> {
    return this.jsonRequest<void>('DELETE', `/attachments/${attachmentId}`);
  }

  // ---------------------------------------------------------------------------
  // Export subtree  (Phase 5d)
  // ---------------------------------------------------------------------------

  async exportNoteSubtree(noteId: string, format: 'html' | 'markdown'): Promise<ArrayBuffer> {
    const response = await fetch(
      `${this.baseUrl()}/notes/${noteId}/export?format=${format}`,
      { headers: this.authHeaders() },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new EtapiError(
        `Failed to export note ${noteId}: ${response.status} ${text}`,
        response.status,
      );
    }
    return response.arrayBuffer();
  }
}
