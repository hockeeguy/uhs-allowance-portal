// lib/persistImages.js
import { auth, db, storage } from '@/lib/firebase';
import { ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

function slug(s) {
  return String(s || '').replace(/[^\w\-]+/g, '_').slice(0, 150);
}

// Ensure items array and slot
function ensureItemSlot(items, itemIndex) {
  if (!Array.isArray(items)) items = [];
  while (items.length <= itemIndex) items.push({});
  if (!Array.isArray(items[itemIndex].Images)) items[itemIndex].Images = [];
  return items;
}

/**
 * Uploads a file to Storage and appends the download URL to:
 * selections/{uid}/categories/{categoryId}.items[itemIndex].Images[]
 */
export async function persistItemImage({ categoryId, itemIndex = 0, file }) {
  if (!auth?.currentUser) throw new Error('Not signed in');
  if (!file) throw new Error('No file provided');

  const uid = auth.currentUser.uid;
  const safeCat = slug(categoryId);
  const path = `uploads/${uid}/${safeCat}/${Date.now()}-${file.name}`;

  // Upload to Storage
  const storageRef = sRef(storage, path);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);

  // Upsert Firestore doc and push URL
  const catRef = doc(db, 'selections', uid, 'categories', categoryId);
  const snap = await getDoc(catRef);
  const now = serverTimestamp();

  let items = [];
  if (snap.exists()) {
    const data = snap.data() || {};
    items = Array.isArray(data.items) ? data.items : (Array.isArray(data.Items) ? data.Items : []);
  }

  items = ensureItemSlot(items, itemIndex);
  if (!items[itemIndex].Images.includes(url)) {
    items[itemIndex].Images.push(url);
  }

  await setDoc(catRef, { category: categoryId, items, updatedAt: now }, { merge: true });

  return url;
}

/**
 * Appends an existing https URL to Images[] without uploading.
 */
export async function appendImageUrl({ categoryId, itemIndex = 0, url }) {
  if (!auth?.currentUser) throw new Error('Not signed in');
  if (!url || !/^https?:\/\//i.test(url)) throw new Error('Invalid URL');

  const uid = auth.currentUser.uid;
  const catRef = doc(db, 'selections', uid, 'categories', categoryId);
  const snap = await getDoc(catRef);
  const now = serverTimestamp();

  let items = [];
  if (snap.exists()) {
    const data = snap.data() || {};
    items = Array.isArray(data.items) ? data.items : (Array.isArray(data.Items) ? data.Items : []);
  }

  items = ensureItemSlot(items, itemIndex);
  if (!items[itemIndex].Images.includes(url)) {
    items[itemIndex].Images.push(url);
  }

  await setDoc(catRef, { category: categoryId, items, updatedAt: now }, { merge: true });
}
