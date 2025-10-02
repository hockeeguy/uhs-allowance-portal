// pages/admin.js
import { useEffect, useMemo, useState } from 'react';
import {
  collection, doc, getDocs, setDoc, deleteDoc, serverTimestamp
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export default function AdminPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all'); // all | pending | submitted | reviewed
  const [edit, setEdit] = useState({}); // { `${uid}:${catId}`: true/false }
  const [draft, setDraft] = useState({}); // { `${uid}:${catId}`: { items: [...] } }

  // ---- Fetch everything (headers + categories) ----
  async function fetchAll() {
    try {
      setLoading(true);
      const rootSnap = await getDocs(collection(db, 'selections'));
      const users = [];

      for (const headerDoc of rootSnap.docs) {
        const header = { id: headerDoc.id, ...(headerDoc.data() || {}) };

        const catSnap = await getDocs(collection(db, 'selections', headerDoc.id, 'categories'));
        const categories = [];
        catSnap.forEach((c) => {
          const d = c.data() || {};
          categories.push({
            id: c.id,
            category: d.category || c.id,
            items: Array.isArray(d.items) ? d.items : [],
            updatedAt: d.updatedAt || null,
          });
        });

        users.push({
          ...header,
          categories,
          totalItems: categories.reduce((acc, c) => acc + c.items.length, 0),
        });
      }

      setRows(users);
    } catch (e) {
      console.error('Admin load error:', e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
  }, []);

  // ---- Helpers for edit state ----
  const keyOf = (uid, catId) => `${uid}:${catId}`;

  const startEdit = (uid, catId, items) => {
    setEdit((e) => ({ ...e, [keyOf(uid, catId)]: true }));
    setDraft((d) => ({ ...d, [keyOf(uid, catId)]: { items: JSON.parse(JSON.stringify(items || [])) } }));
  };

  const cancelEdit = (uid, catId) => {
    setEdit((e) => ({ ...e, [keyOf(uid, catId)]: false }));
    setDraft((d) => {
      const copy = { ...d };
      delete copy[keyOf(uid, catId)];
      return copy;
    });
  };

  const updateDraftItem = (uid, catId, idx, field, value) => {
    setDraft((d) => {
      const k = keyOf(uid, catId);
      const cur = d[k] || { items: [] };
      const arr = Array.isArray(cur.items) ? [...cur.items] : [];
      arr[idx] = { ...(arr[idx] || {}), [field]: value };
      return { ...d, [k]: { items: arr } };
    });
  };

  const saveCategory = async (uid, catId, categoryName) => {
    try {
      const k = keyOf(uid, catId);
      const cur = draft[k];
      if (!cur) return;
      const safeItems = (cur.items || []).map((it) => ({
        Link: it?.Link || '',
        Type: it?.Type || '',
        Notes: it?.Notes || '',
        Images: Array.isArray(it?.Images) ? it.Images.filter((u) => typeof u === 'string') : [],
      }));

      await setDoc(
        doc(db, 'selections', uid, 'categories', catId),
        { category: categoryName, items: safeItems, updatedAt: serverTimestamp() },
        { merge: true }
      );
      // Refresh local view
      await fetchAll();
      cancelEdit(uid, catId);
      alert('Category saved.');
    } catch (e) {
      console.error('Save category failed:', e);
      alert('Save failed. See console.');
    }
  };

  const updateStatus = async (uid, newStatus) => {
    try {
      await setDoc(
        doc(db, 'selections', uid),
        { status: newStatus, updatedAt: serverTimestamp() },
        { merge: true }
      );
      await fetchAll();
    } catch (e) {
      console.error('Update status failed:', e);
      alert('Status update failed.');
    }
  };

  const deleteSubmission = async (uid) => {
    if (!confirm('Delete this submission (header + all category docs)?')) return;
    try {
      const catSnap = await getDocs(collection(db, 'selections', uid, 'categories'));
      await Promise.all(catSnap.docs.map((d) => deleteDoc(d.ref)));
      await deleteDoc(doc(db, 'selections', uid));
      setRows((prev) => prev.filter((r) => r.id !== uid));
      alert('Submission deleted.');
    } catch (e) {
      console.error('Delete failed:', e);
      alert('Delete failed. See console for details.');
    }
  };

  const filtered = useMemo(() => {
    const t = (s) => (s || '').toString().toLowerCase();
    return rows.filter((r) => {
      if (status !== 'all' && (r.status || 'pending') !== status) return false;
      const hay = `${t(r.clientName)} ${t(r.email)} ${t(r.status)}`;
      return hay.includes(t(q));
    });
  }, [rows, q, status]);

  return (
    <div className="container">
      <div className="header">
        <div className="left">
          <div className="brand-title">Admin Dashboard</div>
          <small>Review & edit client selections</small>
        </div>
        <div className="row">
          <input
            placeholder="Search by client/email/status"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 280 }}
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="submitted">Submitted</option>
            <option value="reviewed">Reviewed</option>
          </select>
          <button className="btn outline" onClick={fetchAll}>Refresh</button>
        </div>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="card"><p>No matching submissions.</p></div>
      ) : (
        filtered.map((u) => (
          <div key={u.id} className="card">
            <div className="row" style={{justifyContent:'space-between', alignItems:'center'}}>
              <div>
                <h2 style={{margin:0}}>{u.clientName || '(Unnamed Client)'}</h2>
                <small>{u.email}</small>
                <div><small>Status: <strong>{u.status || 'pending'}</strong> · Items: {u.totalItems}</small></div>
              </div>
              <div className="row" style={{gap:8}}>
                <button className="btn outline" onClick={() => updateStatus(u.id, 'pending')}>Mark Pending</button>
                <button className="btn outline" onClick={() => updateStatus(u.id, 'submitted')}>Mark Submitted</button>
                <button className="btn outline" onClick={() => updateStatus(u.id, 'reviewed')}>Mark Reviewed</button>
                <button className="btn outline danger" onClick={() => deleteSubmission(u.id)}>Delete</button>
              </div>
            </div>

            {u.categories.map((cat) => {
              const k = keyOf(u.id, cat.id);
              const isEditing = !!edit[k];
              const items = isEditing ? (draft[k]?.items || []) : (cat.items || []);
              return (
                <div key={cat.id} className="card" style={{borderStyle:'dashed', marginTop:8}}>
                  <div className="row" style={{justifyContent:'space-between', alignItems:'center'}}>
                    <h3 style={{marginTop:0}}>{cat.category} ({items.length})</h3>
                    {!isEditing ? (
                      <button className="btn" onClick={() => startEdit(u.id, cat.id, cat.items)}>Edit</button>
                    ) : (
                      <div className="row" style={{gap:8}}>
                        <button className="btn outline" onClick={() => cancelEdit(u.id, cat.id)}>Cancel</button>
                        <button className="btn brand" onClick={() => saveCategory(u.id, cat.id, cat.category)}>Save</button>
                      </div>
                    )}
                  </div>

                  {items.length === 0 ? (
                    <small>No items</small>
                  ) : (
                    items.map((it, i) => (
                      <div key={i} style={{borderTop: i ? '1px solid #eee' : 'none', paddingTop: i ? 8 : 0}}>
                        {!isEditing ? (
                          <>
                            <div><strong>Type/Model:</strong> {it?.Type || '-'}</div>
                            <div><strong>Link/SKU:</strong> {it?.Link || '-'}</div>
                            <div><strong>Notes:</strong> {it?.Notes || '-'}</div>
                            {Array.isArray(it?.Images) && it.Images.length > 0 && (
                              <div className="gallery" style={{display:'flex', gap:8, marginTop:8, flexWrap:'wrap'}}>
                                {it.Images.map((src, k2) => (
                                  <a key={k2} href={src} target="_blank" rel="noreferrer">
                                    <img src={src} alt={`img-${k2}`} style={{width:96, height:96, objectFit:'cover', borderRadius:8}} />
                                  </a>
                                ))}
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <label>Type/Model</label>
                            <input
                              value={it?.Type || ''}
                              onChange={(e) => updateDraftItem(u.id, cat.id, i, 'Type', e.target.value)}
                            />
                            <label>Link/SKU</label>
                            <input
                              value={it?.Link || ''}
                              onChange={(e) => updateDraftItem(u.id, cat.id, i, 'Link', e.target.value)}
                            />
                            <label>Notes</label>
                            <textarea
                              rows={2}
                              value={it?.Notes || ''}
                              onChange={(e) => updateDraftItem(u.id, cat.id, i, 'Notes', e.target.value)}
                            />
                            {Array.isArray(it?.Images) && it.Images.length > 0 && (
                              <div className="gallery" style={{display:'flex', gap:8, marginTop:8, flexWrap:'wrap'}}>
                                {it.Images.map((src, k2) => (
                                  <a key={k2} href={src} target="_blank" rel="noreferrer">
                                    <img src={src} alt={`img-${k2}`} style={{width:96, height:96, objectFit:'cover', borderRadius:8}} />
                                  </a>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
