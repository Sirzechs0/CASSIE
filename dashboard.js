// dashboard.js
// Shows the most recent real announcement as the dashboard's hero banner.
// If there are no announcements yet, the generic welcome message
// (already in the HTML) just stays visible instead.

import { db } from "./firebase-config.js";
import {
  collection, query, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const hero = document.getElementById("hero");
const heroFallback = document.getElementById("hero-fallback");
const heroImage = document.getElementById("hero-image");
const heroTitle = document.getElementById("hero-title");

async function loadLatestAnnouncement() {
  try {
    const q = query(collection(db, "announcements"), orderBy("timestamp", "desc"), limit(1));
    const snapshot = await getDocs(q);

    if (snapshot.empty) return; // keep showing the generic welcome message

    const data = snapshot.docs[0].data();
    heroImage.src = data.imageUrl;
    heroImage.alt = data.caption || "Latest announcement";
    heroTitle.textContent = data.caption || "New Announcement";

    hero.hidden = false;
    heroFallback.hidden = true;
  } catch (error) {
    // If anything goes wrong, the fallback welcome message is already showing — do nothing.
  }
}

loadLatestAnnouncement();