// lib/firebase.js
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = { /* ...your config... */ };

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// ✅ TEMP sanity check
console.log('bucket:', getApp().options.storageBucket);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const storage = getStorage(app);

