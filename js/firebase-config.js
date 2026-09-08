// ============================================================
//  PIZZA BIANOS – Firebase Configuration
//  Replace the values below with your actual Firebase project
//  credentials from: https://console.firebase.google.com
// ============================================================

import { initializeApp }         from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth }               from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore }          from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── YOUR FIREBASE PROJECT CONFIG ──────────────────────────
//  Steps to get this:
//  1. Go to https://console.firebase.google.com
//  2. Create a project named "pizza-bianos-inventory"
//  3. Add a Web App
//  4. Copy the firebaseConfig object and paste it here
const firebaseConfig = {
  apiKey: "AIzaSyBPmbFzWJbCq-8X4KlZr1AomiyRBDhwb0Y",
  authDomain: "pizza-bianos-inventory.firebaseapp.com",
  projectId: "pizza-bianos-inventory",
  storageBucket: "pizza-bianos-inventory.firebasestorage.app",
  messagingSenderId: "136283753517",
  appId: "1:136283753517:web:72a8cf19c03874e0a8fca4",
  measurementId: "G-M7WMVQ680D"
};

// ── Initialize Firebase ────────────────────────────────────
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

export { app, auth, db };
