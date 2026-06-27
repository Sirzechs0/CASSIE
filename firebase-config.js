// firebase-config.js
// This file connects your website to your Firebase project.
// Every page that needs login or database access imports from THIS file,
// so the connection details only ever live in one place.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA7YX3B81im7bX3l6ATd7td03lRHHNAoGw",
  authDomain: "cassie-pcshs-daf3f.firebaseapp.com",
  projectId: "cassie-pcshs-daf3f",
  storageBucket: "cassie-pcshs-daf3f.firebasestorage.app",
  messagingSenderId: "610709940904",
  appId: "1:610709940904:web:2ba86dab6d50080bdd709d"
};

const app = initializeApp(firebaseConfig);

// Other files import these two — auth (login) and db (database).
export const auth = getAuth(app);
export const db = getFirestore(app);