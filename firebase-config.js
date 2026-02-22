// ============================================================
//   CASINO VLX — FIREBASE CONFIGURATION
//   ➡  Remplace les valeurs ci-dessous par ta vraie config
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection,
  query, orderBy, limit, onSnapshot }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDmInQ1hrEvsX6GOZdZS0rilKTz8gplgoU",
  authDomain:        "v3-casino-vlx.firebaseapp.com",
  projectId:         "v3-casino-vlx",
  storageBucket:     "v3-casino-vlx.firebasestorage.app",
  messagingSenderId: "1072282645695",
  appId:             "1:1072282645695:web:b87d7e03634bb700e5020a",
  measurementId:     "G-9X9ZTNXXKD"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

export { auth, db, googleProvider, GoogleAuthProvider,
  signInWithPopup, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, collection, query,
  orderBy, limit, onSnapshot };
