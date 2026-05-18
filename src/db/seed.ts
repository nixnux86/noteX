import { db, uid, now, Page, Block, DbRow, DbField } from './schema';

export async function ensureSeedData() {
  const count = await db.pages.count();
  if (count > 0) return;
  const t = now();
  const welcomeId = uid();
  const dbPageId = uid();
  const researchId = uid();
  const canvasPlanId = uid();
  const pages: Page[] = [
    { id: welcomeId, title: 'Welcome to noteX', icon: '📘', parentId: null, collapsed: 0, favorite: 1, lastOpenedAt: t + 20, createdAt: t, updatedAt: t },
    { id: dbPageId, title: 'Project Database', icon: '🗂️', parentId: null, section: 'other', lastOpenedAt: t + 17, createdAt: t + 3, updatedAt: t + 3 },
    { id: researchId, title: 'Research Notes', icon: '🔬', parentId: null, section: 'other', favorite: 0, lastOpenedAt: t + 19, createdAt: t + 1, updatedAt: t + 1 },
    { id: canvasPlanId, title: 'Canvas Ideas', icon: '🧩', parentId: null, section: 'other', lastOpenedAt: t + 16, createdAt: t + 4, updatedAt: t + 4 }
  ];
  const blocks: Block[] = [
    { id: uid(), pageId: welcomeId, type: 'h1', text: 'Welcome to noteX v1.6.6', sort: 1, createdAt: t, updatedAt: t },
    { id: uid(), pageId: welcomeId, type: 'paragraph', text: '', sort: 2, createdAt: t, updatedAt: t },
    { id: uid(), pageId: researchId, type: 'h1', text: 'Research Notes', sort: 1, createdAt: t, updatedAt: t },
    { id: uid(), pageId: researchId, type: 'paragraph', text: '', sort: 2, createdAt: t, updatedAt: t },
    { id: uid(), pageId: dbPageId, type: 'h1', text: 'Project Database', sort: 1, createdAt: t, updatedAt: t },
    { id: uid(), pageId: dbPageId, type: 'paragraph', text: 'This page shows one database in table, board, and gallery views with editable properties.', sort: 2, createdAt: t, updatedAt: t },
    { id: uid(), pageId: canvasPlanId, type: 'h1', text: 'Canvas Ideas', sort: 1, createdAt: t, updatedAt: t },
    { id: uid(), pageId: canvasPlanId, type: 'paragraph', text: '', sort: 2, createdAt: t, updatedAt: t }
  ];
  const fields: DbField[] = [
    { id: 'title', name: 'Task', type: 'text', sort: 1, createdAt: t, updatedAt: t },
    { id: 'status', name: 'Status', type: 'status', options: ['Backlog', 'Doing', 'Done'], sort: 2, createdAt: t, updatedAt: t },
    { id: 'owner', name: 'Owner', type: 'text', sort: 3, createdAt: t, updatedAt: t },
    { id: 'tag', name: 'Tag', type: 'select', options: ['General', 'Research', 'Design', 'Build'], sort: 4, createdAt: t, updatedAt: t },
    { id: 'due', name: 'Due', type: 'date', sort: 5, createdAt: t, updatedAt: t },
    { id: 'done', name: 'Done?', type: 'checkbox', sort: 6, createdAt: t, updatedAt: t },
    { id: 'note', name: 'Note', type: 'text', sort: 7, createdAt: t, updatedAt: t }
  ];
  const rows: DbRow[] = [
    { id: uid(), values: { title: 'Design sidebar tree', status: 'Done', owner: 'Me', tag: 'Design', due: '', done: true, note: 'Nested page navigation' }, createdAt: t, updatedAt: t },
    { id: uid(), values: { title: 'Add block actions', status: 'Doing', owner: 'Me', tag: 'Build', due: '', done: false, note: 'Duplicate, delete, move, convert' }, createdAt: t, updatedAt: t },
    { id: uid(), values: { title: 'Implement Google Drive sync', status: 'Backlog', owner: 'Me', tag: 'Build', due: '', done: false, note: 'Planned for v2.0' }, createdAt: t, updatedAt: t }
  ];
  await db.pages.bulkAdd(pages);
  await db.blocks.bulkAdd(blocks);
  await db.dbFields.bulkAdd(fields);
  await db.dbRows.bulkAdd(rows);
}
