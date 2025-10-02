'use client';

import React, { useEffect, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

// If you don't use the @ alias, change to a relative path like '../lib/firebase'
import { auth, db, storage, googleProvider } from '@/lib/firebase';

import { onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut } from 'firebase/auth';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage';

// ---- Constants ----
const CATEGORIES = [
  "Flooring Type","Backsplash Tile","Shower Surround Tile","Cabinets","Cabinet Pulls","Bathroom Vanities",
  "Lighting","Plumbing","Appliances","Interior Paint","Exterior Paint","Mirrors","Accessories",
  "Roof","Windows","Exterior Doors","Interior Doors","Siding","Gutters","HVAC","Water Heater","Miscellaneous"
];

function catId(name) {
  return String(name || 'Uncategorized').replace(/[^\w\-]+/g, '_').slice(0, 100);
}

function AuthForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleEmailSignIn(e) {
    e.preventDefault();
    try {
      setBusy(true); setErr('');
      await signInWithEmailAndPassword(auth, String(email).trim(), String(password));
    } catch (error) {
      setErr(error && error.message ? error.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }
  async function handleGoogleSignIn() {
    try {
      setBusy(true); setErr('');
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      setErr(error && error.message ? error.message : 'Google sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 420, margin: '40px auto' }}>
      <h2 style={{ marginBottom: 8 }}>Sign In</h2>
      <form onSubmit={handleEmailSignIn} className="auth-form">
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" required />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required />
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign In'}</button>
      </form>
      <div style={{ marginTop: 10 }}>
        <button className="btn outline" onClick={handleGoogleSignIn} disabled={busy}>Continue with Google</button>
      </div>
      {err ? <div className="card" style={{ marginTop: 10, borderColor: '#b91c1c' }}><p style={{ margin: 0 }}>{err}</p></div> : null}
    </div>
  );
}

export default function AllowanceSelectionApp() {
  // ---- Auth ----
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(function(){
    if (typeof window === 'undefined') return;
    const unsub = onAuthStateChanged(auth, function(u){
      setUser(u || null);
      setAuthReady(true);
      setLoading(false);
    });
    return function(){ unsub(); };
  }, []);

  // ---- Selections state ----
  // Structure: { [categoryName]: { Items: [ { Type, Link, Notes, Images: [urls] } ] } }
  const [selections, setSelections] = useState({});
  const [activeTab, setActiveTab] = useState(CATEGORIES[0]);
  const pdfRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  function getItemsForTab(tab) {
    const block = selections[tab] || { Items: [] };
    const arr = Array.isArray(block.Items) ? block.Items.slice() : [];
    if (arr.length === 0) arr.push({ Type:'', Link:'', Notes:'', Images:[] });
    return arr;
  }

  function setItem(tab, idx, field, value) {
    setSelections(function(prev){
      const p = prev || {};
      const block = p[tab] && Array.isArray(p[tab].Items) ? { Items: p[tab].Items.slice() } : { Items: [] };
      while (block.Items.length <= idx) block.Items.push({ Type:'', Link:'', Notes:'', Images:[] });
      const current = block.Items[idx] || { Type:'', Link:'', Notes:'', Images:[] };
      const next = Object.assign({}, current, { [field]: value });
      block.Items[idx] = next;
      const out = Object.assign({}, p, { [tab]: block });
      return out;
    });
  }

  function addItem(tab) {
    setSelections(function(prev){
      const p = prev || {};
      const block = p[tab] && Array.isArray(p[tab].Items) ? { Items: p[tab].Items.slice() } : { Items: [] };
      block.Items.push({ Type:'', Link:'', Notes:'', Images:[] });
      return Object.assign({}, p, { [tab]: block });
    });
  }

  function removeItem(tab, idx) {
    setSelections(function(prev){
      const p = prev || {};
      const block = p[tab] && Array.isArray(p[tab].Items) ? { Items: p[tab].Items.slice() } : { Items: [] };
      if (idx >= 0 && idx < block.Items.length) block.Items.splice(idx, 1);
      return Object.assign({}, p, { [tab]: block });
    });
  }

  // Upload with instant preview + logs
  async function handleUpload(tab, idx, filesLike) {
    // Accept FileList or Array
    var list = [];
    if (filesLike && typeof filesLike.length === 'number') {
      for (var z=0; z<filesLike.length; z++) list.push(filesLike[z]);
    }
    if (!list.length) { console.warn('[upload] no files'); return; }
    if (!auth || !auth.currentUser) { alert('Please sign in to upload.'); return; }
    setUploading(true);
    try {
      const uid = auth.currentUser.uid;
      const safe = catId(tab);
      for (let i=0; i<list.length; i++) {
        const file = list[i];
        if (!file) continue;
        console.log('[upload] picked', file.name, file.type, file.size);
        if (!file.type || file.type.indexOf('image/') !== 0) { console.warn('[upload] skip non-image', file.type); continue; }
        if (file.size > 8*1024*1024) { alert(file.name + ' is over 8MB'); continue; }

        // 1) Show INSTANT preview
        const previewUrl = URL.createObjectURL(file);
        setSelections(function(prev){
          const p = prev || {};
          const block = p[tab] && Array.isArray(p[tab].Items) ? { Items: p[tab].Items.slice() } : { Items: [] };
          while (block.Items.length <= idx) block.Items.push({ Type:'', Link:'', Notes:'', Images:[] });
          const it = block.Items[idx] || { Type:'', Link:'', Notes:'', Images:[] };
          const imgs = Array.isArray(it.Images) ? it.Images.slice() : [];
          if (imgs.indexOf(previewUrl) === -1) imgs.push(previewUrl);
          block.Items[idx] = Object.assign({}, it, { Images: imgs });
          return Object.assign({}, p, { [tab]: block });
        });

        // 2) Upload to Storage
        const path = 'uploads/' + uid + '/' + safe + '/' + Date.now() + '_' + file.name;
        console.log('[upload] storage path', path);
        const ref = sRef(storage, path);
        await uploadBytes(ref, file);
        console.log('[upload] upload complete', file.name);
        const url = await getDownloadURL(ref);
        console.log('[upload] download URL', url);

        // 3) Replace preview with final https URL
        setSelections(function(prev){
          const p = prev || {};
          const block = p[tab] && Array.isArray(p[tab].Items) ? { Items: p[tab].Items.slice() } : { Items: [] };
          while (block.Items.length <= idx) block.Items.push({ Type:'', Link:'', Notes:'', Images:[] });
          const it = block.Items[idx] || { Type:'', Link:'', Notes:'', Images:[] };
          const imgs = Array.isArray(it.Images) ? it.Images.slice() : [];
          const j = imgs.indexOf(previewUrl);
          if (j !== -1) { imgs[j] = url; } else if (imgs.indexOf(url) === -1) { imgs.push(url); }
          block.Items[idx] = Object.assign({}, it, { Images: imgs });
          return Object.assign({}, p, { [tab]: block });
        });

        try { URL.revokeObjectURL(previewUrl); } catch(_) {}
      }
      alert('Image(s) uploaded. Don\'t forget to Save or Submit.');
    } catch (e) {
      console.error('[upload] error', e);
      alert('Image upload failed: ' + (e && e.message ? e.message : 'unknown'));
    } finally {
      setUploading(false);
    }
  }

  async function saveOrSubmit(mode) {
    if (!auth || !auth.currentUser) { alert('Please sign in.'); return; }
    setSaving(true);
    try {
      console.log('[saveOrSubmit] start', mode);
      const uid = auth.currentUser.uid;
      const headerRef = doc(db, 'selections', uid);

      // Build header summary and normalize detail docs
      const headerSummary = {};
      const detailDocs = [];
      for (let c = 0; c < CATEGORIES.length; c++) {
        const cat = CATEGORIES[c];
        const block = selections[cat] && Array.isArray(selections[cat].Items) ? { Items: selections[cat].Items } : null;
        if (block && block.Items && block.Items.length) {
          headerSummary[cat] = { count: block.Items.length };
          const cleanItems = block.Items.map(function(it){
            const images = Array.isArray(it.Images) ? it.Images.filter(function(u){ return typeof u === 'string' && /^https?:\/\//i.test(u); }) : [];
            return {
              Type: it.Type || '',
              Link: it.Link || '',
              Notes: it.Notes || '',
              Images: images,
              updatedAt: serverTimestamp()
            };
          });
          detailDocs.push({ cat, items: cleanItems });
        }
      }

      // 1) Write header doc
      await setDoc(headerRef, {
        uid: uid,
        email: auth.currentUser.email || null,
        clientName: auth.currentUser.displayName || auth.currentUser.email || null,
        status: mode === 'submit' ? 'submitted' : 'draft',
        categories: headerSummary,
        updatedAt: serverTimestamp()
      }, { merge: true });
      console.log('[saveOrSubmit] header written');

      // 2) Write each category doc
      const catCol = collection(db, 'selections', uid, 'categories');
      for (let i = 0; i < detailDocs.length; i++) {
        const entry = detailDocs[i];
        await setDoc(
          doc(catCol, catId(entry.cat)),
          { category: entry.cat, items: entry.items, updatedAt: serverTimestamp() },
          { merge: true }
        );
        console.log('[saveOrSubmit] wrote category', entry.cat);
      }

      alert(mode === 'submit' ? 'Selections submitted.' : 'Selections saved.');
    } catch (e) {
      console.error('[saveOrSubmit] error', e);
      alert('Failed to save selections: ' + (e && e.message ? e.message : 'unknown error'));
    } finally {
      setSaving(false);
    }
  }

  // PDF Export (optional)
  async function exportToPDF() {
    const node = pdfRef.current;
    if (!node) return;
    const canvas = await html2canvas(node, { scale: 2 });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
    pdf.save('Selections.pdf');
  }

  if (loading || !authReady) return <div className="container"><p>Loading…</p></div>;
  if (!user) return <div className="container"><AuthForm /></div>;

  // ---- UI ----
  const items = getItemsForTab(activeTab);

  return (
    <div className="container">
      <div className="header">
        <div className="left">
          <img src="/logo.png" alt="Logo" className="logo" />
          <div>
            <div className="brand-title">Allowance Selections</div>
            <small>Signed in as {user.email}</small>
          </div>
        </div>
        <div className="row no-print">
          {/* Admin button intentionally removed */}
          <button className="btn outline" onClick={function(){ signOut(auth); }}>Sign Out</button>
        </div>
      </div>

      <div className="tabs" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {CATEGORIES.map(function(cat) {
          var active = cat === activeTab;
          return (
            <button key={cat} className={active ? 'tab active' : 'tab'} onClick={function(){ setActiveTab(cat); }}>
              {cat}
            </button>
          );
        })}
      </div>

      <div className="card" ref={pdfRef}>
        <h2 style={{ marginBottom: 8 }}>{activeTab}</h2>

        {items.map(function(it, i) {
          const inputKey = 'file-' + i + '-' + (activeTab || 'cat');
          return (
            <div key={i} className="card" style={{ borderStyle: 'dashed', marginBottom: 8 }}>
              <h3>Item {i+1}</h3>

              <label htmlFor={'type-'+i}>Type/Model</label>
              <input id={'type-'+i} value={it.Type || ''} onChange={function(e){ setItem(activeTab, i, 'Type', e.target.value); }} />

              <label htmlFor={'link-'+i}>Link/SKU</label>
              <input id={'link-'+i} value={it.Link || ''} onChange={function(e){ setItem(activeTab, i, 'Link', e.target.value); }} />

              <label htmlFor={'notes-'+i}>Notes</label>
              <textarea id={'notes-'+i} rows={3} value={it.Notes || ''} onChange={function(e){ setItem(activeTab, i, 'Notes', e.target.value); }} />

              {/* Hidden file input + button to trigger it */}
              <input
                ref={function(el){ if (!fileRefs.current) fileRefs.current = {}; fileRefs.current[inputKey] = el; }}
                id={inputKey}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={function(e){
                  var files = e && e.target && e.target.files ? e.target.files : null;
                  handleUpload(activeTab, i, files);
                  // Do not clear the value; leave the chosen filename in the UI if using a visible input
                }}
              />
              <button className="btn outline" onClick={function(){
                var node = (fileRefs.current && fileRefs.current[inputKey]) ? fileRefs.current[inputKey] : null;
                if (node && typeof node.click === 'function') node.click();
              }}>
                + Add photos
              </button>

              {Array.isArray(it.Images) && it.Images.length > 0 ? (
                <div className="gallery" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {it.Images.map(function(src, k){
                    return <img key={k} src={src} className="thumb" alt={'img-'+k} style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6 }} />;
                  })}
                </div>
              ) : null}
            </div>
          );
        })}

        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={function(){ addItem(activeTab); }}>+ Add another item</button>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button className="btn" onClick={function(){ saveOrSubmit('save'); }} disabled={saving}>
          {saving ? 'Saving…' : 'Save Draft'}
        </button>
        <button className="btn brand" onClick={function(){ saveOrSubmit('submit'); }} disabled={saving}>
          {saving ? 'Working…' : 'Submit Selections'}
        </button>
        <button className="btn outline" onClick={exportToPDF}>Export PDF</button>
      </div>
    </div>
  );
}
