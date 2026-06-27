// theme.js
// Handles the dark/light mode toggle button on every page.
// Dark is the default — this only needs to act when the user picks "light,"
// or when a returning visitor already saved that preference.

(function () {
  const toggleButton = document.getElementById("theme-toggle");
  if (!toggleButton) return;

  function getCurrentTheme() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  }

  function applyTheme(theme) {
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
      toggleButton.textContent = "🌙"; // shows a moon = "tap to go dark"
    } else {
      document.documentElement.removeAttribute("data-theme");
      toggleButton.textContent = "☀️"; // shows a sun = "tap to go light"
    }
    localStorage.setItem("cassieTheme", theme);
  }

  // Make sure the icon matches whatever theme is already active
  // (the inline script in <head> may have already set this before page load)
  applyTheme(getCurrentTheme());

  toggleButton.addEventListener("click", function () {
    applyTheme(getCurrentTheme() === "light" ? "dark" : "light");
  });
})();