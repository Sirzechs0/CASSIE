// faqs.js
// Public: search + browse FAQs as an expandable accordion.
// Admin/staff: a form above to add new ones, plus a delete option per item.

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  collection, addDoc, getDocs, deleteDoc, doc, getDoc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const faqAdmin = document.getElementById("faq-admin");
const faqForm = document.getElementById("faq-form");
const faqQuestion = document.getElementById("faq-question");
const faqAnswer = document.getElementById("faq-answer");
const faqStatus = document.getElementById("faq-status");
const faqSaveBtn = document.getElementById("faq-save-btn");
const faqSearch = document.getElementById("faq-search");
const faqList = document.getElementById("faq-list");

let isAdminOrStaff = false;
let allFaqs = [];

// ---------- Show/hide the admin form based on login + role ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    faqAdmin.hidden = true;
    isAdminOrStaff = false;
    renderFaqs();
    return;
  }
  try {
    const userDocSnap = await getDoc(doc(db, "users", user.uid));
    const role = userDocSnap.exists() ? userDocSnap.data().role : null;
    isAdminOrStaff = role === "admin" || role === "staff";
    faqAdmin.hidden = !isAdminOrStaff;
    renderFaqs();
  } catch {
    faqAdmin.hidden = true;
    isAdminOrStaff = false;
  }
});

// ---------- Load all FAQs ----------
async function loadFaqs() {
  faqList.innerHTML = "<p class='muted'>Loading FAQs...</p>";
  try {
    const q = query(collection(db, "faqs"), orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);
    allFaqs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderFaqs();
  } catch (error) {
    faqList.innerHTML = "<p class='muted'>Couldn't load FAQs right now.</p>";
  }
}

// ---------- Render the (filtered) list as an accordion ----------
function renderFaqs() {
  const searchTerm = faqSearch.value.trim().toLowerCase();
  const filtered = allFaqs.filter(
    (faq) =>
      faq.question.toLowerCase().includes(searchTerm) ||
      faq.answer.toLowerCase().includes(searchTerm)
  );

  if (filtered.length === 0) {
    faqList.innerHTML = `<p class="muted">${allFaqs.length === 0 ? "No FAQs yet." : "No matching FAQs."}</p>`;
    return;
  }

  faqList.innerHTML = "";
  filtered.forEach((faq) => {
    const item = document.createElement("div");
    item.className = "faq-item";

    const questionBtn = document.createElement("button");
    questionBtn.type = "button";
    questionBtn.className = "faq-question";

    const questionText = document.createElement("span");
    questionText.textContent = faq.question;
    const icon = document.createElement("span");
    icon.className = "faq-icon";
    icon.textContent = "+";

    questionBtn.appendChild(questionText);
    questionBtn.appendChild(icon);
    questionBtn.addEventListener("click", () => item.classList.toggle("open"));

    const answerDiv = document.createElement("div");
    answerDiv.className = "faq-answer";
    const answerText = document.createElement("p");
    answerText.textContent = faq.answer;
    answerDiv.appendChild(answerText);

    if (isAdminOrStaff) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "faq-delete-btn";
      deleteBtn.textContent = "Delete this FAQ";
      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (confirm("Delete this FAQ?")) {
          await deleteDoc(doc(db, "faqs", faq.id));
          loadFaqs();
        }
      });
      answerDiv.appendChild(deleteBtn);
    }

    item.appendChild(questionBtn);
    item.appendChild(answerDiv);
    faqList.appendChild(item);
  });
}

faqSearch.addEventListener("input", renderFaqs);

// ---------- Add a new FAQ ----------
faqForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  faqSaveBtn.disabled = true;
  faqStatus.textContent = "Saving...";

  try {
    await addDoc(collection(db, "faqs"), {
      question: faqQuestion.value.trim(),
      answer: faqAnswer.value.trim(),
      createdAt: serverTimestamp()
    });
    faqStatus.textContent = "FAQ added.";
    faqForm.reset();
    loadFaqs();
  } catch (error) {
    faqStatus.textContent = "Something went wrong: " + error.message;
  } finally {
    faqSaveBtn.disabled = false;
  }
});

loadFaqs();