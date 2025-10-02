// lib/firebase.js
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage, setMaxUploadRetryTime, setMaxOperationRetryTime } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, // e.g. ...firebasestorage.app
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// IMPORTANT: use the bucket exactly from env
const forcedBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
export const storage = forcedBucket
  ? getStorage(app, `gs://${forcedBucket}`)
  : getStorage(app);

// Optional: surface failures faster during debug
try {
  setMaxUploadRetryTime(storage, 30000);
  setMaxOperationRetryTime(storage, 30000);
} catch {}

console.log('[firebase] projectId:', app?.options?.projectId);
console.log('[firebase] storageBucket (from config):', app?.options?.storageBucket);
console.log('[firebase] storage forced bucket:', forcedBucket || '(default)');

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
