'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';

// Admin emails (same pattern as the app)
const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || 'david.gould@unityhomesolutions.net,maxwell.malone@unityhomesolutions.net,kellie.locke@unityhomesolutions.net')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

export default function AdminPage() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // master-detail
  const [selected, setSelected] = useState(null); // { uid, email, clientName, ... }
  const [catLoading, setCatLoading] = useState(false);
  const [catError, setCatError] = useState('');
  const [categories, setCategories] = useState([]); // [{id, category, items:[{Link,Type,Notes,Images[]}]}]

  const isAdmin = !!(user?.email && adminEmails.includes(user.email.toLowerCase()));

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // initial header load
  useEffect(() => {
    if (!authReady || !user || !isAdmin) return;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const snap = await getDocs(collection(db, 'selections'));
        const out = [];
        snap.forEach((d) => {
          const v = d.data() || {};
          const totalCount = v?.categories
            ? Object.values(v.categories).reduce((sum, x) => sum + (x?.count || 0), 0)
            : 0;
          out.push({
            id: d.id,
            uid: v.uid || d.id,
            email: v.email || '',
            clientName: v.clientName || '',
            status: v.status || 'pending',
            updatedAt: v.updatedAt?.toDate ? v.updatedAt.toDate() : null,
            totalCount,
          });
        });
        out.sort((a, b) => (b.updatedAt?.getTime?.() || 0) - (a.updatedAt?.getTime?.() || 0));
        setRows(out);
      } catch (e) {
        console.error('Admin load error:', e);
        setError(e?.message || 'Failed to load selections.');
      } finally {
        setLoading(false);
      }
    })();
  }, [authReady, user, isAdmin]);

  // when a client is selected, load their categories
  useEffect(() => {
    if (!selected?.uid) return;
    (async () => {
      try {
        setCatLoading(true);
        setCatError('');
        const snap = await getDocs(collection(db, 'selections', selected.uid, 'categories'));
        const list = [];
        snap.forEach((d) => {
          const v = d.data() || {};
          list.push({
            id: d.id,
            category: v.category || d.id,
            items: Array.isArray(v.items) ? v.items : [],
            updatedAt: v.updatedAt?.toDate ? v.updatedAt.toDate() : null,
          });
        });
        // sort categories alphabetically
        list.sort((a, b) => a.category.localeCompare(b.category));
        setCategories(list);
      } catch (e) {
        console.error('Category load error:', e);
        setCatError(e?.message || 'Failed to load category details.');
      } finally {
        setCatLoading(false);
      }
    })();
  }, [selected?.uid]);

  if (!authReady) return <div className="container"><p>Loading…</p></div>;
  if (!user) return <div className="container">Please sign in first.</div>;
  if (!isAdmin) return <div className="container">Not authorized (admin only).</div>;

  return (
    <div className="container">
      <div className="header" style={{ marginBottom: 16 }}>
        <div className="left">
          <img src="/logo.png" alt="Logo" className="logo" />
          <div>
            <div className="brand-title">Admin — Client Selections</div>
            <small>Signed in as {user.email}</small>
          </div>
        </div>
        <div className="row no-print">
          {selected ? (
            <button className="btn outline" onClick={() => setSelected(null)}>← Back to All Clients</button>
          ) : (
            <a className="btn outline" href="/">Back to Portal</a>
          )}
          <button className="btn outline" onClick={() => signOut(auth)}>Sign Out</button>
        </div>
      </div>

      {!selected ? (
        // MASTER LIST
        <>
          {error && <div className="card" style={{ borderColor: '#b91c1c' }}><p>{error}</p></div>}
          {loading ? (
            <div className="card"><p>Loading submissions…</p></div>
          ) : rows.length === 0 ? (
            <div className="card"><p>No submissions yet.</p></div>
          ) : (
            <div className="card" style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Client / Project</th>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Email</th>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Status</th>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Items</th>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Last Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      style={{ borderTop: '1px solid #e5e7eb', cursor: 'pointer' }}
                      onClick={() => setSelected(r)}
                      title="Click to view details"
                    >
                      <td style={{ padding: '8px' }}>{r.clientName || '(Unnamed)'}</td>
                      <td style={{ padding: '8px' }}>{r.email}</td>
                      <td style={{ padding: '8px' }}>{r.status}</td>
                      <td style={{ padding: '8px' }}>{r.totalCount}</td>
                      <td style={{ padding: '8px' }}>{r.updatedAt ? r.updatedAt.toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        // DETAIL VIEW
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <h2 style={{ marginBottom: 4 }}>{selected.clientName || '(Unnamed project)'}</h2>
            <div><small>{selected.email}</small></div>
            <div style={{ marginTop: 6 }}>
              <small>Status: <b>{selected.status}</b></small>
              {' · '}
              <small>Total Items: <b>{selected.totalCount}</b></small>
              {' · '}
              <small>Updated: <b>{selected.updatedAt ? selected.updatedAt.toLocaleString() : '—'}</b></small>
            </div>
          </div>

          {catError && <div className="card" style={{ borderColor: '#b91c1c' }}><p>{catError}</p></div>}
          {catLoading ? (
            <div className="card"><p>Loading category details…</p></div>
          ) : categories.length === 0 ? (
            <div className="card"><p>No categories yet.</p></div>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '12px' }}>
              {categories.map((cat) => (
                <div key={cat.id} className="card" style={{ minHeight: 120 }}>
                  <h3 style={{ marginBottom: 8 }}>{cat.category}</h3>

                  {cat.items.length === 0 ? (
                    <p style={{ opacity: 0.7 }}>No items</p>
                  ) : (
                    cat.items.map((it, idx) => (
                      <div key={idx} className="card" style={{ borderStyle: 'dashed', marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                          <div>
                            <div style={{ fontWeight: 600 }}>Item {idx + 1}</div>
                            <div style={{ fontSize: 13 }}>
                              {it.Type ? <div>Type/Model: {it.Type}</div> : null}
                              {it.Link ? (
                                <div>
                                  Link/SKU:{" "}
                                  {/^https?:\/\//i.test(it.Link) ? (
                                    <a href={it.Link} target="_blank" rel="noreferrer">{it.Link}</a>
                                  ) : (
                                    <span>{it.Link}</span>
                                  )}
                                </div>
                              ) : null}
                              {it.Notes ? <div>Notes: {it.Notes}</div> : null}
                            </div>
                          </div>
                          {Array.isArray(it.Images) && it.Images.length > 0 ? (
                            <div className="gallery" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 180, justifyContent: 'flex-end' }}>
                              {it.Images.slice(0, 4).map((src, k) => (
                                <a key={k} href={src} target="_blank" rel="noreferrer" title="Open full image">
                                  <img src={src} alt={`img-${k}`} className="thumb" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6 }} />
                                </a>
                              ))}
                              {it.Images.length > 4 ? (
                                <div style={{ fontSize: 12, opacity: 0.7, alignSelf: 'center' }}>+{it.Images.length - 4} more</div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
