// attendance.js — Full rewrite with:
// • Y-coordinate PDF extraction (proper line grouping)
// • PCSHS-format parser (MALE/FEMALE headers, no M/F column per row)
// • Multi-section import from a single PDF
// • Grade/section tab navigation
// • Click-to-mark attendance: manual Present → Absent → Late cycle

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

// ─── STATE ────────────────────────────────────────────────────────────────────
let isAdminOrStaff  = false;
let allSections     = [];
let currentSection  = null;
let currentStudents = [];
let attendanceRecs  = {};
let importedSections = []; // [{ grade, sectionName, adviser, room, maleCount, femaleCount, students }]

// ─── TODAY ────────────────────────────────────────────────────────────────────
const today   = new Date();
const dateStr = today.toISOString().split("T")[0];
document.getElementById("attendance-date").textContent =
  today.toLocaleDateString("en-PH", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

// ─── DOM REFS ─────────────────────────────────────────────────────────────────
const gradeTabs           = document.getElementById("grade-tabs");
const sectionTabs         = document.getElementById("section-tabs");
const classHeader         = document.getElementById("class-header");
const classTitle          = document.getElementById("class-title");
const classAdviser        = document.getElementById("class-adviser");
const attendanceTableWrap = document.getElementById("attendance-table-wrap");
const attendanceTbody     = document.getElementById("attendance-tbody");
const attendanceMsg       = document.getElementById("attendance-msg");
const adminTools          = document.getElementById("admin-tools");
const statPresent         = document.getElementById("stat-present");
const statLate            = document.getElementById("stat-late");
const statAbsent          = document.getElementById("stat-absent");
const statTotal           = document.getElementById("stat-total");

// ─── AUTH ─────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    isAdminOrStaff    = false;
    adminTools.hidden = true;
  } else {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const role = snap.exists() ? snap.data().role : null;
      isAdminOrStaff    = role === "admin" || role === "staff";
      adminTools.hidden = !isAdminOrStaff;
    } catch {
      isAdminOrStaff    = false;
      adminTools.hidden = true;
    }
  }
  loadSections();
});

// ─── LOAD SECTIONS ────────────────────────────────────────────────────────────
async function loadSections() {
  try {
    // No orderBy here — composite indexes aren't auto-created on new projects.
    // We sort the result in JavaScript instead, which works without any index.
    const snap = await getDocs(collection(db, "sections"));
    allSections = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.grade - b.grade) || a.name.localeCompare(b.name));
    renderGradeTabs();
  } catch (err) {
    console.error("loadSections failed:", err);
    attendanceMsg.textContent = `Couldn't load sections: ${err.message}`;
    attendanceMsg.hidden = false;
  }
}

// ─── GRADE TABS ───────────────────────────────────────────────────────────────
function renderGradeTabs() {
  const grades = [...new Set(allSections.map((s) => s.grade))].sort((a, b) => a - b);
  if (grades.length === 0) {
    attendanceMsg.textContent = isAdminOrStaff
      ? "No class lists yet. Click \"Import Class List from PDF\" to get started."
      : "No attendance data available yet.";
    attendanceMsg.hidden = false;
    return;
  }
  attendanceMsg.hidden = true;
  gradeTabs.innerHTML  = "";
  grades.forEach((grade, i) => {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "tab-btn";
    btn.textContent = `Grade ${grade}`;
    btn.addEventListener("click", () => selectGrade(grade));
    gradeTabs.appendChild(btn);
    if (i === 0) selectGrade(grade);
  });
}

// ─── SELECT GRADE ─────────────────────────────────────────────────────────────
function selectGrade(grade) {
  gradeTabs.querySelectorAll(".tab-btn").forEach((b) =>
    b.classList.toggle("active", b.textContent === `Grade ${grade}`)
  );
  const sections = allSections.filter((s) => s.grade === grade);
  sectionTabs.innerHTML = "";
  sections.forEach((section, i) => {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "tab-btn";
    btn.textContent = section.name;
    btn.addEventListener("click", () => selectSection(section));
    sectionTabs.appendChild(btn);
    if (i === 0) selectSection(section);
  });
}

