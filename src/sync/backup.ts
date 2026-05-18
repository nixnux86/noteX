import { db, uid } from '../db/schema';

export async function exportBackup() {
  const [pages, blocks, dbFields, dbRows, settings, snapshots, users, workspaces] = await Promise.all([
    db.pages.toArray(), db.blocks.toArray(), db.dbFields.toArray(), db.dbRows.toArray(), db.settings.toArray(), db.snapshots.toArray(), db.users.toArray(), db.workspaces.toArray()
  ]);
  return { app: 'noteX', version: '1.6.116', schemaVersion: 2, exportedAt: Date.now(), pages, blocks, dbFields, dbRows, settings, snapshots, users, workspaces };
}

export async function downloadBackup() {
  const data = await exportBackup();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `noteX-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click(); URL.revokeObjectURL(url);
}

export async function restoreBackup(file: File) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (data.app !== 'noteX') throw new Error('Invalid noteX backup file. Please select a JSON file exported from noteX.');
  if (!Array.isArray(data.pages) || !Array.isArray(data.blocks)) throw new Error('Invalid backup content. Pages or blocks data is missing.');
  await db.transaction('rw', [db.pages, db.blocks, db.dbFields, db.dbRows, db.settings, db.snapshots, db.users, db.workspaces], async () => {
    await db.pages.clear(); await db.blocks.clear(); await db.dbFields.clear(); await db.dbRows.clear(); await db.settings.clear(); await db.snapshots.clear(); await db.users.clear(); await db.workspaces.clear();
    if (data.pages?.length) await db.pages.bulkPut(data.pages);
    if (data.blocks?.length) await db.blocks.bulkPut(data.blocks);
    if (data.dbFields?.length) await db.dbFields.bulkPut(data.dbFields);
    if (data.dbRows?.length) await db.dbRows.bulkPut(data.dbRows);
    if (data.settings?.length) await db.settings.bulkPut(data.settings);
    if (data.snapshots?.length) await db.snapshots.bulkPut(data.snapshots);
    if (data.users?.length) await db.users.bulkPut(data.users);
    if (data.workspaces?.length) await db.workspaces.bulkPut(data.workspaces);
  });
}

export async function createSnapshot(label = 'Manual snapshot') {
  const payload = await exportBackup();
  await db.snapshots.add({ id: uid(), label, payload, createdAt: Date.now() });
  const all = await db.snapshots.orderBy('createdAt').toArray();
  const excess = all.length - 20;
  if (excess > 0) await db.snapshots.bulkDelete(all.slice(0, excess).map(s => s.id));
}

export async function restoreSnapshot(id: string) {
  const snap = await db.snapshots.get(id); if (!snap) throw new Error('Snapshot not found');
  const data = snap.payload;
  await db.transaction('rw', [db.pages, db.blocks, db.dbFields, db.dbRows, db.settings, db.users, db.workspaces], async () => {
    await db.pages.clear(); await db.blocks.clear(); await db.dbFields.clear(); await db.dbRows.clear(); await db.settings.clear(); await db.users.clear(); await db.workspaces.clear();
    if (data.pages?.length) await db.pages.bulkPut(data.pages);
    if (data.blocks?.length) await db.blocks.bulkPut(data.blocks);
    if (data.dbFields?.length) await db.dbFields.bulkPut(data.dbFields);
    if (data.dbRows?.length) await db.dbRows.bulkPut(data.dbRows);
    if (data.settings?.length) await db.settings.bulkPut(data.settings);
    if (data.users?.length) await db.users.bulkPut(data.users);
    if (data.workspaces?.length) await db.workspaces.bulkPut(data.workspaces);
  });
}

export const cloudSyncMessage = (provider: 'Google' | 'Microsoft') =>
  `${provider} OAuth/Drive sync is prepared as a UI stub. Real API credentials must be configured before production sync.`;
