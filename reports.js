// reports.js — Attendance Reports page (Part 2: data logic)
// • Grade/section tab navigation (mirrors attendance.js)
// • Month navigator, fetches one attendance doc per day of the selected month
// • Overview stat cards, monthly calendar grid, day detail panel
// • Monthly per-student summary table + Print

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, query, orderBy
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// ─── STATE ────────────────────────────────────────────────────────────────────
let allSections     = [];
let currentSection  = null;
let currentStudents = [];
let monthRecords    = {};  // { "2026-07-15": { studentId: {status, timeIn} }, ... } — only days with a doc
let viewYear, viewMonth;   // viewMonth is 0-indexed (Date convention)

const today = new Date();
viewYear  = today.getFullYear();
viewMonth = today.getMonth();

// ─── DOM REFS ─────────────────────────────────────────────────────────────────
const gradeTabs      = document.getElementById("grade-tabs");
const sectionTabs     = document.getElementById("section-tabs");
const monthPicker     = document.getElementById("month-picker");
const monthLabel      = document.getElementById("month-label");
const prevMonthBtn    = document.getElementById("prev-month-btn");
const nextMonthBtn    = document.getElementById("next-month-btn");
const reportMsg       = document.getElementById("report-msg");
const reportContent   = document.getElementById("report-content");

const ovDays    = document.getElementById("ov-days");
const ovAvg     = document.getElementById("ov-avg");
const ovLate    = document.getElementById("ov-late");
const ovPerfect = document.getElementById("ov-perfect");

const reportCalendar = document.getElementById("report-calendar");

const dayDetail      = document.getElementById("day-detail");
const dayDetailTitle = document.getElementById("day-detail-title");
const ddPresent       = document.getElementById("dd-present");
const ddLate          = document.getElementById("dd-late");
const ddAbsent        = document.getElementById("dd-absent");
const ddRate           = document.getElementById("dd-rate");
const dayDetailTbody   = document.getElementById("day-detail-tbody");

const summaryNote  = document.getElementById("summary-note");
const summaryTbody = document.getElementById("summary-tbody");
const printBtn      = document.getElementById("print-btn");

// ─── AUTH (no gated features here, but kept for parity / future role checks) ──
onAuthStateChanged(auth, () => {
  loadSections();
});

// ─── LOAD SECTIONS ────────────────────────────────────────────────────────────
async function loadSections() {
  try {
    const snap = await getDocs(collection(db, "sections"));
    allSections = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.grade - b.grade) || a.name.localeCompare(b.name));
    renderGradeTabs();
  } catch (err) {
    console.error("loadSections failed:", err);
    reportMsg.textContent = `Couldn't load sections: ${err.message}`;
    reportMsg.hidden = false;
  }
}

// ─── GRADE TABS ───────────────────────────────────────────────────────────────
function renderGradeTabs() {
  const grades = [...new Set(allSections.map((s) => s.grade))].sort((a, b) => a - b);
  if (grades.length === 0) {
    reportMsg.textContent = "No attendance data available yet.";
    reportMsg.hidden = false;
    return;
  }
  gradeTabs.innerHTML = "";
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

  reportMsg.hidden    = true;
  monthPicker.hidden  = false;
  reportContent.hidden = false;
  dayDetail.hidden      = true;

  await loadStudents(section.id);
  await loadMonth();
}

// ─── LOAD STUDENTS ────────────────────────────────────────────────────────────
async function loadStudents(sectionId) {
  try {
    const snap = await getDocs(
      query(collection(db, "sections", sectionId, "students"), orderBy("no"))
    );
    currentStudents = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    currentStudents = [];
  }
}

// ─── LOAD MONTH ATTENDANCE ────────────────────────────────────────────────────
// Attendance docs are keyed "{sectionId}_{YYYY-MM-DD}" — one per day. There's no
// query field to filter by month, so we fetch every possible day of the visible
// month in parallel and keep only the ones that actually exist.
async function loadMonth() {
  monthLabel.textContent = new Date(viewYear, viewMonth, 1)
    .toLocaleDateString("en-PH", { month: "long", year: "numeric" });

  reportCalendar.innerHTML =
    `<p class="muted" style="grid-column:1/-1;text-align:center;padding:20px;">Loading...</p>`;
  dayDetail.hidden = true;

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const dateStrs = Array.from({ length: daysInMonth }, (_, i) => toDateStr(viewYear, viewMonth, i + 1));

  monthRecords = {};
  await Promise.all(dateStrs.map(async (dateStr) => {
    try {
      const snap = await getDoc(doc(db, "attendance", `${currentSection.id}_${dateStr}`));
      if (snap.exists()) monthRecords[dateStr] = snap.data().records || {};
    } catch {
      // skip days that fail to load
    }
  }));

  renderOverview();
  renderCalendar();
  renderSummary();
}