// ─── SELECT SECTION ───────────────────────────────────────────────────────────
async function selectSection(section) {
  currentSection = section;
  sectionTabs.querySelectorAll(".tab-btn").forEach((b) =>
    b.classList.toggle("active", b.textContent === section.name)
  );
  let title = `Grade ${section.grade} – ${section.name}`;
  if (section.room) title += ` | Room ${section.room}`;
  if (section.maleCount != null)
    title += ` (${section.maleCount} Male • ${section.femaleCount} Female)`;
  classTitle.textContent   = title;
  classAdviser.textContent = section.adviser ? `Class Adviser: ${section.adviser}` : "";
  classHeader.hidden         = false;
  attendanceTableWrap.hidden = false;
  attendanceMsg.hidden       = true;

  // Show delete section button only to admin/staff
  const deleteSectionBtn = document.getElementById("delete-section-btn");
  if (deleteSectionBtn) {
    deleteSectionBtn.hidden = !isAdminOrStaff;
    deleteSectionBtn.onclick = deleteSection;
  }
  attendanceTbody.innerHTML  =
    `<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--muted)">Loading...</td></tr>`;
  await Promise.all([loadStudents(section.id), loadAttendance(section.id)]);
  renderTable();
}

// ─── LOAD STUDENTS ────────────────────────────────────────────────────────────
async function loadStudents(sectionId) {
  try {
    const snap = await getDocs(
      query(collection(db, "sections", sectionId, "students"), orderBy("no"))
    );
    currentStudents = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch { currentStudents = []; }
}

// ─── LOAD ATTENDANCE ──────────────────────────────────────────────────────────
async function loadAttendance(sectionId) {
  try {
    const snap = await getDoc(doc(db, "attendance", `${sectionId}_${dateStr}`));
    attendanceRecs = snap.exists() ? snap.data().records || {} : {};
  } catch { attendanceRecs = {}; }
}

// ─── RENDER TABLE ─────────────────────────────────────────────────────────────
function renderTable() {
  let present = 0, late = 0, absent = 0;
  attendanceTbody.innerHTML = "";

  // Show/hide the Actions column header based on role
  const actionTh = document.getElementById("action-th");
  if (actionTh) actionTh.hidden = !isAdminOrStaff;

  currentStudents.forEach((student) => {
    const rec    = attendanceRecs[student.id];
    const status = rec ? rec.status : "present";
    const timeIn = rec && rec.timeIn ? rec.timeIn : "—";
    if (status === "present") present++;
    else if (status === "late") late++;
    else absent++;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${student.no}</td>
      <td>${student.name}</td>
      <td>${student.gender}</td>
      <td><span class="status-badge ${status}${isAdminOrStaff ? " clickable" : ""}"
               data-id="${student.id}">${status.toUpperCase()}</span></td>
      <td>${timeIn}</td>
      ${isAdminOrStaff ? `<td><button class="delete-student-btn" data-id="${student.id}" data-name="${student.name}" title="Remove this student">✕ Remove</button></td>` : ""}`;
    attendanceTbody.appendChild(tr);
  });

  statPresent.textContent = present;
  statLate.textContent    = late;
  statAbsent.textContent  = absent;
  statTotal.textContent   = currentStudents.length;

  if (isAdminOrStaff) {
    attendanceTbody.querySelectorAll(".status-badge.clickable").forEach((badge) =>
      badge.addEventListener("click", () => markAttendance(badge.dataset.id))
    );
    attendanceTbody.querySelectorAll(".delete-student-btn").forEach((btn) =>
      btn.addEventListener("click", () => deleteStudent(btn.dataset.id, btn.dataset.name))
    );
  }
}

// ─── MARK ATTENDANCE ──────────────────────────────────────────────────────────
// Manual 3-state cycle: Absent → Present → Late → Absent. It's the secretary's
// call, not the clock's — the old version checked the current time at the
// moment of the click, so clicking any time after the cutoff sent every
// student straight to "late" and "present" became unreachable. Only "Late"
// records a time (worth knowing how late); Present/Absent don't need one.
async function markAttendance(studentId) {
  const rec    = attendanceRecs[studentId];
  const status = rec ? rec.status : "present";
  let newStatus, newTimeIn;

  if (status === "present") {
    newStatus = "late";
    newTimeIn = new Date().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", hour12: true });
  } else if (status === "late") {
    newStatus = "absent";
    newTimeIn = null;
  } else {
    newStatus = "present";
    newTimeIn = null;
  }

  if (newStatus === "present") delete attendanceRecs[studentId];
  else attendanceRecs[studentId] = { status: newStatus, timeIn: newTimeIn };
  
  renderTable();
  try {
    await setDoc(doc(db, "attendance", `${currentSection.id}_${dateStr}`), {
      sectionId: currentSection.id, date: dateStr,
      records: attendanceRecs, updatedAt: serverTimestamp(),
    });
  } catch (e) { console.error("Save failed:", e); }
}

// ─── CONFIRM MODAL (themed replacement for window.confirm) ────────────────────
const confirmModal     = document.getElementById("confirm-modal");
const confirmTitleEl   = document.getElementById("confirm-title");
const confirmMessageEl = document.getElementById("confirm-message");
const confirmOkBtn     = document.getElementById("confirm-ok-btn");
const confirmCancelBtn = document.getElementById("confirm-cancel-btn");

// Shows the shared confirm modal and resolves true/false depending on the
// button clicked — same calling convention as window.confirm(), just async.
function askConfirm({ title = "Are you sure?", message = "", confirmLabel = "Delete" } = {}) {
  return new Promise((resolve) => {
    confirmTitleEl.textContent   = title;
    confirmMessageEl.textContent = message;
    confirmOkBtn.textContent     = confirmLabel;
    confirmModal.hidden = false;

    function settle(result) {
      confirmModal.hidden = true;
      confirmOkBtn.removeEventListener("click", onOk);
      confirmCancelBtn.removeEventListener("click", onCancel);
      confirmModal.removeEventListener("click", onOverlay);
      resolve(result);
    }
    function onOk()       { settle(true); }
    function onCancel()   { settle(false); }
    function onOverlay(e) { if (e.target === confirmModal) settle(false); }

    confirmOkBtn.addEventListener("click", onOk);
    confirmCancelBtn.addEventListener("click", onCancel);
    confirmModal.addEventListener("click", onOverlay);
  });
}

// ─── DELETE ONE STUDENT ───────────────────────────────────────────────────────
async function deleteStudent(studentId, studentName) {
  const confirmed = await askConfirm({
    title: "Remove student?",
    message: `Remove "${studentName}" from this section? This can't be undone.`,
    confirmLabel: "Remove",
  });
  if (!confirmed) return;
  try {
    await deleteDoc(doc(db, "sections", currentSection.id, "students", studentId));
    currentStudents = currentStudents.filter(s => s.id !== studentId);
    if (attendanceRecs[studentId]) {
      delete attendanceRecs[studentId];
      await setDoc(doc(db, "attendance", `${currentSection.id}_${dateStr}`), {
        sectionId: currentSection.id, date: dateStr,
        records: attendanceRecs, updatedAt: serverTimestamp(),
      });
    }
    renderTable();
  } catch (err) {
    console.error("Delete student failed:", err);
    window.alert("Delete failed: " + err.message);
  }
}

// ─── DELETE ENTIRE SECTION ────────────────────────────────────────────────────
async function deleteSection() {
  if (!currentSection) return;
  const label = `Grade ${currentSection.grade} – ${currentSection.name}`;
  const confirmed = await askConfirm({
    title: "Delete this section?",
    message: `Delete the entire "${label}" section? This permanently removes all ${currentStudents.length} students and can't be undone.`,
    confirmLabel: "Delete Section",
  });
  if (!confirmed) return;

  const sectionId = currentSection.id;
  try {
    const studentSnap = await getDocs(collection(db, "sections", sectionId, "students"));
    if (!studentSnap.empty) {
      const BATCH_LIMIT = 499;
      for (let i = 0; i < studentSnap.docs.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        studentSnap.docs.slice(i, i + BATCH_LIMIT).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }
    await deleteDoc(doc(db, "sections", sectionId));
    allSections           = allSections.filter(s => s.id !== sectionId);
    currentSection        = null;
    currentStudents       = [];
    attendanceRecs        = {};
    classHeader.hidden         = true;
    attendanceTableWrap.hidden = true;
    renderGradeTabs();
  } catch (err) {
    console.error("Delete section failed:", err);
    window.alert("Delete failed: " + err.message);
  }
}

// ─── IMPORT MODAL REFS ────────────────────────────────────────────────────────
const importModal     = document.getElementById("import-modal");
const importStep1     = document.getElementById("import-step-1");
const importStep2     = document.getElementById("import-step-2");
const pdfDropzone     = document.getElementById("pdf-dropzone");
const pdfFileInput    = document.getElementById("pdf-file-input");
const pdfDropzoneText = document.getElementById("pdf-dropzone-text");
const pdfParseStatus  = document.getElementById("pdf-parse-status");
const importSaveBtn   = document.getElementById("import-save-btn");
const importCancelBtn = document.getElementById("import-cancel-btn");
const importSaveStatus = document.getElementById("import-save-status");
const importSectionsList = document.getElementById("import-sections-list");
const importSectionsSummary = document.getElementById("import-sections-summary");

function closeImportModal() {
  importModal.hidden = true;
  importedSections   = [];
}

document.getElementById("import-btn").addEventListener("click", () => {
  importModal.hidden       = false;
  importStep1.hidden       = false;
  importStep2.hidden       = true;
  importSaveBtn.hidden     = true;
  pdfParseStatus.textContent  = "";
  importSaveStatus.textContent = "";
  pdfDropzoneText.textContent = "📄 Click to choose a PDF, or drag it here";
  pdfFileInput.value = "";
  importedSections   = [];
  importSectionsList.innerHTML = "";
});
importCancelBtn.addEventListener("click", closeImportModal);
importModal.addEventListener("click", (e) => { if (e.target === importModal) closeImportModal(); });

pdfDropzone.addEventListener("click", () => pdfFileInput.click());
pdfDropzone.addEventListener("dragover", (e) => { e.preventDefault(); pdfDropzone.classList.add("dragover"); });
pdfDropzone.addEventListener("dragleave", () => pdfDropzone.classList.remove("dragover"));
pdfDropzone.addEventListener("drop", (e) => {
  e.preventDefault(); pdfDropzone.classList.remove("dragover");
  if (e.dataTransfer.files[0]) handlePdfFile(e.dataTransfer.files[0]);
});
pdfFileInput.addEventListener("change", () => {
  if (pdfFileInput.files[0]) handlePdfFile(pdfFileInput.files[0]);
});

// ─── HANDLE PDF UPLOAD ────────────────────────────────────────────────────────
async function handlePdfFile(file) {
  if (file.type !== "application/pdf") {
    pdfParseStatus.textContent = "Please upload a PDF file."; return;
  }
  pdfDropzoneText.textContent = `📄 ${file.name}`;
  pdfParseStatus.textContent  = "Reading PDF...";
  try {
    const pages    = await extractTextFromPdf(file);
    const sections = parsePcshsPages(pages);

    if (sections.length === 0) {
      pdfParseStatus.textContent =
        "No sections detected. Make sure this is a text-based (not scanned) PDF.";
      return;
    }

    importedSections = sections;
    renderSectionsInModal(sections);

    importStep2.hidden   = false;
    importSaveBtn.hidden = false;
    pdfParseStatus.textContent =
      `✓ Detected ${sections.length} section(s). Review below then click Save All Sections.`;
  } catch (err) {
    pdfParseStatus.textContent = "Couldn't read PDF: " + err.message;
  }
}

// ─── EXTRACT TEXT FROM PDF (Y-coordinate line grouping) ───────────────────────
async function extractTextFromPdf(file) {
  const buffer = await file.arrayBuffer();
  const pdf    = await window.pdfjsLib.getDocument({ data: buffer }).promise;
  const pages  = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page     = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content  = await page.getTextContent();
    const allItems = content.items.filter(item => item.str.trim());

    // ── Find the actual MALE and FEMALE header positions on this page ──
    // This is far more accurate than guessing the midpoint from page width,
    // because it uses the real column positions the PDF itself defines.
    let maleX = null, femaleX = null;
    for (const item of allItems) {
      const s = item.str.trim().toUpperCase();
      if (s === "MALE"   && maleX   === null) maleX   = item.transform[4];
      if (s === "FEMALE" && femaleX === null) femaleX = item.transform[4];
    }

    // Column split = midpoint between the two table headers.
    // Fall back to page midpoint if headers aren't found on this page.
    const splitX = (maleX !== null && femaleX !== null)
      ? (maleX + femaleX) / 2
      : viewport.width / 2;

    // Helper: group items into rows using gap detection instead of fixed bucket size.
    // Gap-based: a new row starts when the Y drop between consecutive items exceeds 4px.
    // This is more reliable than rounding to a fixed grid because it adapts to however
    // far apart this specific PDF actually places its rows.
    function toLines(items) {
      const filtered = items.filter(i => i.str.trim());
      if (!filtered.length) return "";

      // Sort top-to-bottom (Y descending), left-to-right (X ascending) within each row
      const sorted = [...filtered].sort((a, b) => b.transform[5] - a.transform[5]);

      const rows = [[sorted[0]]];
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i - 1].transform[5] - sorted[i].transform[5];
        if (gap > 4) rows.push([]);          // new row
        rows[rows.length - 1].push(sorted[i]);
      }

      return rows
        .map(row =>
          row.sort((a, b) => a.transform[4] - b.transform[4])
             .map(r => r.str.trim())
             .join(" ")
        )
        .join("\n");
    }

    pages.push({
      fullText:  toLines(allItems),
      leftText:  toLines(allItems.filter(i => i.transform[4] <  splitX)),
      rightText: toLines(allItems.filter(i => i.transform[4] >= splitX)),
    });
  }
  return pages;
}

