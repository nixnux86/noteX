import { useEffect, useState } from 'react';
import { db, DbField, DbRow, FieldType, uid, now } from '../db/schema';

type View = 'table' | 'board' | 'gallery';
const fieldTypes: FieldType[] = ['text', 'number', 'select', 'status', 'date', 'checkbox', 'url'];

export function DatabaseViews() {
  const [view, setView] = useState<View>('table');
  const [fields, setFields] = useState<DbField[]>([]);
  const [rows, setRows] = useState<DbRow[]>([]);

  async function load() {
    setFields(await db.dbFields.orderBy('sort').toArray());
    setRows(await db.dbRows.orderBy('updatedAt').reverse().toArray());
  }
  useEffect(() => { load(); }, []);

  const statusField = fields.find(f => f.type === 'status') || fields.find(f => f.id === 'status');
  const titleField = fields.find(f => f.id === 'title') || fields[0];
  const statuses = statusField?.options?.length ? statusField.options : ['Backlog', 'Doing', 'Done'];

  async function addRow() {
    const t = now();
    const values: Record<string, any> = {};
    fields.forEach(f => values[f.id] = f.type === 'checkbox' ? false : f.type === 'status' ? statuses[0] : '');
    values[titleField?.id || 'title'] = 'Untitled task';
    await db.dbRows.add({ id: uid(), values, createdAt: t, updatedAt: t }); load();
  }
  async function updateRow(id: string, fieldId: string, value: any) {
    const row = await db.dbRows.get(id); if (!row) return;
    await db.dbRows.update(id, { values: { ...row.values, [fieldId]: value }, updatedAt: now() }); load();
  }
  async function removeRow(id: string) { await db.dbRows.delete(id); load(); }
  async function addField() {
    const t = now();
    const field: DbField = { id: uid(), name: 'New property', type: 'text', sort: (fields.at(-1)?.sort || 0) + 1, createdAt: t, updatedAt: t };
    await db.dbFields.add(field); load();
  }
  async function updateField(id: string, patch: Partial<DbField>) { await db.dbFields.update(id, { ...patch, updatedAt: now() }); load(); }
  async function removeField(id: string) { if (id === 'title' || id === 'status') return alert('Task and Status are required.'); await db.dbFields.delete(id); load(); }

  function inputFor(row: DbRow, field: DbField) {
    const value = row.values?.[field.id] ?? '';
    if (field.type === 'checkbox') return <input type="checkbox" checked={!!value} onChange={e => updateRow(row.id, field.id, e.target.checked)} />;
    if (field.type === 'status' || field.type === 'select') return <select value={value} onChange={e => updateRow(row.id, field.id, e.target.value)}>{(field.options || statuses).map(o => <option key={o}>{o}</option>)}</select>;
    return <input type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'} value={value} onChange={e => updateRow(row.id, field.id, e.target.value)} />;
  }

  return <section className="database-card">
    <div className="database-head">
      <div><h2>Database views</h2><p>Editable properties with table, board, and gallery views.</p></div>
      <div className="segmented">{(['table','board','gallery'] as View[]).map(v => <button className={view===v?'active':''} onClick={() => setView(v)} key={v}>{v}</button>)}<button onClick={addRow}>+ Row</button><button onClick={addField}>+ Property</button></div>
    </div>

    <div className="properties-panel">
      <strong>Properties</strong>
      {fields.map(f => <div className="field-editor" key={f.id}>
        <input value={f.name} onChange={e => updateField(f.id, { name: e.target.value })}/>
        <select value={f.type} onChange={e => updateField(f.id, { type: e.target.value as FieldType })}>{fieldTypes.map(t => <option key={t}>{t}</option>)}</select>
        {(f.type === 'select' || f.type === 'status') && <input value={(f.options || []).join(', ')} onChange={e => updateField(f.id, { options: e.target.value.split(',').map(x=>x.trim()).filter(Boolean) })} placeholder="Options comma-separated"/>}
        <button className="ghost" onClick={() => removeField(f.id)}>Delete</button>
      </div>)}
    </div>

    {view === 'table' && <table className="nx-table"><thead><tr>{fields.map(f => <th key={f.id}>{f.name}</th>)}<th></th></tr></thead><tbody>{rows.map(r => <tr key={r.id}>{fields.map(f => <td key={f.id}>{inputFor(r, f)}</td>)}<td><button className="ghost" onClick={() => removeRow(r.id)}>Delete</button></td></tr>)}</tbody></table>}

    {view === 'board' && <div className="board">{statuses.map(s => <div className="lane" key={s}><h3>{s}</h3>{rows.filter(r=>r.values?.[statusField?.id || 'status']===s).map(r => <article className="task" key={r.id}>
      <strong>{r.values?.[titleField?.id || 'title'] || 'Untitled'}</strong><span>{r.values?.tag || 'No tag'} · {r.values?.owner || 'No owner'}</span><p>{r.values?.note || 'No note'}</p><div>{statuses.filter(x=>x!==s).map(x => <button key={x} onClick={() => updateRow(r.id, statusField?.id || 'status', x)}>Move to {x}</button>)}</div>
    </article>)}</div>)}</div>}

    {view === 'gallery' && <div className="gallery">{rows.map(r => <article className="gallery-card" key={r.id}><span>{r.values?.[statusField?.id || 'status']}</span><h3>{r.values?.[titleField?.id || 'title'] || 'Untitled'}</h3><p>{r.values?.note || 'No note yet.'}</p><small>{r.values?.tag || 'General'} · {r.values?.owner || 'Me'}</small></article>)}</div>}
  </section>;
}