function toDateStr(year, monthIdx, day) {
  const mm = String(monthIdx + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

// For a given recorded day, every student is either present/late (has a record)
// or absent (no record at all) — same default used on the Attendance page.
function tallyDay(records) {
  let present = 0, late = 0, absent = 0;
  currentStudents.forEach((student) => {
    const rec = records[student.id];
    const status = rec ? rec.status : "absent";
    if (status === "present") present++;
    else if (status === "late") late++;
    else absent++;
  });
  return { present, late, absent };
}

// CSS can't read a percentage out of text content, so this is how a rate value
// gets turned into a color tier — matches the .rate-great/.rate-good/.rate-poor
// (and .cal-dot equivalents) thresholds defined in style.css: ≥90 / 70–89 / <70.
function rateClass(rate) {
  if (rate >= 90) return "rate-great";
  if (rate >= 70) return "rate-good";
  return "rate-poor";
}

// ─── OVERVIEW CARDS ───────────────────────────────────────────────────────────
function renderOverview() {
  const recordedDates = Object.keys(monthRecords);
  const total = currentStudents.length;

  ovDays.textContent = recordedDates.length;

  if (recordedDates.length === 0 || total === 0) {
    ovAvg.textContent = "—";
    ovLate.textContent = "0";
    ovPerfect.textContent = "0";
    return;
  }

  let rateSum = 0, lateTotal = 0;
  recordedDates.forEach((dateStr) => {
    const { present, late } = tallyDay(monthRecords[dateStr]);
    rateSum += ((present + late) / total) * 100;
    lateTotal += late;
  });

  ovAvg.textContent = `${Math.round(rateSum / recordedDates.length)}%`;
  ovLate.textContent = lateTotal;

  const perfectCount = currentStudents.filter((student) =>
    recordedDates.every((dateStr) => {
      const rec = monthRecords[dateStr][student.id];
      const status = rec ? rec.status : "absent";
      return status !== "absent";
    })
  ).length;
  ovPerfect.textContent = perfectCount;
}

// ─── CALENDAR GRID ────────────────────────────────────────────────────────────
// Cell/label/dot class names below (cal-cell / cal-day-num / cal-dot) are the
// ones style.css actually styles — using different names left this calendar
// rendering completely unstyled.
function renderCalendar() {
  reportCalendar.innerHTML = "";
  const daysInMonth   = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday  = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sun
  const isCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();

  // Leading blanks so day 1 lands under the correct weekday column
  for (let i = 0; i < firstWeekday; i++) {
    const blank = document.createElement("div");
    blank.className = "cal-cell empty";
    reportCalendar.appendChild(blank);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = toDateStr(viewYear, viewMonth, day);
    const records = monthRecords[dateStr];

    const cell = document.createElement("div");
    cell.className = "cal-cell";
    if (isCurrentMonth && day === today.getDate()) cell.classList.add("today");

    const num = document.createElement("span");
    num.className = "cal-day-num";
    num.textContent = day;
    cell.appendChild(num);

    // Every cell gets a dot — colored by rate when there's data, muted "rate-none"
    // when there isn't — so the grid reads consistently instead of half-empty.
    const dot = document.createElement("span");
    dot.className = "cal-dot";

    if (records) {
      const { present, late, absent } = tallyDay(records);
      const total = present + late + absent;
      const rate = total ? Math.round(((present + late) / total) * 100) : 0;

      cell.classList.add("has-data");
      dot.classList.add(rateClass(rate));
      dot.textContent = `${rate}%`;

      cell.addEventListener("click", () => showDayDetail(dateStr, records));
    } else {
      cell.classList.add("no-data");
      dot.classList.add("rate-none");
      dot.textContent = "–";
    }

    cell.appendChild(dot);
    reportCalendar.appendChild(cell);
  }
}

// ─── DAY DETAIL PANEL ─────────────────────────────────────────────────────────
function showDayDetail(dateStr, records) {
  dayDetail.hidden = false;

  const [y, m, d] = dateStr.split("-").map(Number);
  dayDetailTitle.textContent = new Date(y, m - 1, d)
    .toLocaleDateString("en-PH", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const { present, late, absent } = tallyDay(records);
  const total = present + late + absent;
  ddPresent.textContent = present;
  ddLate.textContent    = late;
  ddAbsent.textContent  = absent;
  ddRate.textContent    = total ? `${Math.round(((present + late) / total) * 100)}% Attendance` : "";

  dayDetailTbody.innerHTML = "";
  currentStudents.forEach((student) => {
    const rec    = records[student.id];
    const status = rec ? rec.status : "absent";
    const timeIn = rec && rec.timeIn ? rec.timeIn : "—";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${student.no}</td>
      <td>${student.name}</td>
      <td>${student.gender}</td>
      <td><span class="status-badge ${status}">${status}</span></td>
      <td>${timeIn}</td>`;
    dayDetailTbody.appendChild(tr);
  });

  dayDetail.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ─── MONTHLY PER-STUDENT SUMMARY ──────────────────────────────────────────────
function renderSummary() {
  const recordedDates = Object.keys(monthRecords);
  summaryNote.textContent = recordedDates.length
    ? `Based on ${recordedDates.length} recorded day(s) this month.`
    : "No attendance has been recorded yet for this month.";

  summaryTbody.innerHTML = "";
  currentStudents.forEach((student) => {
    let present = 0, late = 0, absent = 0;
    recordedDates.forEach((dateStr) => {
      const rec = monthRecords[dateStr][student.id];
      const status = rec ? rec.status : "absent";
      if (status === "present") present++;
      else if (status === "late") late++;
      else absent++;
    });
    const total = recordedDates.length;
    const rate  = total ? Math.round(((present + late) / total) * 100) : 0;
    const rateCell = total
      ? `<td class="${rateClass(rate)}">${rate}%</td>`
      : `<td>—</td>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${student.no}</td>
      <td>${student.name}</td>
      <td>${student.gender}</td>
      <td>${present}</td>
      <td>${late}</td>
      <td>${absent}</td>
      ${rateCell}`;
    summaryTbody.appendChild(tr);
  });
}

// ─── MONTH NAVIGATION ─────────────────────────────────────────────────────────
prevMonthBtn.addEventListener("click", () => {
  viewMonth--;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  if (currentSection) loadMonth();
});

nextMonthBtn.addEventListener("click", () => {
  viewMonth++;
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  if (currentSection) loadMonth();
});

// ─── PRINT ────────────────────────────────────────────────────────────────────
printBtn.addEventListener("click", () => {
  window.print();
});