// ─── PARSE ALL PAGES (one section per page for PCSHS format) ─────────────────
function parsePcshsPages(pages) {
  return pages
    .map(parseSingleSection)
    .filter((s) => s && s.students.length > 0);
}

// ─── PARSE ONE SECTION PAGE ───────────────────────────────────────────────────
// Now receives { fullText, leftText, rightText } from extractTextFromPdf
function parseSingleSection({ fullText, leftText, rightText }) {
  const lines = fullText.split("\n").map((l) => l.trim()).filter(Boolean);

  let grade = null, sectionName = null, adviser = null, room = null;

  for (const line of lines) {
    if (/Republic|Department|Division|Legaspi|CLASS LIST|School Year|PASIG CITY SCIENCE/i.test(line)) continue;

    // "Grade 12 – BERNOULLI" — digits may come as "1 2" from PDF, strip spaces
    if (!grade) {
      const m = line.match(/Grade\s+([\d\s]{1,4})\s*[–\-\u2013\u2014]\s*([A-Z][A-Z]+)/i);
      if (m) {
        grade = parseInt(m[1].replace(/\s/g, ""));
        sectionName = m[2].trim();
      }
    }

    // "Class Adviser: Ms. Elizabeth P. Regencia" — trim ROOM if on same line
    if (!adviser) {
      const m = line.match(/Class\s*Adviser\s*:\s*(.+)/i);
      if (m) adviser = m[1].replace(/\s*ROOM\s*:.*$/i, "").trim();
    }

    // "ROOM: 201"
    if (!room) {
      const m = line.match(/ROOM\s*:\s*(\d+)/i);
      if (m) room = m[1];
    }
  }

  // Extract students from each column separately — this is what fixes the F:0 bug
  const males   = extractStudentsFromColumn(leftText);
  const females = extractStudentsFromColumn(rightText);

  const students = [
    ...males.sort((a, b)   => a.no - b.no).map((s, i) => ({ ...s, no: i + 1,                gender: "M" })),
    ...females.sort((a, b) => a.no - b.no).map((s, i) => ({ ...s, no: males.length + i + 1, gender: "F" })),
  ];

  return { grade, sectionName, adviser, room, maleCount: males.length, femaleCount: females.length, students };
}

