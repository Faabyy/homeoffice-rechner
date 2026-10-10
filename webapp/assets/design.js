"use strict";

// Chooses the design (stylesheet) before the page is drawn: loaded in <head> right after the
// stylesheets <link id="css-modern">, <link id="css-klassisch"> and <link id="css-warm">, it
// disables the ones not chosen. It also applies the colour scheme: automatic (system setting),
// or light/dark chosen explicitly via <html data-scheme>, which the stylesheets honour. Both
// choices are per browser (localStorage) and changed in Einstellungen → Darstellung.

const Design = (() => {
  const KEY = "design";
  const DESIGNS = { modern: "Modern", klassisch: "Klassisch", warm: "Warm" };
  const DEFAULT = "modern";
  const SCHEME_KEY = "farbmodus";
  const SCHEMES = { auto: "Automatisch (wie das System)", light: "Hell", dark: "Dunkel" };

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
  return { DESIGNS, current, choose, SCHEMES, scheme, chooseScheme };
})();
