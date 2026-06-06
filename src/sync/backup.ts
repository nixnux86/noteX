import { db, uid, type SnapshotMeta } from '../db/schema';
import { APP_VERSION } from '../appVersion';

const SNAPSHOT_LIMIT = 20;

function byteSize(value: unknown) {
  return new Blob([JSON.stringify(value)]).size;
}

function countPayloadItems(payload: any) {
  return {
    pages: payload.pages?.length || 0,
    blocks: payload.blocks?.length || 0,
    dbFields: payload.dbFields?.length || 0,
    dbRows: payload.dbRows?.length || 0,
    users: payload.users?.length || 0,
    workspaces: payload.workspaces?.length || 0
  };
}

export function formatBytes(size = 0) {
  if (!size) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
  return `${(size / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export async function exportBackup() {
  const [pages, blocks, dbFields, dbRows, settings, users, workspaces] = await Promise.all([
    db.pages.toArray(),
    db.blocks.toArray(),
    db.dbFields.toArray(),
    db.dbRows.toArray(),
    db.settings.toArray(),
    db.users.toArray(),
    db.workspaces.toArray()
  ]);

  // Important: snapshots are intentionally excluded from exported backups and from
  // snapshot payloads. Including them creates recursive backup growth and can crash
  // Chromium tabs when a manual snapshot is created on an existing large profile.
  return { app: 'noteX', version: APP_VERSION, schemaVersion: 3, exportedAt: Date.now(), pages, blocks, dbFields, dbRows, settings, users, workspaces };
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
  await db.transaction('rw', [db.pages, db.blocks, db.dbFields, db.dbRows, db.settings, db.snapshots, db.snapshotMetas, db.users, db.workspaces], async () => {
    await db.pages.clear(); await db.blocks.clear(); await db.dbFields.clear(); await db.dbRows.clear(); await db.settings.clear(); await db.snapshots.clear(); await db.snapshotMetas.clear(); await db.users.clear(); await db.workspaces.clear();
    if (data.pages?.length) await db.pages.bulkPut(data.pages);
    if (data.blocks?.length) await db.blocks.bulkPut(data.blocks);
    if (data.dbFields?.length) await db.dbFields.bulkPut(data.dbFields);
    if (data.dbRows?.length) await db.dbRows.bulkPut(data.dbRows);
    if (data.settings?.length) await db.settings.bulkPut(data.settings);
    if (data.users?.length) await db.users.bulkPut(data.users);
    if (data.workspaces?.length) await db.workspaces.bulkPut(data.workspaces);
  });
}

export async function createSnapshot(label = 'Manual snapshot') {
  const payload = await exportBackup();
  const id = uid();
  const createdAt = Date.now();
  const sizeBytes = byteSize(payload);
  const itemCounts = countPayloadItems(payload);
  const meta: SnapshotMeta = { id, label, createdAt, sizeBytes, itemCounts };

  await db.transaction('rw', [db.snapshots, db.snapshotMetas], async () => {
    await db.snapshots.add({ id, label, payload, createdAt, sizeBytes, itemCounts } as any);
    await db.snapshotMetas.add(meta);
    const allMetas = await db.snapshotMetas.orderBy('createdAt').toArray();
    const excess = allMetas.length - SNAPSHOT_LIMIT;
    if (excess > 0) {
      const oldIds = allMetas.slice(0, excess).map(s => s.id);
      await db.snapshots.bulkDelete(oldIds);
      await db.snapshotMetas.bulkDelete(oldIds);
    }
  });
  return meta;
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

export async function getSnapshotMetas(limit = 20) {
  return db.snapshotMetas.orderBy('createdAt').reverse().limit(limit).toArray();
}

export async function deleteSnapshotEverywhere(id: string) {
  await db.transaction('rw', [db.snapshots, db.snapshotMetas], async () => {
    await db.snapshots.delete(id);
    await db.snapshotMetas.delete(id);
  });
}

export async function deleteAllSnapshots() {
  await db.transaction('rw', [db.snapshots, db.snapshotMetas], async () => {
    await db.snapshots.clear();
    await db.snapshotMetas.clear();
  });
}

export async function deleteOldSnapshots(keepLatest = 10) {
  const metas = await db.snapshotMetas.orderBy('createdAt').reverse().toArray();
  const removeIds = metas.slice(keepLatest).map(s => s.id);
  if (removeIds.length) {
    await db.transaction('rw', [db.snapshots, db.snapshotMetas], async () => {
      await db.snapshots.bulkDelete(removeIds);
      await db.snapshotMetas.bulkDelete(removeIds);
    });
  }
  return removeIds.length;
}

export async function getStorageDiagnostics(activeWorkspaceId?: string, activePageId?: string) {
  const [pageCount, blockCount, snapshotCount, snapshotMetaCount, workspacePageCount, workspaceBlockCount, activePageBlocks] = await Promise.all([
    db.pages.count(),
    db.blocks.count(),
    db.snapshots.count(),
    db.snapshotMetas.count(),
    activeWorkspaceId ? db.pages.where('workspaceId').equals(activeWorkspaceId).count() : Promise.resolve(0),
    activeWorkspaceId ? db.blocks.where('workspaceId').equals(activeWorkspaceId).count() : Promise.resolve(0),
    activePageId ? db.blocks.where('pageId').equals(activePageId).toArray() : Promise.resolve([])
  ]);
  const metas = await db.snapshotMetas.toArray();
  const snapshotBytes = metas.reduce((sum, s) => sum + (s.sizeBytes || 0), 0);
  const activePageBytes = activePageBlocks.length ? byteSize(activePageBlocks) : 0;
  return { pageCount, blockCount, snapshotCount, snapshotMetaCount, workspacePageCount, workspaceBlockCount, activePageBlockCount: activePageBlocks.length, activePageBytes, snapshotBytes };
}

export const cloudSyncMessage = (provider: 'Google' | 'Microsoft') =>
  `${provider} OAuth/Drive sync is prepared as a UI stub. Real API credentials must be configured before production sync.`;
