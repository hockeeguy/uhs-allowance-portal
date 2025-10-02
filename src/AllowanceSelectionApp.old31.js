// ======= TOP OF FILE (imports) =======
'use client';
// --- Helper: sanitize items so Firestore never sees sentinels inside arrays ---
function sanitizeItemsForFirestore(items) {
  const arr = Array.isArray(items) ? items : [];
  return arr.map((it) => {
    const out = {
      Type: it?.Type ?? it?.type ?? '',
      Link: it?.Link ?? it?.link ?? '',
      Notes: it?.Notes ?? it?.notes ?? '',
    };
    let imgs = [];
    if (Array.isArray(it?.Images)) imgs = it.Images.slice();
    else if (Array.isArray(it?.images)) imgs = it.images.slice();
    else if (typeof it?.Image === 'string') imgs = [it.Image];
    else if (typeof it?.image === 'string') imgs = [it.image];
    out.Images = imgs.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u));
    return out;
  });
}


import React, { useEffect, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

import { auth, db, storage, googleProvider } from '@/lib/firebase';

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signOut
} from 'firebase/auth';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';

import { ref as sRef, uploadBytes, uploadBytesResumable, getDownloadURL } from 'firebase/storage';


export default function AllowanceSelectionApp() {
  // ── Existing app state (keep what you already had) ───────────────────────────
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  // add/keep your own app state here (categories, form data, etc.)
  // const [categories, setCategories] = useState({});
  // ...more state

// Upload images → get public URLs → push into local state so Save/Submit writes them
// categoryName: string in UI (e.g., "Flooring Type")
// itemIndex: which item under that category (0-based)
// fileList: e.target.files from the <input type="file" multiple />
// --- image uploader: previews immediately, then replaces with Storage URLs ---


  // Must be signed in or Storage rules will reject the write
// INSIDE export default function AllowanceSelectionApp() { ... }
// right after your useState/useEffect lines

  // Client-side image compression
  async function compressImage(file, opts = { maxDimension: 1600, quality: 0.82, format: 'image/webp' }) {
    if (!file || !file.type || !file.type.startsWith('image/')) return file;
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = objectUrl;
      });
      const { width, height } = img;
      const maxDim = opts.maxDimension || 1600;
      let targetW = width, targetH = height;
      if (Math.max(width, height) > maxDim) {
        const scale = maxDim / Math.max(width, height);
        targetW = Math.round(width * scale);
        targetH = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = targetW; canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, targetW, targetH);
      const type = opts.format || 'image/webp';
      const q = typeof opts.quality === 'number' ? opts.quality : 0.82;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, q));
      if (!blob) return file;
      const newName = file.name.replace(/\.(jpg|jpeg|png|gif|heic|heif|webp)$/i, '.webp');
      return new File([blob], newName, { type: blob.type, lastModified: Date.now() });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }


