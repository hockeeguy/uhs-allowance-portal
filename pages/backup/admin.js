// pages/admin.js
import { useEffect, useMemo, useRef, useState } from "react";
import { auth, db, serverTimestamp } from "@/lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, doc, getDocs, setDoc } from "firebase/firestore";
import jsPDF from "jspdf";
import { getDownloadURL, ref as storageRef } from "firebase/storage";
import { storage } from "@/lib/firebase";
import html2canvas from "html2canvas";

const STATUS = ["pending", "reviewed", "approved"];
const deepClone = (x) => JSON.parse(JSON.stringify(x || {}));

const isHttpUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);
const resolveImageUrls = async (arr) => {
  if (!Array.isArray(arr) || !arr.length) return [];
  const out = [];
  for (const v of arr) {
    if (isHttpUrl(v)) { out.push(v); continue; }
    try {
      const url = await getDownloadURL(storageRef(storage, String(v)));
      out.push(url);
    } catch (e) {
      console.warn('Could not resolve storage path to URL:', v, e);
    }
  }
  return out;
};


export default function AdminPage() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [rows, setRows] = useState([]);
  const [editMode, setEditMode] = useState({});
  const [drafts, setDrafts] = useState({});
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const cardsRef = useRef({});

  const adminEmails = useMemo(() => {
    if (typeof window === "undefined") return [];
    const raw = process.env.NEXT_PUBLIC_ADMIN_EMAILS || "";
    return raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  }, []);

  const isAdmin = !!(user?.email && adminEmails.includes(user.email.toLowerCase()));

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u || null);
      setChecking(false);
      if (u && adminEmails.includes((u.email || "").toLowerCase())) {
        const qSnap = await getDocs(collection(db, "selections"));
        const header = [];
        qSnap.forEach(d => header.push({ id: d.id, ...d.data() }));

        // Enrich with subcollection categories and resolve image URLs
        const enriched = [];
        for (const r of header) {
          const selObj = {};
          try {
            const catSnap = await getDocs(collection(db, "selections", r.id, "categories"));
            catSnap.forEach(cd => {
              const cdData = cd.data() || {};
              const items = Array.isArray(cdData.items) ? cdData.items : [];
              selObj[cdData.category || cd.id] = { Items: items };
            });
            // Resolve image URLs
            for (const [cat, blk] of Object.entries(selObj)) {
              const items = Array.isArray(blk.Items) ? blk.Items : [];
              for (let i = 0; i < items.length; i++) {
                const imgs = Array.isArray(items[i].Images) ? items[i].Images : [];
                items[i].Images = await resolveImageUrls(imgs);
              }
            }
          } catch (e) {
            console.warn('Failed to load categories for', r.id, e);
          }
          enriched.push({ ...r, selections: Object.keys(selObj).length ? selObj : (r.selections || {}) });
        }

        setRows(enriched);
        const init = {};
        enriched.forEach(r => {
          init[r.id] = {
            clientName: r.clientName || "",
            email: r.email || "",
            status: r.status || "pending",
            selections: deepClone(r.selections || {})
          };
        });
        setDrafts(init);
      } else {
        setRows([]);
        setDrafts({});
      }
    });
    return () => unsub();
  }, [adminEmails]);

  if (checking) return <div className="container"><p>Loading…</p></div>;
  if (!user) return <div className="container"><p>Please sign in first on the home page.</p></div>;
  if (!isAdmin) return <div className="container"><p>Not authorized. This page is for admin users only.</p></div>;

  const filtered = () => {
    const term = q.trim().toLowerCase();
    return rows.filter(r => {
      const statusOk = !statusFilter || (r.status || "pending") === statusFilter;
      if (!term) return statusOk;
      const hay = (r.clientName || "") + " " + (r.email || "") + " " + JSON.stringify(r.selections || {});
      return statusOk && hay.toLowerCase().includes(term);
    });
  };

  const normalizeItems = (blk) => {
    if (Array.isArray(blk?.Items)) return blk.Items;
    return [{ Link: blk?.Link || "", Type: blk?.Type || "", Notes: blk?.Notes || "", Images: blk?.Images || [] }];
  };

  const toggleEdit = (id, on) => {
    setEditMode(prev => ({ ...prev, [id]: on }));
    if (!on) {
      const src = rows.find(r => r.id === id);
      setDrafts(prev => ({ ...prev, [id]: { clientName: src?.clientName || "", email: src?.email || "", status: src?.status || "pending", selections: deepClone(src?.selections || {}) } }));
    }
  };

  const handleField = (id, category, idx, field, value) => {
    setDrafts(prev => {
      const cur = prev[id] || { selections: {} };
      const cat = deepClone(cur.selections[category] || {});
      const items = normalizeItems(cat);
      items[idx] = { ...(items[idx] || {}), [field]: value };
      return { ...prev, [id]: { ...cur, selections: { ...cur.selections, [category]: { Items: items } } } };
    });
  };

  const addItem = (id, category) => {
    setDrafts(prev => {
      const cur = prev[id] || { selections: {} };
      const cat = deepClone(cur.selections[category] || {});
      const items = normalizeItems(cat);
      items.push({ Link:"", Type:"", Notes:"", Images:[] });
      return { ...prev, [id]: { ...cur, selections: { ...cur.selections, [category]: { Items: items } } } };
    });
  };

  const removeItem = (id, category, idx) => {
    setDrafts(prev => {
      const cur = prev[id] || { selections: {} };
      const cat = deepClone(cur.selections[category] || {});
      const items = normalizeItems(cat);
      items.splice(idx, 1);
      return { ...prev, [id]: { ...cur, selections: { ...cur.selections, [category]: { Items: items } } } };
    });
  };

  const saveRow = async (id) => {
    const d = drafts[id];
    if (!d) return;
    await setDoc(doc(db, "selections", id), {
      clientName: d.clientName || null,
      email: d.email || null,
      status: d.status || "pending",
      selections: d.selections || {},
      updatedAt: serverTimestamp()
    }, { merge: true });
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...d } : r));
    toggleEdit(id, false);
    alert("Saved.");
  };

  const exportAllToCSV = () => {
    const header = ["Client","Email","Category","ItemIndex","Link","Type","Notes","ImagesCount","Status"];
    const rowsCSV = [header];
    rows.forEach(r => {
      const name = r.clientName || r.email || r.id;
      const data = r.selections || {};
      Object.keys(data).forEach(cat => {
        const items = normalizeItems(data[cat] || {});
        items.forEach((it, i) => {
          rowsCSV.push([
            name, r.email || "", cat, i,
            it.Link || "", it.Type || "",
            String(it.Notes || "").replace(/\r?\n/g, " "),
            (it.Images || []).length,
            r.status || "pending"
          ]);
        });
      });
    });
    const csv = rowsCSV.map(r => r.map(f => {
      const s = String(f); const quoted = /[",\n]/.test(s);
      return quoted ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "All_Clients_Selections.csv";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const printPDF = async (id) => {
    const node = cardsRef.current[id];
    if (!node) return;
    const canvas = await html2canvas(node, { scale: 2 });
    const img = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const w = pdf.internal.pageSize.getWidth();
    const h = canvas.height * w / canvas.width;
    pdf.addImage(img, "PNG", 0, 0, w, h);
    pdf.save(`${(rows.find(r => r.id === id)?.clientName || id)}_Selections.pdf`);
  };

  const printAllPDF = async () => {
    const pdf = new jsPDF("p", "mm", "a4");
    let first = true;
    for (const r of filtered()) {
      const node = cardsRef.current[r.id];
      if (!node) continue;
      const canvas = await html2canvas(node, { scale: 2 });
      const img = canvas.toDataURL("image/png");
      const w = pdf.internal.pageSize.getWidth();
      const h = canvas.height * w / canvas.width;
      if (!first) pdf.addPage();
      pdf.addImage(img, "PNG", 0, 0, w, h);
      first = false;
    }
    pdf.save("All_Clients_Selections.pdf");
  };

  return (
    <div className="container grid">
      <div className="header">
        <div className="left">
          <img src="/logo.png" alt="Logo" className="logo" />
          <div>
            <div className="brand-title">Admin Dashboard</div>
            <small>Signed in as {user.email}</small>
          </div>
        </div>
        <div className="row no-print">
          <input placeholder="Search client, email, category, notes…" value={q} onChange={e => setQ(e.target.value)} style={{minWidth:280}} />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn brand" onClick={exportAllToCSV}>Export All CSV</button>
          <button className="btn brand" onClick={printAllPDF}>Print All PDF</button>
          <button className="btn outline" onClick={() => signOut(auth)}>Sign Out</button>
        </div>
      </div>

      {!filtered().length && <p>No matching submissions.</p>}
      {filtered().map(r => {
        const draft = drafts[r.id] || { selections: {} };
        const isEditing = !!editMode[r.id];
        const block = isEditing ? draft : r;
        return (
          <div key={r.id} className="card print-page" ref={el => (cardsRef.current[r.id] = el)}>
            <div className="row" style={{justifyContent:'space-between'}}>
              <div>
                <h2>{isEditing ? (
                  <input value={draft.clientName || ""} onChange={e => setDrafts(p => ({...p, [r.id]: {...p[r.id], clientName: e.target.value}}))} placeholder="Client Name / Project Code" style={{maxWidth: 380}} />
                ) : (r.clientName || r.email || r.id)}</h2>
                <small>{isEditing ? (
                  <input value={draft.email || ""} onChange={e => setDrafts(p => ({...p, [r.id]: {...p[r.id], email: e.target.value}}))} placeholder="client email" style={{maxWidth: 280}} />
                ) : r.email}</small>
                <div><small>Status:&nbsp;</small>{isEditing ? (
                  <select value={draft.status || "pending"} onChange={e => setDrafts(p => ({...p, [r.id]: {...p[r.id], status: e.target.value}}))}>
                    {STATUS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : <strong>{r.status || "pending"}</strong>}</div>
              </div>
              <div className="row no-print">
                {!isEditing && <button className="btn" onClick={() => setEditMode(p => ({...p, [r.id]: true}))}>Edit</button>}
                {isEditing && <button className="btn brand" onClick={() => saveRow(r.id)}>Save</button>}
                {isEditing && <button className="btn outline" onClick={() => setEditMode(p => ({...p, [r.id]: false}))}>Cancel</button>}
                <button className="btn" onClick={() => printPDF(r.id)}>Print PDF</button>
              </div>
            </div>

            <div className="divider" />

            {Object.entries(block.selections || {}).map(([category, blk]) => {
              const items = normalizeItems(blk);
              return (
                <div key={category} className="print-section" style={{marginBottom: 12}}>
                  <h3 style={{margin:'8px 0'}}>{category}</h3>
                  {items.map((item, idx) => (
                    <table key={idx} style={{width:'100%', borderCollapse:'collapse', marginBottom:8}}>
                      <tbody>
                        <tr>
                          <td style={{padding:'6px 8px', border:'1px solid #eee', width:140}}><strong>Type</strong></td>
                          <td style={{padding:'6px 8px', border:'1px solid #eee'}}>
                            {isEditing ? (
                              <input value={item?.Type || ""} onChange={e => handleField(r.id, category, idx, "Type", e.target.value)} placeholder="Type (e.g., LVP, Hardwood)" />
                            ) : (item?.Type || "")}
                          </td>
                        </tr>
                        <tr>
                          <td style={{padding:'6px 8px', border:'1px solid #eee'}}><strong>Link / SKU</strong></td>
                          <td style={{padding:'6px 8px', border:'1px solid #eee'}}>
                            {isEditing ? (
                              <input value={item?.Link || ""} onChange={e => handleField(r.id, category, idx, "Link", e.target.value)} placeholder="Paste product URL or enter SKU" />
                            ) : (item?.Link ? (/^https?:\/\//i.test(item.Link) ? <a href={item.Link} target="_blank" rel="noreferrer">{item.Link}</a> : item.Link) : "")}
                          </td>
                        </tr>
                        <tr>
                          <td style={{padding:'6px 8px', border:'1px solid #eee'}}><strong>Notes</strong></td>
                          <td style={{padding:'6px 8px', border:'1px solid #eee'}}>
                            {isEditing ? (
                              <textarea rows={3} value={item?.Notes || ""} onChange={e => handleField(r.id, category, idx, "Notes", e.target.value)} placeholder="Notes / instructions" />
                            ) : <div style={{whiteSpace:'pre-wrap'}}>{item?.Notes || ""}</div>}
                          </td>
                        </tr>
                        {Array.isArray(item?.Images) && item.Images.length > 0 && (
                          <tr>
                            <td style={{padding:'6px 8px', border:'1px solid #eee', verticalAlign:'top'}}><strong>Images</strong></td>
                            <td style={{padding:'6px 8px', border:'1px solid #eee'}}>
                              <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                                {item.Images.map((src, i) => (
                                  <img key={i} src={src} alt={`img-${i}`} style={{width:96, height:96, objectFit:'cover', borderRadius:8}} />
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  ))}
                  {isEditing && (
                    <div className="row no-print" style={{marginBottom:8}}>
                      <button className="btn" onClick={() => addItem(r.id, category)}>+ Add item</button>
                      {items.length > 1 && items.map((_, i) => (
                        <button key={i} className="btn outline" onClick={() => removeItem(r.id, category, i)}>- Remove item {i+1}</button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
