// announcements.js
// Handles two things on the Announcements page:
//  1. Showing the upload form only if the logged-in user is admin/staff.
//  2. Loading and displaying all announcements for everyone to see.

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  collection, addDoc, getDocs, query, orderBy, doc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// ⬇️ Paste your ImgBB API key between the quotes below.
const IMGBB_API_KEY = "d40920dd92b750f2a83459dcff350957";

const uploadSection = document.getElementById("upload-section");
const uploadForm = document.getElementById("upload-form");
const uploadStatus = document.getElementById("upload-status");
const uploadButton = document.getElementById("upload-button");
const feedContainer = document.getElementById("announcements-feed");

const dropzone = document.getElementById("upload-dropzone");
const dropzoneText = document.getElementById("upload-dropzone-text");
const fileInput = document.getElementById("pubmat-file");
const previewImg = document.getElementById("upload-preview");
const removeBtn = document.getElementById("remove-preview-btn");

// ---------- Facebook-style upload zone: click, drag-drop, preview, remove ----------
dropzone.addEventListener("click", () => fileInput.click());

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  if (e.dataTransfer.files.length) {
    fileInput.files = e.dataTransfer.files;
    showPreview(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener("change", () => {
  if (fileInput.files.length) {
    showPreview(fileInput.files[0]);
  }
});

removeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.value = "";
  previewImg.hidden = true;
  previewImg.src = "";
  dropzoneText.hidden = false;
  removeBtn.hidden = true;
});

function showPreview(file) {
  const reader = new FileReader();
  reader.onload = () => {
    previewImg.src = reader.result;
    previewImg.hidden = false;
    dropzoneText.hidden = true;
    removeBtn.hidden = false;
  };
  reader.readAsDataURL(file);
}

// ---------- Part 1: show/hide the upload form based on login + role ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    uploadSection.hidden = true;
    return;
  }
  try {
    const userDocSnap = await getDoc(doc(db, "users", user.uid));
    const role = userDocSnap.exists() ? userDocSnap.data().role : null;
    uploadSection.hidden = !(role === "admin" || role === "staff");
  } catch {
    uploadSection.hidden = true;
  }
});

// ---------- Part 2: load and display the public feed ----------
async function loadAnnouncements() {
  feedContainer.innerHTML = "<p class='muted'>Loading announcements...</p>";

  try {
    const q = query(collection(db, "announcements"), orderBy("timestamp", "desc"));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      feedContainer.innerHTML = "<p class='muted'>No announcements yet.</p>";
      return;
    }

    feedContainer.innerHTML = "";
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();

      const card = document.createElement("div");
      card.className = "announcement-card";

      const img = document.createElement("img");
      img.src = data.imageUrl;
      img.alt = data.caption || "Announcement";

      const caption = document.createElement("p");
      caption.textContent = data.caption || "";

      card.appendChild(img);
      card.appendChild(caption);
      feedContainer.appendChild(card);
    });
  } catch (error) {
    feedContainer.innerHTML = "<p class='muted'>Couldn't load announcements right now.</p>";
  }
}

loadAnnouncements();

// ---------- Part 3: handle posting a new announcement ----------
uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const captionInput = document.getElementById("pubmat-caption");
  const file = fileInput.files[0];

  if (!file) {
    uploadStatus.textContent = "Please choose an image first.";
    return;
  }

  uploadButton.disabled = true;
  uploadStatus.textContent = "Uploading image...";

  try {
    const imageUrl = await uploadToImgBB(file);

    uploadStatus.textContent = "Saving announcement...";

    await addDoc(collection(db, "announcements"), {
      imageUrl: imageUrl,
      caption: captionInput.value.trim(),
      postedBy: auth.currentUser.email,
      timestamp: serverTimestamp()
    });

    uploadStatus.textContent = "Announcement posted successfully.";
    uploadForm.reset();
    previewImg.hidden = true;
    previewImg.src = "";
    dropzoneText.hidden = false;
    removeBtn.hidden = true;
    loadAnnouncements();
  } catch (error) {
    uploadStatus.textContent = "Something went wrong: " + error.message;
  } finally {
    uploadButton.disabled = false;
  }
});

// ---------- Helper: upload a file to ImgBB and get back a public URL ----------
async function uploadToImgBB(file) {
  const base64 = await fileToBase64(file);

  const formData = new FormData();
  formData.append("image", base64);

  const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
    method: "POST",
    body: formData
  });

  const result = await response.json();

  if (!result.success) {
    throw new Error("Image upload failed. Check your ImgBB API key.");
  }

  return result.data.url;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}