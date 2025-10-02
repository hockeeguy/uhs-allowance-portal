'use client';

import React, { useEffect, useState } from 'react';
import { auth, db, googleProvider } from '@/lib/firebase';
import { onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut } from 'firebase/auth';
import { collection, getDocs, setDoc, serverTimestamp, doc } from 'firebase/firestore';

const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || 'david.gould@unityhomesolutions.net,maxwell.malone@unityhomesolutions.net,kellie.locke@unityhomesolutions.net')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// Helpers to normalize arrays vs objects
function toArray(maybe) {
  if (Array.isArray(maybe)) return maybe;
  if (maybe && typeof maybe === 'object') return Object.values(maybe);
  return [];
}
function getImagesFromItem(it) {
  const a = toArray(it?.Images);
  const b = toArray(it?.images);
  const c = typeof it?.Image === 'string' ? [it.Image] : [];
  const d = typeof it?.image === 'string' ? [it.image] : [];
  return [...a, ...b, ...c, ...d].filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u));
}

export default function AdminPage() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selected, setSelected] = useState(null);
  const [categories, setCategories] = useState([]);
  const [catLoading, setCatLoading] = useState(false);
  const [catError, setCatError] = useState('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signInBusy, setSignInBusy] = useState(false);
  const [signInError, setSignInError] = useState('');

  const isAdmin = !!(user?.email && adminEmails.includes(user.email.toLowerCase()));

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => { setUser(u || null); setAuthReady(true); });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !user || !isAdmin) return;
    (async () => {
      try {
        setLoading(true); setError('');
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
        console.error(e);
        setError(e?.message || 'Failed to load selections.');
      } finally { setLoading(false); }
    })();
  }, [authReady, user, isAdmin]);

  useEffect(() => {
    if (!selected?.uid) return;
    (async () => {
      try {
        setCatLoading(true); setCatError('');
        const snap = await getDocs(collection(db, 'selections', selected.uid, 'categories'));
        const list = [];
        snap.forEach((d) => {
          const v = d.data() || {};
          const itemsRaw = v.items?.length >= 0 ? v.items : (v.Items?.length >= 0 ? v.Items : (v.items || v.Items));
          list.push({
            id: d.id,
            category: v.category || d.id,
            items: toArray(itemsRaw),
            updatedAt: v.updatedAt?.toDate ? v.updatedAt.toDate() : null,
          });
        });
        list.sort((a, b) => a.category.localeCompare(b.category));
        setCategories(list);
      } catch (e) {
        console.error(e); setCatError(e?.message || 'Failed to load category details.');
      } finally { setCatLoading(false); }
    })();
  }, [selected?.uid]);

  async function handleAdminEmailSignIn(e) {
    e.preventDefault();
    try {
      setSignInBusy(true); setSignInError('');
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      console.error('Admin email sign-in failed', err);
      setSignInError(err?.message || 'Sign-in failed');
    } finally { setSignInBusy(false); }
  }
  async function handleAdminGoogleSignIn() {
    try {
      setSignInBusy(true); setSignInError('');
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Admin Google sign-in failed', err);
      setSignInError(err?.message || 'Google sign-in failed');
    } finally { setSignInBusy(false); }
  }

  
  // ---- Status update (Pending/Final) ----
  async function handleStatusChange(newStatus) {
    if (!selected || !selected.uid) return;
    try {
      await setDoc(doc(db, 'selections', selected.uid), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setSelected(prev => prev ? { ...prev, status: newStatus } : prev);
      setRows(prev => prev.map(r => (r.uid === selected.uid ? { ...r, status: newStatus } : r)));
    } catch (e) {
      console.error('Status update failed:', e);
      alert('Failed to update status: ' + (e?.message || e));
    }
  }

  if (!authReady) return <div className="container"><p>Loading…</p></div>;
  if (!user) {
    return (
      <div className="container">
        <div className="card" style={{ maxWidth: 420, margin: '40px auto' }}>
          <h2 style={{ marginBottom: 8 }}>Admin Sign In</h2>
          <p style={{ opacity: 0.75, marginBottom: 12 }}>Use your admin email to continue.</p>
          <form onSubmit={handleAdminEmailSignIn} className="auth-form">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required />
            <button className="btn" type="submit" disabled={signInBusy}>{signInBusy ? 'Signing in…' : 'Sign In'}</button>
          </form>
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            <button className="btn outline" onClick={handleAdminGoogleSignIn} disabled={signInBusy}>Continue with Google</button>
          </div>
          {signInError && <div className="card" style={{ marginTop: 10, borderColor: '#b91c1c' }}><p style={{ margin: 0 }}>{signInError}</p></div>}
        </div>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="container">
        <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}>
          <h2>Not authorized</h2>
          <p>This page is for admins only. Signed in as <b>{user.email}</b>.</p>
          <div className="row" style={{ gap: 8 }}>
            <a className="btn outline" href="/">Back to Portal</a>
            <button className="btn outline" onClick={() => signOut(auth)}>Sign Out</button>
          </div>
        </div>
      </div>
    );
  }

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
                    <th style={{ textAlign: 'left', padding: 8 }}>Client / Project</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Email</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Status</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Items</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Last Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={{ borderTop: '1px solid #e5e7eb', cursor: 'pointer' }} onClick={() => setSelected(r)}>
                      <td style={{ padding: 8 }}>{r.clientName || '(Unnamed)'}</td>
                      <td style={{ padding: 8 }}>{r.email}</td>
                      <td style={{ padding: 8 }}>{r.status}</td>
                      <td style={{ padding: 8 }}>{r.totalCount}</td>
                      <td style={{ padding: 8 }}>{r.updatedAt ? r.updatedAt.toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <h2 style={{ marginBottom: 4 }}>{selected.clientName || '(Unnamed project)'}</h2>
            <div><small>{selected.email}</small></div>
            <div style={{ marginTop: 6 }}>
              <small>Status: <b>{selected.status}</b></small> <select value={selected.status || "pending"} onChange={(e)=>handleStatusChange(e.target.value)} style={{ marginLeft: 8, padding: "2px 6px" }}><option value="pending">Pending</option><option value="final">Final</option></select>{' · '}
              <small>Total Items: <b>{selected.totalCount}</b></small>{' · '}
              <small>Updated: <b>{selected.updatedAt ? selected.updatedAt.toLocaleString() : '—'}</b></small>
            </div>
          </div>

          {catError && <div className="card" style={{ borderColor: '#b91c1c' }}><p>{catError}</p></div>}
          {catLoading ? (
            <div className="card"><p>Loading category details…</p></div>
          ) : categories.length === 0 ? (
            <div className="card"><p>No categories yet.</p></div>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
              {categories.map((cat) => (
                <div key={cat.id} className="card" style={{ minHeight: 120 }}>
                  <h3 style={{ marginBottom: 8 }}>{cat.category}</h3>

                  {cat.items.length === 0 ? (
                    <p style={{ opacity: 0.7 }}>No items</p>
                  ) : (
                    <>
                      {cat.items.map((it, idx) => {
                        const imgs = getImagesFromItem(it);
                        return (
                          <div key={idx} className="card" style={{ borderStyle: 'dashed', marginBottom: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                              <div>
                                <div style={{ fontWeight: 600 }}>Item {idx + 1}</div>
                                <div style={{ fontSize: 13 }}>
                                  {it.Type ? <div>Type/Model: {it.Type}</div> : null}
                                  {it.Link ? (
                                    <div>
                                      Link/SKU:{' '}
                                      {/^https?:\/\//i.test(it.Link) ? <a href={it.Link} target="_blank" rel="noreferrer">{it.Link}</a> : <span>{it.Link}</span>}
                                    </div>
                                  ) : null}
                                  {it.Notes ? <div>Notes: {it.Notes}</div> : null}
                                </div>
                              </div>

                              {imgs.length > 0 ? (
                                <div className="gallery" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 180, justifyContent: 'flex-end' }}>
                                  {imgs.slice(0, 4).map((src, k) => (
                                    <a key={k} href={src} target="_blank" rel="noreferrer" title="Open full image">
                                      <img src={src} alt={`img-${k}`} className="thumb" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6 }} />
                                    </a>
                                  ))}
                                  {imgs.length > 4 ? (
                                    <div style={{ fontSize: 12, opacity: 0.7, alignSelf: 'center' }}>+{imgs.length - 4} more</div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </>
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