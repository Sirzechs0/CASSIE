// nav.js
// Toggles the mobile navigation menu open/closed when the hamburger
// button is tapped. On desktop this button is hidden entirely (see
// style.css), so this only matters on narrow screens.

(function () {
  const toggle = document.getElementById("nav-toggle");
  const nav = document.querySelector(".site-nav");
  if (!toggle || !nav) return;

  toggle.addEventListener("click", () => {
    nav.classList.toggle("open");
  });

  // Tapping a nav link closes the menu too, instead of leaving it open
  // when the new page loads.
  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => nav.classList.remove("open"));
  });
})();