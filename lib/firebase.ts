import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// 빌드/SSR 시점에 env vars 없으면 lazy 초기화 (런타임에서만 init)
const isConfigured = !!firebaseConfig.apiKey;

const app: FirebaseApp | undefined = isConfigured
  ? (getApps().length ? getApp() : initializeApp(firebaseConfig))
  : undefined;

export const auth = (app ? getAuth(app) : (undefined as any)) as Auth;
export const db = (app ? getFirestore(app) : (undefined as any)) as Firestore;
export const storage = (app ? getStorage(app) : (undefined as any)) as FirebaseStorage;
export { app };
