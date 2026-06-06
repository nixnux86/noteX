import Dexie, { Table } from 'dexie';

export type BlockType = 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'bullet' | 'numbered' | 'toggle' | 'todo' | 'code' | 'command' | 'quote' | 'math' | 'divider' | 'table' | 'image' | 'video' | 'audio' | 'file' | 'bookmark' | 'richDocument';
export type FieldType = 'text' | 'number' | 'select' | 'status' | 'date' | 'checkbox' | 'url';

export type Block = {
  id: string;
  pageId: string;
  workspaceId?: string;
  type: BlockType;
  text: string;
  checked?: boolean;
  imageWidth?: number;
  imageHeight?: number;
  caption?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  table?: string[][];
  tableColWidths?: number[];
  tableCellColors?: Record<string, string>;
  codeLanguage?: string;
  codeWrap?: boolean;
  numberedStart?: number;
  listLevel?: number;
  listStyle?: string;
  hpeTemplate?: number;
  sort: number;
  createdAt: number;
  updatedAt: number;
};

export type Page = {
  id: string;
  workspaceId?: string;
  title: string;
  icon?: string;
  parentId?: string | null;
  collapsed?: number;
  favorite?: number;
  lastOpenedAt?: number;
  section?: 'normal' | 'other';
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  deleted?: number;
  editorMode?: 'block' | 'plain';
};

export type DbField = {
  id: string;
  name: string;
  type: FieldType;
  options?: string[];
  sort: number;
  createdAt: number;
  updatedAt: number;
};

export type DbRow = {
  id: string;
  values: Record<string, any>;
  createdAt: number;
  updatedAt: number;
};

export type Setting = { key: string; value: any };
export type Snapshot = { id: string; label: string; payload: any; createdAt: number; sizeBytes?: number; itemCounts?: Record<string, number> };
export type SnapshotMeta = { id: string; label: string; createdAt: number; sizeBytes?: number; itemCounts?: Record<string, number> };
export type User = { id: string; email: string; name: string; avatar?: string; provider: 'local' | 'google'; providerSub?: string; createdAt: number; updatedAt: number };
export type Workspace = { id: string; userId: string; name: string; type: 'personal' | 'work' | 'business' | 'custom'; createdAt: number; updatedAt: number };

export class NoteXDB extends Dexie {
  pages!: Table<Page, string>;
  blocks!: Table<Block, string>;
  dbFields!: Table<DbField, string>;
  dbRows!: Table<DbRow, string>;
  settings!: Table<Setting, string>;
  snapshots!: Table<Snapshot, string>;
  snapshotMetas!: Table<SnapshotMeta, string>;
  users!: Table<User, string>;
  workspaces!: Table<Workspace, string>;

  constructor() {
    super('noteX-v1.6.7');
    this.version(1).stores({
      pages: 'id, title, parentId, updatedAt, deleted, collapsed, favorite, lastOpenedAt, section',
      blocks: 'id, pageId, sort, type, updatedAt',
      dbFields: 'id, name, type, sort, updatedAt',
      dbRows: 'id, updatedAt',
      settings: 'key',
      snapshots: 'id, createdAt'
    });
    this.version(2).stores({
      pages: 'id, workspaceId, title, parentId, updatedAt, deleted, collapsed, favorite, lastOpenedAt, section',
      blocks: 'id, workspaceId, pageId, sort, type, updatedAt',
      dbFields: 'id, name, type, sort, updatedAt',
      dbRows: 'id, updatedAt',
      settings: 'key',
      snapshots: 'id, createdAt',
      users: 'id, email, provider, providerSub, updatedAt',
      workspaces: 'id, userId, type, name, updatedAt'
    });
    this.version(3).stores({
      snapshotMetas: 'id, createdAt, sizeBytes'
    });
  }
}

export const db = new NoteXDB();
export const uid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
export const now = () => Date.now();