function handleUploadImages(catName, itemIndex, fileList) {
  if (!fileList || !fileList.length) return;
  if (!auth?.currentUser) {
    alert('Please sign in before uploading images.');
    return;
  }

  // local previews
  const previews = Array.from(fileList)
    .filter(f => f.type?.startsWith('image/'))
    .map(f => URL.createObjectURL(f));
  if (previews.length) {
    setSelections(prev => {
      const cat = prev[catName] || { Items: [] };
      const items = Array.isArray(cat.Items) ? [...cat.Items] : [];
      const current = items[itemIndex] || { Link:'', Type:'', Notes:'', Images:[] };
      const imgs = Array.isArray(current.Images) ? [...current.Images] : [];
      previews.forEach(p => imgs.push(p));
      items[itemIndex] = { ...current, Images: imgs };
      return { ...prev, [catName]: { Items: items } };
    });
  }

  (async () => {
    try {
      await auth.currentUser.getIdToken(true);
      const uid = auth.currentUser.uid;
      const safeCat = (catName || 'Uncategorized').replace(/[^\w\-]+/g, '_').slice(0, 150);

      for (const orig of Array.from(fileList)) {
        if (!orig.type?.startsWith('image/')) continue;

        // compress
        let toUpload = orig;
        try { toUpload = await compressImage(orig, { maxDimension: 1600, quality: 0.82, format: 'image/webp' }); } catch {}
        if (toUpload.size > 1.6 * 1024 * 1024) {
          try { toUpload = await compressImage(toUpload, { maxDimension: 1280, quality: 0.76, format: 'image/webp' }); } catch {}
        }

        const path = `uploads/${uid}/${safeCat}/${Date.now()}_${toUpload.name || orig.name}`;
        const ref = sRef(storage, path);
        setPendingUploads(prev => prev + 1);

        await new Promise((resolve, reject) => {
          const task = uploadBytesResumable(ref, toUpload, { contentType: toUpload.type || orig.type });
          task.on('state_changed',
            () => {},
            async (err) => {
              setPendingUploads(prev => Math.max(0, prev - 1));
              if (err && err.code === 'storage/retry-limit-exceeded') {
                try {
                  await auth.currentUser.getIdToken(true);
                  const altPath = `uploads/${uid}/${safeCat}/${Date.now()}_${Math.random().toString(36).slice(2)}_${toUpload.name || orig.name}`;
                  const altRef = sRef(storage, altPath);
                  setPendingUploads(prev => prev + 1);
                  const task2 = uploadBytesResumable(altRef, toUpload, { contentType: toUpload.type || orig.type });
                  task2.on('state_changed', () => {}, (err2) => {
                    setPendingUploads(prev => Math.max(0, prev - 1));
                    reject(err2 || err);
                  }, async () => {
                    const url2 = await getDownloadURL(altRef);
                    setSelections(prev => {
                      const cat = prev[catName] || { Items: [] };
                      const items = Array.isArray(cat.Items) ? [...cat.Items] : [];
                      const current = items[itemIndex] || { Link:'', Type:'', Notes:'', Images:[] };
                      const imgs = Array.isArray(current.Images) ? [...current.Images] : [];
                      const idx = imgs.findIndex(src => typeof src === 'string' && src.startsWith('blob:'));
                      if (idx >= 0) imgs[idx] = url2; else imgs.push(url2);
                      items[itemIndex] = { ...current, Images: imgs };
                      return { ...prev, [catName]: { Items: items } };
                    });
                    setPendingUploads(prev => Math.max(0, prev - 1));
                    resolve();
                  });
                } catch {
                  reject(err);
                }
              } else {
                reject(err);
              }
            },
            async () => {
              try {
                const url = await getDownloadURL(ref);
                setSelections(prev => {
                  const cat = prev[catName] || { Items: [] };
                  const items = Array.isArray(cat.Items) ? [...cat.Items] : [];
                  const current = items[itemIndex] || { Link:'', Type:'', Notes:'', Images:[] };
                  const imgs = Array.isArray(current.Images) ? [...current.Images] : [];
                  const idx = imgs.findIndex(src => typeof src === 'string' && src.startsWith('blob:'));
                  if (idx >= 0) imgs[idx] = url; else imgs.push(url);
                  items[itemIndex] = { ...current, Images: imgs };
                  return { ...prev, [catName]: { Items: items } };
                });
              } finally {
                setPendingUploads(prev => Math.max(0, prev - 1));
              }
              resolve();
            }
          );
        });
      }

      setTimeout(() => { try { saveSelections(); } catch (e) { console.error('autosave failed', e); } }, 250);
    } catch (err) {
      console.error('[storage] upload failed:', err);
      setPendingUploads(prev => Math.max(0, prev - 1));
      alert(`Image upload failed: ${err?.code || err?.message || 'unknown error'}`);
    }
  })();
}



// ---- Config / Constants ----
const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || 'david.gould@unityhomesolutions.net,maxwell.malone@unityhomesolutions.net,kellie.locke@unityhomesolutions.net')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