// ─── EXTRACT STUDENTS FROM ONE COLUMN (left=male, right=female) ──────────────
function extractStudentsFromColumn(text) {
  const students  = [];
  const lines     = text.split("\n").map(l => l.trim()).filter(Boolean);
  let inStudents  = false;
  let pendingNo   = null; // holds a row-number that arrived without its name yet

  for (const line of lines) {
    // Gender header → begin collecting students
    if (/^(MALE|FEMALE)(\s|$)/i.test(line)) { inStudents = true; continue; }

    // Always skip boilerplate
    if (/LAST\s*NAME|FIRST\s*NAME|MIDDLE\s*NAME/i.test(line)) continue;
    if (/^NO\.?\s*$/i.test(line)) continue;
    if (/Republic|Department|Division|Legaspi|CLASS LIST|School Year|PASIG CITY SCIENCE/i.test(line)) continue;
    if (/Grade\s+\d|Class\s*Adviser|ROOM\s*:/i.test(line)) continue;

    if (!inStudents) continue;

    // ── Case 1: number + name on the same line (ideal) ──
    const sameLine = line.match(/^(\d{1,2})\s+(.+)$/);
    if (sameLine) {
      const name = sameLine[2].trim().replace(/\s+/g, " ");
      if (name.length >= 3 && !/^\d+$/.test(name) && !/LAST NAME|FIRST NAME/.test(name)) {
        students.push({ no: parseInt(sameLine[1]), name });
        pendingNo = null;
      }
      continue;
    }

    // ── Case 2: number alone on its own line ──
    // This happens when the PDF stores the row number and the text at
    // slightly different Y positions, causing Y-grouping to split them.
    const numOnly = line.match(/^(\d{1,2})$/);
    if (numOnly) {
      pendingNo = parseInt(numOnly[1]);
      continue;
    }

    // ── Case 3: text line with no leading number ──
    if (!/^\d/.test(line) && line.length >= 2) {
      if (pendingNo !== null) {
        // This text belongs to the orphaned number from Case 2
        const name = line.replace(/\s+/g, " ").trim();
        if (name.length >= 3 && !/LAST NAME|FIRST NAME/.test(name)) {
          students.push({ no: pendingNo, name });
        }
        pendingNo = null;
      } else if (students.length > 0) {
        // Continuation of previous student's wrapped name (e.g. "BARTOLO"
        // on its own line after "11 LAMSEN, PRINCESS ANNMIEBELLE")
        students[students.length - 1].name += " " + line.replace(/\s+/g, " ").trim();
      }
    }
  }

  return students;
}

