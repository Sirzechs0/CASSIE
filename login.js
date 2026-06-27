// login.js
// Handles the actual sign-in process for login.html

import { auth, db } from "./firebase-config.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const form = document.getElementById("login-form");
const loginButton = document.getElementById("login-button");
const statusMessage = document.getElementById("status-message");
const errorMessage = document.getElementById("error-message");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  // Reset messages each time the form is submitted
  statusMessage.textContent = "Logging in...";
  errorMessage.textContent = "";
  loginButton.disabled = true;

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    // Step 1: Check the email/password against Firebase Authentication
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;

    // Step 2: Look up this user's role in the Firestore "users" collection
    const userDocRef = doc(db, "users", uid);
    const userDocSnap = await getDoc(userDocRef);

    if (userDocSnap.exists()) {
      const role = userDocSnap.data().role;

      // Save the role so other pages can check "who's logged in" without
      // asking Firebase again on every click. Cleared when the tab closes.
      sessionStorage.setItem("cassieRole", role);
      sessionStorage.setItem("cassieEmail", email);

      statusMessage.textContent = `Logged in successfully as ${role}. Redirecting...`;

      // Brief pause so the success message is actually visible before leaving
      setTimeout(() => {
        window.location.href = "index.html";
      }, 800);
    } else {
      // This account exists in Firebase Auth but has no matching role
      // document yet — see the README for how to fix this.
      statusMessage.textContent = "";
      errorMessage.textContent = "This account has no role assigned. Contact the system administrator.";
    }
  } catch (error) {
    statusMessage.textContent = "";

    if (
      error.code === "auth/invalid-credential" ||
      error.code === "auth/wrong-password" ||
      error.code === "auth/user-not-found"
    ) {
      errorMessage.textContent = "Incorrect email or password.";
    } else {
      errorMessage.textContent = "Something went wrong: " + error.message;
    }
  } finally {
    loginButton.disabled = false;
  }
});