const CATEGORIES = [
  "Flooring Type","Backsplash Tile","Shower Surround Tile","Cabinets","Cabinet Pulls","Bathroom Vanities",
  "Plumbing Fixtures","Electrical Fixtures","Countertops","Paint Color","Appliances","Windows","Doors - Interior",
  "Doors - Exterior","Doors - Garage"
];

const FLOORING = ["Hardwood","LVP","Tile","Carpet"];

// ---- Helpers ----
const catId = (name) =>
  (name || "Uncategorized").replace(/[^\w\-]+/g, "_").slice(0, 150);

const sanitizeForFirestore = (val) => {
  const OMIT = Symbol('omit');
  if (val === undefined) return OMIT;
  if (val === null) return null;
  const t = typeof val;
  if (t === 'string' || t === 'number' || t === 'boolean') return val;
  if (t === 'function') return OMIT;
  if (Array.isArray(val)) return val.map(sanitizeForFirestore).filter(v => v !== OMIT);
  if (typeof File !== 'undefined' && val instanceof File) return OMIT;
  if (typeof Blob !== 'undefined' && val instanceof Blob) return OMIT;
  if (typeof FileList !== 'undefined' && val instanceof FileList) return OMIT;
  if (val && t === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      const sv = sanitizeForFirestore(v);
      if (sv !== OMIT) out[k] = sv;
    }
    return out;
  }
  return OMIT;
};

// ======= COMPONENT START =======


  // --- state/hooks ---
  const [loading, setLoading] = useState(true);
  const [clientName, setClientName] = useState('');
  const [tab, setTab] = useState(CATEGORIES[0]);
  const [selections, setSelections] = useState({});
  const [uploading, setUploading] = useState(false);
  
  const [pendingUploads, setPendingUploads] = useState(0);
const pdfRef = useRef(null);

  const isAdmin = !!(user?.email && adminEmails.includes(user.email.toLowerCase()));

  // ---- Auth listener & initial load ----
  useEffect(() => {
  if (typeof window === 'undefined') return; // don't run on server
  const unsub = onAuthStateChanged(auth, (u) => {
    setUser(u || null);
    setAuthReady(true);
  });
  return () => unsub();
}, []);
// example of any Firestore load:
useEffect(() => {
  if (!authReady || !user) return;
  // ... safe Firestore work here ...
}, [authReady, user]);

// Early returns in render:
if (!authReady) {
  return <div>Loading...</div>;
}