// ─── RENDER ALL SECTIONS AS EXPANDABLE CARDS ─────────────────────────────────
function renderSectionsInModal(sections) {
  const totalStudents = sections.reduce((sum, s) => sum + s.students.length, 0);
  importSectionsSummary.textContent =
    `Found ${sections.length} section(s) — ${totalStudents} students total. ` +
    `Click a section to expand and review. Correct anything wrong, then click Save All Sections.`;

  importSectionsList.innerHTML = "";

  sections.forEach((section, idx) => {
    const card = document.createElement("div");
    card.className = "import-section-card";
    card.innerHTML = `
      <div class="import-section-header">
        <span class="import-section-title">
          Grade ${section.grade || "?"} – ${section.sectionName || "Unknown"}
        </span>
        <span class="import-section-meta">
          M: ${section.maleCount} &nbsp;|&nbsp; F: ${section.femaleCount} &nbsp;|&nbsp;
          Total: ${section.students.length}
        </span>
        <span class="import-section-toggle">+</span>
      </div>
      <div class="import-section-body">
        <div class="import-meta-grid">
          <div class="form-field">
            <label>Grade Level</label>
            <input type="number" class="sec-grade" min="7" max="12"
                   value="${section.grade || ""}" placeholder="e.g. 12">
          </div>
          <div class="form-field">
            <label>Section Name</label>
            <input type="text" class="sec-name"
                   value="${section.sectionName || ""}" placeholder="e.g. BERNOULLI">
          </div>
          <div class="form-field">
            <label>Room Number</label>
            <input type="text" class="sec-room"
                   value="${section.room || ""}" placeholder="e.g. 201">
          </div>
          <div class="form-field">
            <label>Class Adviser</label>
            <input type="text" class="sec-adviser"
                   value="${section.adviser || ""}" placeholder="e.g. Ms. Elizabeth P. Regencia">
          </div>
        </div>

        <p style="font-size:0.82rem;color:var(--muted);margin-bottom:8px;">
          <strong>${section.students.length}</strong> students —
          click a name or gender to correct it, ✕ to remove.
        </p>

        <div class="import-preview-wrap">
          <table class="import-preview-table">
            <thead>
              <tr><th>No.</th><th>Name</th><th>M/F</th><th></th></tr>
            </thead>
            <tbody class="sec-tbody" data-idx="${idx}"></tbody>
          </table>
        </div>
        <button type="button" class="btn-secondary add-sec-student-btn"
                data-idx="${idx}" style="margin-top:10px;width:100%;">
          + Add a student manually
        </button>
      </div>`;

    // Toggle expand/collapse
    card.querySelector(".import-section-header").addEventListener("click", () =>
      card.classList.toggle("open")
    );

    // Sync meta field changes back to importedSections state
    card.querySelector(".sec-grade").addEventListener("change", (e) => {
      importedSections[idx].grade = parseInt(e.target.value) || null;
    });
    card.querySelector(".sec-name").addEventListener("change", (e) => {
      importedSections[idx].sectionName = e.target.value.trim().toUpperCase();
    });
    card.querySelector(".sec-room").addEventListener("change", (e) => {
      importedSections[idx].room = e.target.value.trim();
    });
    card.querySelector(".sec-adviser").addEventListener("change", (e) => {
      importedSections[idx].adviser = e.target.value.trim();
    });

    // Render student rows
    renderSectionStudents(card.querySelector(".sec-tbody"), idx);

    // Add student manually
    card.querySelector(".add-sec-student-btn").addEventListener("click", () => {
      importedSections[idx].students.push({
        no: importedSections[idx].students.length + 1,
        name: "", gender: "M",
      });
      renderSectionStudents(card.querySelector(".sec-tbody"), idx);
    });

    importSectionsList.appendChild(card);
  });
}

