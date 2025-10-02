import { useEffect, useMemo, useState, useRef } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { auth, db, googleProvider } from '@/lib/firebase';
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, signInWithPopup
} from 'firebase/auth';
import {
  collection,
  doc,
  setDoc,
  serverTimestamp,
  writeBatch,
  getDoc // <-- only include if you actually use this in the file
} from 'firebase/firestore';

import { getStorage, ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage';
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
const storage = getStorage();

const CATEGORIES = [
  "Flooring Type", "Backsplash Tile", "Shower Surround Tile", "Cabinets",
  "Cabinet Pulls", "Bathroom Vanities", "Plumbing Fixtures",
  "Electrical Fixtures", "Countertops", "Paint Color", "Appliances",
  "Interior Doors", "Exterior Doors", "Garage Doors", "Windows",
  "Interior Trim & Mouldings", "Closet Shelving Systems", "Mirrors",
  "Hardware", "Exterior Finishes", "Roofing Material", "Gutters, Soffit & Fascia",
  "Landscaping & Exterior Hardscapes", "Lighting Package"
];
const FLOORING = ["Hardwood", "LVP", "Tile", "Carpet"];

export default function AllowanceSelectionApp() {
  const [user, setUser] = useState(null);
// ---- Option B helpers ----
const catId = (name) => (name || "Uncategorized").replace(/[^\w\-]+/g, "_").slice(0, 150);

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

useState(null);
  const [loading, setLoading] = useState(true);
  const [clientName, setClientName] = useState('');
  const [selections, setSelections] = useState({});
  const [tab, setTab] = useState(CATEGORIES[0]);
  const pdfRef = useRef(null);

  const adminEmails = useMemo(() => {
    if (typeof window === 'undefined') return [];
    const raw = process.env.NEXT_PUBLIC_ADMIN_EMAILS || '';
    return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }, []);

  const isAdmin = !!(user?.email && adminEmails.includes(user.email.toLowerCase()));

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u || null);
      setLoading(false);
      if (u) {
        setClientName(u.displayName || u.email?.split('@')[0] || '');
        const ref = doc(db, 'selections', u.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) setSelections(snap.data().selections || {});
      } else {
        setSelections({});
      }
    });
    return () => unsub();
  }, [adminEmails]);

  // ----- Exports -----
  const exportToPDF = async (name = clientName, data = selections) => {
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

  // ----- Save & Submit (with token refresh to avoid auth/invalid-credential) -----
  
const saveSelections = async () => {
  if (!user) { alert('Please sign in first.'); return false; }
  try {
    await auth.currentUser.getIdToken(true);
    const batch = writeBatch(db);

    // tiny header doc used by Admin list
    const headerRef = doc(db, 'selections', user.uid);
    const headerSummary = {};
    for (const [cat, block] of Object.entries(selections || {})) {
      const items = Array.isArray(block?.Items) ? block.Items : [];
      headerSummary[cat] = { count: items.length };
    }
    batch.set(headerRef, sanitizeForFirestore({
      uid: user.uid,
      email: user.email || null,
      clientName: clientName || user.displayName || user.email,
      status: 'pending',
      categories: headerSummary,
      updatedAt: serverTimestamp()
    }), { merge: true });

    // full details per category
    const catCol = collection(db, 'selections', user.uid, 'categories');
    for (const [cat, block] of Object.entries(selections || {})) {
      const items = Array.isArray(block?.Items)
        ? block.Items
        : [{
            Link: block?.Link || '',
            Type: block?.Type || '',
            Notes: block?.Notes || '',
            Images: Array.isArray(block?.Images) ? block.Images : []
          }];

      const normalizedItems = items.map(it => ({
        Link: it?.Link ?? '',
        Type: it?.Type ?? '',
        Notes: it?.Notes ?? '',
        // IMPORTANT: URLs only — no File objects
        Images: Array.isArray(it?.Images) ? it.Images.filter(u => typeof u === 'string') : []
      }));

      batch.set(doc(catCol, catId(cat)), sanitizeForFirestore({
        category: cat,
        items: normalizedItems,
        updatedAt: serverTimestamp()
      }), { merge: true });
    }

    await batch.commit();
    alert('Selections saved.');
    return true;
  } catch (e) {
    console.error('Save error details:', { code: e?.code, message: e?.message, name: e?.name });
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


  if (loading) return <div className="container"><p>Loading…</p></div>;
  if (!user) return <div className="container"><AuthForm /></div>;

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

      <label>Client Name / Project Code</label>
      <input
        id="clientName"
        name="clientName"
        value={clientName}
        onChange={e => setClientName(e.target.value)}
        placeholder="e.g., Smith - 104 Meadow Dr"
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

          const onUpload = (idx, files) => {
            const arr = Array.from(files || []);
            arr.forEach(file => {
              const reader = new FileReader();
              reader.onloadend = () => {
                setSelections(prev => {
                  const current = prev[tab] || {};
                  const list = Array.isArray(current.Items) ? [...current.Items] : [...items];
                  const imgs = Array.isArray(list[idx]?.Images) ? [...list[idx].Images] : [];
                  imgs.push(reader.result);
                  list[idx] = { ...(list[idx] || {}), Images: imgs };
                  return { ...prev, [tab]: { Items: list } };
                });
              };
              reader.readAsDataURL(file);
            });
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
                  />

                  <label htmlFor={`images-${i}`}>Upload Product Images</label>
                  <input
                    id={`images-${i}`}
                    name={`images-${i}`}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={e => onUpload(i, e.target.files)}
                  />
                  <div className="gallery">
                    {(it.Images || []).map((src, k) => <img key={k} src={src} className="thumb" alt={`img-${k}`} />)}
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

      <div className="row" style={{justifyContent:'flex-end'}}>
        <button className="btn" onClick={saveSelections}>Save Draft</button>
        <button className="btn brand" onClick={submitSelections}>Submit Selections</button>
      </div>
    </div>
  );
}

function AuthForm() {
  const [email, setEmail] = useState('');
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
        <input id="email" name="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="••••••••" />
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
