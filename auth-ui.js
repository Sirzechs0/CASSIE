// auth-ui.js
// Runs on every page. Swaps "Log In" for "Log Out" in the header depending
// on whether someone is actually signed in to Firebase right now — this is
// what makes your login status visible, instead of being invisible like before.

import { auth } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

const loginLink = document.getElementById("login-link");
const logoutButton = document.getElementById("logout-button");

onAuthStateChanged(auth, (user) => {
  if (!loginLink || !logoutButton) return; // page doesn't have these elements

  if (user) {
    loginLink.hidden = true;
    logoutButton.hidden = false;
  } else {
    loginLink.hidden = false;
    logoutButton.hidden = true;
  }
});

logoutButton?.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});