// ─── RENDER EDITABLE STUDENT ROWS FOR ONE SECTION ────────────────────────────
function renderSectionStudents(tbody, sectionIdx) {
  const students = importedSections[sectionIdx].students;
  tbody.innerHTML = "";
  students.forEach((student, stuIdx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${stuIdx + 1}</td>
      <td><input type="text" value="${student.name}"
           data-sec="${sectionIdx}" data-stu="${stuIdx}" data-field="name"></td>
      <td><input type="text" value="${student.gender}"
           data-sec="${sectionIdx}" data-stu="${stuIdx}" data-field="gender"
           style="width:44px"></td>
      <td><button type="button" class="remove-row-btn"
           data-sec="${sectionIdx}" data-stu="${stuIdx}" title="Remove">✕</button></td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("input").forEach((input) =>
    input.addEventListener("change", (e) => {
      const s = parseInt(e.target.dataset.sec);
      const i = parseInt(e.target.dataset.stu);
      importedSections[s].students[i][e.target.dataset.field] =
        e.target.value.trim().toUpperCase();
    })
  );

  tbody.querySelectorAll(".remove-row-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      const s = parseInt(btn.dataset.sec);
      const i = parseInt(btn.dataset.stu);
      importedSections[s].students.splice(i, 1);
      renderSectionStudents(tbody, s);
    })
  );
}