if (!user) { return <div className="container"><AuthForm /></div>; }

  // ---- Upload images to Firebase Storage (Option B) ----
  const onUpload = async (categoryName, itemIndex, fileList) => {
    if (!auth.currentUser || !fileList?.length) return;
    setUploading(true);
    const uid = auth.currentUser.uid;
    try {
      for (const file of Array.from(fileList)) {
        if (!file.type.startsWith('image/')) continue;
        if (file.size > 8 * 1024 * 1024) { alert(file.name + ' is over 8MB.'); continue; }
        const safeCat = catId(categoryName);
        const path = `uploads/${uid}/${safeCat}/${Date.now()}_${file.name}`;
        const ref = sRef(storage, path);
        await uploadBytes(ref, file);
        const url = await getDownloadURL(ref);
        setSelections(prev => {
          const cat = prev[categoryName] || {};
          const items = Array.isArray(cat.Items) ? [...cat.Items] : [];
          const current = items[itemIndex] || { Link:'', Type:'', Notes:'', Images:[] };
          const imgs = Array.isArray(current.Images) ? [...current.Images] : [];
          imgs.push(url);
          items[itemIndex] = { ...current, Images: imgs };
          return { ...prev, [categoryName]: { Items: items } };
        });
      }
    } catch (e) {
      console.error('Upload error:', e);
      alert('Image upload failed.');
    } finally {
      setUploading(false);
    }
  };

  // === SAVE: writes a small header doc + per-category docs (Option B) ===
  const saveSelections = async () => {
    if (!user) { alert('Please sign in first.'); return false; }
    try {
      await auth.currentUser.getIdToken(true);

      // Normalize to Items[] arrays per category
      const normalizedByCat = {};
      for (const [cat, block] of Object.entries(selections || {})) {
        let items = Array.isArray(block?.Items) ? block.Items : [];
        if (!items.length) {
          const single = {
            Link: block?.Link ?? "",
            Type: block?.Type ?? "",
            Notes: block?.Notes ?? "",
            Images: Array.isArray(block?.Images) ? block.Images : []
          };
          if (single.Link || single.Type || single.Notes || single.Images.length) items = [single];
        }
        const safeItems = items.map(it => ({
  Link: it?.Link || '',
  Type: it?.Type || '',
  Notes: it?.Notes || '',
  // only permanent URLs get stored
  Images: Array.isArray(it?.Images)
    ? it.Images.filter(u => typeof u === 'string' && u.startsWith('http'))
    : [],
}));

        normalizedByCat[cat] = { Items: safeItems };
      }

      const batch = writeBatch(db);

      // Header summary doc for Admin list
      const headerRef = doc(db, 'selections', user.uid);
      const headerSummary = {};
      for (const [cat, block] of Object.entries(normalizedByCat)) {
        headerSummary[cat] = { count: block.Items.length };
      }
      batch.set(headerRef, {
        uid: user.uid,
        email: user.email || null,
        clientName: clientName || user.displayName || user.email,
        status: 'pending',
        categories: headerSummary,
        updatedAt: serverTimestamp()
      }, { merge: true });

      // Per-category detail docs
      const catCol = collection(db, 'selections', user.uid, 'categories');
      for (const [cat, block] of Object.entries(normalizedByCat)) {
        batch.set(
          doc(catCol, catId(cat)),
          { category: cat, items: block.Items, updatedAt: serverTimestamp() },
          { merge: true }
        );
      }

      await batch.commit();
      alert('Selections saved.');
      return true;
    } catch (e) {
      console.error('Save error details:', e);
      alert(
        e?.code === 'permission-denied' ? 'You don’t have permission to save.' :
        (e?.code === 'unauthenticated' || e?.code === 'auth/invalid-credential') ? 'Session expired. Please sign in again.' :
        'Could not save. See console for details.'
      );
      return false;
    }
  };

  const submitSelections = async () => {
    const ok = await saveSelections();
    if (!ok) return;
    try {
      await fetch('/api/send-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName, email: user?.email || '' })
      });
    } catch (e) {
      console.error('Email notify failed', e);
    }
    alert('Selections submitted.');
  };

  // CSV Export
  function exportToCSV(name = clientName, data = selections) {
    const rows = [["Category","ItemIndex","Link","Type","Notes","ImagesCount"]];
    Object.keys(data || {}).forEach(category => {
      const blk = data[category] || {};
      const items = Array.isArray(blk.Items)
        ? blk.Items
        : [ { Link: blk.Link||"", Type: blk.Type||"", Notes: blk.Notes||"", Images: blk.Images||[] } ];
      items.forEach((it, i) => {
        rows.push([
          category,
          i,
          it.Link || "",
          it.Type || "",
          (it.Notes || "").replace(/\r?\n/g, " "),
          (it.Images || []).length
        ]);
      });
    });

    const csv = rows
      .map(r => r.map(field => {
        const f = String(field);
        const needsQuotes = /[",\n]/.test(f);
        const escaped = f.replace(/"/g, '""');
        return needsQuotes ? `"${escaped}"` : escaped;
      }).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name || "client"}_Selections.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // PDF Export
  const exportToPDF = async (name = clientName) => {
    const node = pdfRef.current;
    if (!node) return;
    const canvas = await html2canvas(node, { scale: 2 });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
    pdf.save(`${name || 'client'}_Selections.pdf`);
  };
return (
    <div className="container grid">
      <div className="header">
        <div className="left">
          <img src="/logo.png" alt="Logo" className="logo" />
          <div>
            <div className="brand-title">Client Selection Portal</div>
            <small>Signed in as {user.email}</small>
          </div>
        </div>
        <div className="row no-print">
          <button className="btn brand" onClick={() => exportToPDF()}>Export PDF</button>
          <button className="btn outline" onClick={() => exportToCSV()}>Export CSV</button>
          {isAdmin ? (<a className="btn outline" href="/admin">Admin</a>) : null}
          <button className="btn outline" onClick={() => signOut(auth)}>Sign Out</button>
        </div>
      </div>

      <label>Client Name & Address </label>
      <input
        id="clientName"
        name="clientName"
        value={clientName}
        onChange={e => setClientName(e.target.value)}
        placeholder="e.g., Smith - 104 Meadow Dr"
        autoComplete="organization"
      />

      <div className="tabs">
        {CATEGORIES.map(c => (
          <div key={c} className={`tab ${tab === c ? 'active' : ''}`} onClick={() => setTab(c)}>{c}</div>
        ))}
      </div>

      <div className="card" ref={pdfRef}>
        <h2>{tab}</h2>
        {(() => {
          const cat = selections[tab] || {};
          const items = Array.isArray(cat.Items)
            ? cat.Items
            : [{ Link: cat.Link || "", Type: cat.Type || "", Notes: cat.Notes || "", Images: cat.Images || [] }];

          const setItem = (idx, field, value) => {
            const arr = Array.isArray(cat.Items) ? [...cat.Items] : [...items];
            arr[idx] = { ...(arr[idx] || {}), [field]: value };
            setSelections(prev => ({ ...prev, [tab]: { Items: arr } }));
          };

          const addItem = () => {
            const arr = Array.isArray(cat.Items) ? [...cat.Items] : [...items];
            arr.push({ Link:"", Type:"", Notes:"", Images:[] });
            setSelections(prev => ({ ...prev, [tab]: { Items: arr } }));
          };

          const removeItem = (idx) => {
            const arr = Array.isArray(cat.Items) ? [...cat.Items] : [...items];
            arr.splice(idx, 1);
            setSelections(prev => ({ ...prev, [tab]: { Items: arr } }));
          };

          return (
            <div>
              {items.map((it, i) => (
                <div key={i} className="card" style={{borderStyle:'dashed', marginBottom:8}}>
                  <h3>Item {i+1}</h3>

                  {tab === 'Flooring Type' && (
                    <div>
                      <label htmlFor={`flooringType-${i}`}>Flooring Choice</label>
                      <select
                        id={`flooringType-${i}`}
                        name={`flooringType-${i}`}
                        onChange={e => setItem(i, 'Type', e.target.value)}
                        value={it.Type || ''}
                        autoComplete="off"
                      >
                        <option value="">-- Select --</option>
                        {FLOORING.map(x => <option key={x} value={x}>{x}</option>)}
                      </select>
                    </div>
                  )}

                  {tab !== 'Flooring Type' && (
                    <>
                      <label htmlFor={`type-${i}`}>Type / Model</label>
                      <input
                        id={`type-${i}`}
                        name={`type-${i}`}
                        placeholder="Model, style, color…"
                        value={it.Type || ''}
                        onChange={e => setItem(i, 'Type', e.target.value)}
                        autoComplete="off"
                      />
                    </>
                  )}

                  <label htmlFor={`link-${i}`}>Product Link or SKU</label>
                  <input
                    id={`link-${i}`}
                    name={`link-${i}`}
                    placeholder="Paste product URL or enter SKU"
                    value={it.Link || ''}
                    onChange={e => setItem(i, 'Link', e.target.value)}
                    autoComplete="off"
                  />

                  <label htmlFor={`images-${i}`}>Upload Product Images</label>
<input
  id={`images-${i}`}
  name={`images-${i}`}
  type="file"
  accept="image/*"
  multiple
 onChange={(e) => handleUploadImages(tab, i, e.target.files)}
/>
<div className="gallery">
  {(it.Images || []).map((src, k) => (
    <img key={k} src={src} className="thumb" alt={`img-${k}`} />
  ))}
</div>


                  <label htmlFor={`notes-${i}`}>Notes / Instructions</label>
                  <textarea
                    id={`notes-${i}`}
                    name={`notes-${i}`}
                    rows={3}
                    placeholder="Any special instructions"
                    value={it.Notes || ''}
                    onChange={e => setItem(i, 'Notes', e.target.value)}
                  />

                  {items.length > 1 && <button className="btn outline" onClick={() => removeItem(i)}>- Remove Item</button>}
                </div>
              ))}
              <button className="btn" onClick={addItem}>+ Add another item</button>
            </div>
          );
        })()}
      </div>

      {pendingUploads>0 && (<div className="card" style={{marginTop:8, borderColor:"#d97706"}}><small>Uploading images… ({pendingUploads})</small></div>)}

      <div className="row" style={{justifyContent:'flex-end'}}>
        <button className="btn" onClick={saveSelections} disabled={pendingUploads>0}>Save Draft</button>
        <button className="btn brand" onClick={submitSelections} disabled={pendingUploads>0}>Submit Selections</button>
      </div>
    </div>
  );
}

// ======= AUTH FORM =======
function AuthForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  async function handleEmailSignIn(e) {
    e.preventDefault();
    try {
      setAuthLoading(true);
      setAuthError('');
      await signInWithEmailAndPassword(auth, email.trim(), password);
      // onAuthStateChanged will update `user`
    } catch (err) {
      console.error('Email sign-in error:', err);
      setAuthError(err?.message || 'Sign-in failed');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    try {
      setAuthLoading(true);
      setAuthError('');
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Google sign-in error:', err);
      setAuthError(err?.message || 'Google sign-in failed');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    try {
      setAuthLoading(true);
      setAuthError('');
      await createUserWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      console.error('Register error:', err);
      setAuthError(err?.message || 'Registration failed');
    } finally {
      setAuthLoading(false);
    }
  }

  // ⬇️ Keep the rest of your file below this line (effects, handlers, return, etc.)
  // For example, your guarded Firestore effect should be placed AFTER this block:
  // useEffect(() => {
  //   if (!authReady || !user) return;
  //   // safe Firestore reads/writes...
  // }, [authReady, user]);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const login = async () => { setBusy(true); setErr(''); try { await signInWithEmailAndPassword(auth, email, pw); } catch(e) { setErr(e.message); } setBusy(false); };
  const signup = async () => { setBusy(true); setErr(''); try { await createUserWithEmailAndPassword(auth, email, pw); } catch(e) { setErr(e.message); } setBusy(false); };
  const google = async () => { setBusy(true); setErr(''); try { await signInWithPopup(auth, googleProvider); } catch(e) { setErr(e.message); } setBusy(false); };

  return (
    <div className="container" style={{ maxWidth: 520 }}>
      <div className="header" style={{marginBottom:16}}>
        <div className="left">
          <img src="/logo.png" alt="Logo" className="logo" />
          <div className="brand-title">Unity Home Solutions</div>
        </div>
      </div>
      <div className="card">
        <h1>Sign In</h1>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
        {err && <small style={{color:'#b91c1c'}}>{err}</small>}
        <div className="row" style={{marginTop:8}}>
          <button className="btn" onClick={login} disabled={busy}>Sign In</button>
          <button className="btn outline" onClick={signup} disabled={busy}>Sign Up</button>
          <button className="btn outline" onClick={google} disabled={busy}>Google</button>
        </div>
      </div>
    </div>
  );
}
