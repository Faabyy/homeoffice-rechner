"use strict";

// Chooses the design (stylesheet) before the page is drawn: loaded in <head> right after the
// stylesheets <link id="css-modern">, <link id="css-klassisch"> and <link id="css-warm">, it
// disables the ones not chosen. It also applies the colour scheme: automatic (system setting),
// or light/dark chosen explicitly via <html data-scheme>, which the stylesheets honour. Both
// choices are per browser (localStorage) and changed in Einstellungen → Darstellung.
// Finally it gives <meta name="theme-color"> (the Android status bar of the installed app) the
// colour at the top of the page, so the bar blends in with every design and colour scheme.

const Design = (() => {
  const KEY = "design";
  const DESIGNS = { modern: "Modern", klassisch: "Klassisch", warm: "Warm" };
  const DEFAULT = "modern";
  const SCHEME_KEY = "farbmodus";
  const SCHEMES = { auto: "Automatisch (wie das System)", light: "Hell", dark: "Dunkel" };
  // Page background per design and scheme (body background in the stylesheets: keep in sync). Used for
  // theme-color while the page is still loading, so the app's system bars never start out white.
  const PAGE_COLORS = {
    modern: { light: "#ffffff", dark: "#16181d" },
    klassisch: { light: "#e2ddd2", dark: "#0c0f13" },
    warm: { light: "#f5f3ec", dark: "#1c1b1a" },
  };

  function stored(key, allowed, fallback) {
    try {
      const value = localStorage.getItem(key);
      return Object.prototype.hasOwnProperty.call(allowed, value) ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function remember(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch { /* not remembered, but still applied for this page */ }
  }

  function scheme() {
    return stored(SCHEME_KEY, SCHEMES, "auto");
  }

  function applyScheme(name) {
    if (name === "auto") delete document.documentElement.dataset.scheme;
    else document.documentElement.dataset.scheme = name;
    updateThemeColor();
  }

  function isDark() {
    const chosen = document.documentElement.dataset.scheme;
    if (chosen) return chosen === "dark";
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  /**
   * Design and colour scheme in the cookie `look`, which manifest.php turns into the colours of
   * the installed app (splash screen, system bars on Android).
   */
  function rememberLook() {
    try {
      const design = document.documentElement.dataset.design || DEFAULT;
      document.cookie = `look=${design}-${isDark() ? "dark" : "light"}; path=/; max-age=31536000; SameSite=Lax`
        + (location.protocol === "https:" ? "; Secure" : "");
    } catch { /* cookies blocked: the app keeps the default colours */ }
  }

  /**
   * Background at the very top of the page: the header bar (Klassisch) or the page itself.
   * `refresh` also replaces the tag: Android's installed app falls back to the manifest colour
   * (white) when it comes back from the background, and only a new tag makes it apply ours again.
   */
  function updateThemeColor(refresh) {
    rememberLook();
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    if (refresh === true) {
      const fresh = meta.cloneNode();
      meta.replaceWith(fresh);
      meta = fresh;
    }
    const design = document.documentElement.dataset.design || DEFAULT;
    meta.content = PAGE_COLORS[design][isDark() ? "dark" : "light"];
    if (!document.body) return; // still loading: the table above has to do
    const transparent = (color) => color === "transparent" || /^rgba\(.*,\s*0\)$/.test(color);
    const first = document.body.firstElementChild;
    const atTop = first && first.getBoundingClientRect().top + window.scrollY <= 0;
    for (const box of [atTop ? first : null, document.body, document.documentElement]) {
      const color = box ? getComputedStyle(box).backgroundColor : "transparent";
      if (!transparent(color)) {
        meta.content = color;
        return;
      }
    }
  }

  function chooseScheme(name) {
    if (!Object.prototype.hasOwnProperty.call(SCHEMES, name)) return;
    remember(SCHEME_KEY, name);
    applyScheme(name);
  }

  function current() {
    return stored(KEY, DESIGNS, DEFAULT);
  }

  function apply(name) {
    for (const id of Object.keys(DESIGNS)) {
      const link = document.getElementById(`css-${id}`);
      if (link) link.disabled = id !== name;
    }
    document.documentElement.dataset.design = name;
    updateThemeColor();
  }

  function choose(name) {
    if (!Object.prototype.hasOwnProperty.call(DESIGNS, name)) return;
    remember(KEY, name);
    // Browsers don't load a disabled stylesheet. Keep the current one until the chosen one
    // has loaded, otherwise the page is briefly shown without any styles.
    const next = document.getElementById(`css-${name}`);
    if (!next || next.sheet) {
      apply(name);
      return;
    }
    let done = false;
    const finish = () => {
      if (!done) apply(name);
      done = true;
    };
    next.addEventListener("load", finish, { once: true });
    next.addEventListener("error", finish, { once: true });
    setTimeout(finish, 3000);
    next.disabled = false;
  }

  apply(current());
  applyScheme(scheme());
  // the body exists only after parsing; "auto" follows the system scheme when it changes
  document.addEventListener("DOMContentLoaded", () => updateThemeColor());
  window.addEventListener("load", () => updateThemeColor());
  // back from the background / from the back-forward cache: apply the colour again
  window.addEventListener("pageshow", () => updateThemeColor(true));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) updateThemeColor(true); });
  if (window.matchMedia) {
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    if (dark.addEventListener) dark.addEventListener("change", () => updateThemeColor());
  }
  return { DESIGNS, current, choose, SCHEMES, scheme, chooseScheme };
})();