// ─── SAVE ALL SECTIONS ────────────────────────────────────────────────────────
importSaveBtn.addEventListener("click", async () => {
  // Log immediately so we can confirm the button is actually firing
  console.log("Save All Sections clicked — sections in memory:", importedSections?.length);
  importSaveStatus.textContent = "";
  importSaveStatus.style.color = "var(--muted)";

  // ── Guard 1: sections must exist ──
  if (!importedSections || importedSections.length === 0) {
    window.alert("No sections to save. Please upload a PDF first.");
    return;
  }

  // ── Guard 2: check login directly — don't rely on cached variable ──
  const currentUser = auth.currentUser;
  console.log("Current user:", currentUser?.email, "| isAdminOrStaff:", isAdminOrStaff);
  if (!currentUser) {
    window.alert("You are not logged in.\n\nPlease log in as admin or staff first, then try again.");
    return;
  }
  if (!isAdminOrStaff) {
    window.alert("Your account does not have admin or staff permissions.\n\nMake sure your user document in Firestore has role: \"admin\" or role: \"staff\".");
    return;
  }

  // ── Guard 3: validate each section ──
  for (let i = 0; i < importedSections.length; i++) {
    const s = importedSections[i];
    const g = parseInt(s.grade);
    if (!g || g < 7 || g > 12) {
      window.alert(`Section ${i + 1}: Grade Level is missing or invalid (must be 7–12).\n\nOpen that card and correct it.`);
      return;
    }
    if (!s.sectionName?.trim()) {
      window.alert(`Section ${i + 1}: Section Name is missing.\n\nOpen the card and fill it in.`);
      return;
    }
  }

  importSaveBtn.disabled       = true;
  importSaveStatus.textContent = `Saving ${importedSections.length} section(s) — please wait...`;
  let saved = 0;

  try {
    for (const section of importedSections) {
      const grade     = parseInt(section.grade);
      const name      = section.sectionName.trim().toUpperCase();
      const sectionId = `grade${grade}_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
      const maleCount   = section.students.filter(s => s.gender === "M").length;
      const femaleCount = section.students.filter(s => s.gender === "F").length;

      console.log(`→ Saving ${sectionId}: ${maleCount}M + ${femaleCount}F`);

      await setDoc(doc(db, "sections", sectionId), {
        grade, name,
        room:    section.room    || "",
        adviser: section.adviser || "",
        maleCount, femaleCount,
        updatedAt: serverTimestamp(),
      });

      // ── Delete any existing students first ──
      // Using addDoc creates new IDs every save, so repeated imports pile up.
      // Wiping first ensures each import is a clean replacement, not an addition.
      const existingStudents = await getDocs(collection(db, "sections", sectionId, "students"));
      if (!existingStudents.empty) {
        const delBatch = writeBatch(db);
        existingStudents.docs.forEach(d => delBatch.delete(d.ref));
        await delBatch.commit();
        console.log(`  cleared ${existingStudents.size} old student docs`);
      }

      const BATCH_LIMIT = 499;
      for (let i = 0; i < section.students.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        section.students.slice(i, i + BATCH_LIMIT).forEach((student, j) => {
          batch.set(doc(collection(db, "sections", sectionId, "students")), {
            no:     i + j + 1,
            name:   student.name   || "",
            gender: student.gender || "M",
          });
        });
        await batch.commit();
        console.log(`   batch ${Math.floor(i / BATCH_LIMIT) + 1} done`);
      }

      saved++;
      importSaveStatus.textContent = `Saved ${saved} of ${importedSections.length} sections...`;
    }

    importSaveStatus.style.color = "var(--ink)";
    importSaveStatus.textContent = `✓ All ${saved} section(s) saved! The tabs will appear now.`;
    await loadSections();
    setTimeout(closeImportModal, 2500);

  } catch (err) {
    console.error("Save error:", err);

    // Give the most useful message possible for the most common cause
    let msg;
    if (err.code === "permission-denied" || err.message?.toLowerCase().includes("permission")) {
      msg = "PERMISSION DENIED\n\n" +
        "Your Firestore security rules do not allow writes to the 'sections' collection.\n\n" +
        "Fix: Go to Firebase Console → Firestore Database → Rules tab, paste the full rules block from the README, then click Publish. Try saving again after that.";
    } else {
      msg = `Save failed: ${err.message}\n\nOpen browser DevTools (F12) → Console tab for details.`;
    }

    window.alert(msg);
    importSaveStatus.style.color = "var(--error)";
    importSaveStatus.textContent = err.code === "permission-denied"
      ? "❌ Permission denied — update Firestore rules (see README)."
      : `❌ ${err.message}`;
  } finally {
    importSaveBtn.disabled = false;
  }
});