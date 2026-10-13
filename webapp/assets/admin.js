"use strict";

// Administration (Verwaltung tab): account list and detail dialog, invitations, admin log, backup
// status. Loaded by app.js (openAdminTab) when an admin opens the tab for the first time, and
// shares its globals ($, el, api, state, Logic, plural, …).

// ---- administration -----------------------------------------------------------------

const ROLE_LABELS = { user: "Nutzer", admin: "Admin", viewer: "Nur Lesen" };
// actions in the admin log (admin_log.action, written by lib/admin.php)
const ADMIN_ACTIONS = { invite: "Eingeladen", reset: "Passwort-Link erstellt", revoke: "Link zurückgezogen",
  role: "Rolle geändert", email: "E-Mail geändert" /* old log entries */, username: "Benutzername geändert", lock: "Gesperrt", unlock: "Entsperrt",
  logout: "Überall abgemeldet", access: "Freigaben geändert", export: "Daten exportiert", delete: "Konto gelöscht" };

const admin = {
  overview: null, // last admin-overview response
  detailId: null, // account shown in the detail dialog
};

const accountById = (id) => admin.overview.users.find((u) => u.id === id) || null;
const germanDateTime = (text) => `${Logic.germanDate(text.slice(0, 10))} ${text.slice(11)}`;

async function loadAdmin() {
  try {
    admin.overview = await api("admin-overview");
  } catch (error) {
    $("invite-error").textContent = error.message;
    return false;
  }
  const self = accountById(state.user.id);
  if (self && self.username !== state.user.username) { // the admin changed the own username
    state.user.username = self.username;
    $("user-name").textContent = self.username;
  }
  // the admin's own account may just have been assigned or removed
  state.data.viewers = admin.overview.users.filter((u) => u.isViewer && u.canView.includes(state.user.id)).map((u) => u.username);
  renderViewers();
  showNewFeedback(admin.overview.newFeedback);
  renderFeedback();
  renderUsers();
  renderLinks();
  renderLog();
  renderBackup();
  if ($("account-dialog").open) {
    if (accountById(admin.detailId)) renderAccount();
    else $("account-dialog").close();
  }
  return true;
}

function accessSummary(u) {
  if (u.isViewer) return u.canView.length ? `sieht ${plural(u.canView.length, "Konto", "Konten")}` : "sieht nichts";
  return u.viewedBy.length ? `lesbar für ${u.viewedBy.length}` : "–";
}

// ---- feedback inbox ------------------------------------------------------------------

const FEEDBACK_KINDS = { idea: "Vorschlag", bug: "Fehler" };
const FEEDBACK_STATUS = { new: "Neu", read: "Gelesen", done: "Erledigt" };

function feedbackShown() {
  const filter = $("f-filter").value;
  return admin.overview.feedback.filter((f) => (filter === "open" ? f.status !== "done" : !filter || f.status === filter));
}

function feedbackText(f) {
  const where = f.page ? ` · Tab ${f.page}` : "";
  return `${FEEDBACK_KINDS[f.kind]} von ${f.username}, ${germanDateTime(f.at)}${where}\n${f.message}`;
}

function renderFeedback() {
  const list = feedbackShown();
  const open = admin.overview.feedback.filter((f) => f.status !== "done").length;
  const button = (label, onclick) => el("button", { type: "button", onclick }, label);
  $("feedback-list").replaceChildren(...list.map((f) => el("article", { class: `feedback is-${f.status}` },
    el("div", { class: "feedback-head" },
      el("strong", {}, FEEDBACK_KINDS[f.kind]), el("span", {}, f.username), el("span", {}, germanDateTime(f.at)),
      f.status === "new" ? el("span", { class: "badge new-badge" }, "Neu") : f.status === "done" ? el("span", {}, "Erledigt") : null),
    el("p", { class: "feedback-text" }, f.message),
    f.page || f.agent ? el("p", { class: "feedback-meta" }, [f.page && `Tab: ${f.page}`, f.agent].filter(Boolean).join(" · ")) : null,
    el("div", { class: "form-actions" },
      f.status === "new" ? button("Gelesen", () => feedbackAction("admin-feedback-status", f.id, "read")) : null,
      f.status === "done" ? button("Wieder öffnen", () => feedbackAction("admin-feedback-status", f.id, "read"))
        : button("Erledigt", () => feedbackAction("admin-feedback-status", f.id, "done")),
      button("Löschen", () => {
        if (window.confirm("Diese Rückmeldung endgültig löschen?")) feedbackAction("admin-feedback-delete", f.id);
      })),
  )));
  $("no-feedback").hidden = list.length > 0;
  $("f-copy").disabled = open === 0;
  $("f-count").textContent = open ? `${open} offen` : "";
}

async function feedbackAction(action, id, status) {
  try {
    await api(action, { id, status });
  } catch (error) {
    window.alert(error.message);
  }
  loadAdmin();
}

async function copyFeedback() {
  const text = admin.overview.feedback.filter((f) => f.status !== "done").map(feedbackText).join("\n\n---\n\n");
  const button = $("f-copy");
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Kopiert ✓";
  } catch {
    button.textContent = "Kopieren nicht möglich";
  }
  setTimeout(() => { button.textContent = label; }, 2500);
}

function renderUsers() {
  const search = $("u-search").value.trim().toLowerCase();
  const filter = $("u-filter").value;
  const users = admin.overview.users.filter((u) => u.username.includes(search)
    && (!filter || (filter === "locked" ? u.lockedAt !== null : u.role === filter)));
  $("users-body").replaceChildren(...users.map((u) => el("tr", { class: "clickable", onclick: () => openAccount(u.id) },
    el("td", {}, u.username, u.id === state.user.id ? el("span", { class: "muted" }, " (du)") : null),
    el("td", {}, ROLE_LABELS[u.role]),
    el("td", {}, u.lockedAt ? el("span", { class: "badge locked" }, "Gesperrt") : "Aktiv"),
    el("td", {}, accessSummary(u)),
    el("td", {}, Logic.germanDate(u.createdAt)),
    el("td", { class: "actions" }, el("button", { type: "button", class: "link" }, "Details")),
  )));
  $("no-users").hidden = users.length > 0;
  const total = admin.overview.users.length;
  $("u-count").textContent = users.length === total ? plural(total, "Konto", "Konten") : `${users.length} von ${total}`;
}

function renderLinks() {
  const links = admin.overview.links;
  $("links-body").replaceChildren(...links.map((l) => el("tr", {},
    el("td", {}, l.username),
    el("td", {}, l.kind !== "invite" ? "Passwort-Link"
      : l.isAdmin ? "Einladung (Admin)" : l.isViewer ? "Einladung (Nur Lesen)" : "Einladung"),
    el("td", {}, germanDateTime(l.expiresAt)),
    el("td", { class: "actions" },
      el("button", { type: "button", class: "link", onclick: () => revokeLink(l) }, "Zurückziehen")),
  )));
  $("no-links").hidden = links.length > 0;
}

function logRow(entry, withTarget = true) {
  return el("tr", {},
    el("td", {}, germanDateTime(entry.at)),
    el("td", {}, entry.admin),
    el("td", {}, ADMIN_ACTIONS[entry.action] || entry.action),
    withTarget ? el("td", {}, entry.target || "") : null,
    el("td", { class: "note" }, entry.details));
}

function renderLog() {
  $("log-body").replaceChildren(...admin.overview.log.map((entry) => logRow(entry)));
  $("no-log").hidden = admin.overview.log.length > 0;
}

function renderBackup() {
  const b = admin.overview.backup;
  if (!b.enabled) {
    $("backup-info").textContent = "Automatische Sicherung ist aus (abgeschaltet oder MySQL – dann sichert der Hoster).";
  } else {
    const last = b.last ? `${Logic.germanDate(b.last.slice(0, 10))} ${b.last.slice(11)} Uhr` : "noch keine";
    $("backup-info").textContent = `Letzte Sicherung: ${last} · alle ${b.days} Tage, die letzten ${b.keep} bleiben `
      + `(${plural(b.count, "Kopie", "Kopien")} in data/backups/).`;
  }
}

// ---- account detail ------------------------------------------------------------------

function openAccount(id) {
  admin.detailId = id;
  renderAccount();
  $("account-dialog").showModal();
  $("account-title").focus(); // not the username field, which showModal would focus
}

function setDetailStatus(message, isError = false) {
  const status = $("detail-status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

/** Run an admin action from the detail dialog, reload everything and report the outcome. */
async function accountAction(run, success) {
  let result;
  try {
    result = await run();
  } catch (error) {
    setDetailStatus(error.message, true);
    return undefined;
  }
  await loadAdmin();
  if ($("account-dialog").open) setDetailStatus(typeof success === "function" ? success(result) : success);
  return result;
}

function detailSection(title, ...children) {
  return el("section", { class: "detail-section" }, el("h4", {}, title), ...children);
}

/** Checkboxes for read access: viewer -> accounts it sees; other account -> viewers that see it. */
function accessSection(u) {
  const candidates = admin.overview.users.filter((o) => o.isViewer !== u.isViewer);
  const selected = u.isViewer ? u.canView : u.viewedBy;
  if (!candidates.length) {
    return detailSection("Freigaben", el("p", { class: "hint" }, u.isViewer
      ? "Noch keine Konten mit eigenen Daten." : "Noch keine Lese-Konten."));
  }
  const boxes = candidates.map((o) => el("input", { type: "checkbox", value: String(o.id), checked: selected.includes(o.id) }));
  const ids = () => boxes.filter((b) => b.checked).map((b) => Number(b.value));
  const save = () => accountAction(() => (u.isViewer
    ? api("admin-viewer-access", { id: u.id, canView: ids() })
    : api("admin-owner-access", { id: u.id, viewers: ids() })), "Freigaben gespeichert ✓");
  return detailSection("Freigaben",
    el("p", { class: "hint" }, u.isViewer ? "Darf diese Konten sehen:" : "Sichtbar für diese Lese-Konten:"),
    el("div", { class: "access" }, ...candidates.map((o, i) => el("label", { class: "checkbox" }, boxes[i], o.username))),
    el("div", { class: "form-actions" }, el("button", { type: "button", onclick: save }, "Freigaben speichern")));
}

function renderAccount() {
  const u = accountById(admin.detailId);
  const self = u.id === state.user.id;
  const username = el("input", { type: "text", class: "w-email", value: u.username, "aria-label": "Benutzername",
    autocapitalize: "none", spellcheck: false });
  const role = el("select", { "aria-label": "Rolle", disabled: self },
    ...Object.entries(ROLE_LABELS).map(([value, label]) => el("option", { value, selected: value === u.role }, label)));
  const status = u.lockedAt ? `Gesperrt seit ${germanDateTime(u.lockedAt)}` : "Aktiv";
  const log = admin.overview.log.filter((entry) => entry.targetId === u.id).slice(0, 10);

  const button = (label, onclick, props = {}) => el("button", { type: "button", onclick, ...props }, label);
  $("account-detail").replaceChildren(...[ // null = section not shown (replaceChildren would print it as text)
    el("h3", { id: "account-title", tabIndex: -1 }, u.username, self ? el("span", { class: "muted" }, " (du)") : null),
    el("p", { class: "hint" }, `${ROLE_LABELS[u.role]} · seit ${Logic.germanDate(u.createdAt)} · ${status}`),

    detailSection("Konto",
      el("div", { class: "form-actions" }, username, button("Benutzername ändern", () => accountAction(
        () => api("admin-username", { id: u.id, username: username.value }), "Benutzername geändert ✓"))),
      el("div", { class: "form-actions" }, role, button("Rolle ändern", () => accountAction(
        () => api("admin-role", { id: u.id, role: role.value }), "Rolle geändert ✓"),
        { disabled: self, title: self ? "Deine eigene Rolle kann nur ein anderer Admin ändern." : undefined }))),

    detailSection("Zugang",
      el("p", { class: "hint" }, `${status} · ${plural(u.sessions, "aktive Sitzung", "aktive Sitzungen")}`),
      el("div", { class: "form-actions wrap" },
        button("Passwort-Link erstellen", async () => {
          const result = await accountAction(() => api("admin-reset", { username: u.username }), "Passwort-Link erstellt ✓");
          if (result) showLinkIn($("detail-link"), `Passwort-Link für ${u.username}. Er ist 24 Stunden gültig und funktioniert einmal.`, result.link);
        }, { disabled: Boolean(u.lockedAt) }),
        self ? null : button(u.lockedAt ? "Entsperren" : "Sperren", () => {
          if (!u.lockedAt && !window.confirm(`${u.username} sperren? Die Person wird sofort abgemeldet und kann sich nicht mehr anmelden; die Daten bleiben erhalten.`)) return;
          accountAction(() => api("admin-lock", { id: u.id, locked: !u.lockedAt }), u.lockedAt ? "Entsperrt ✓" : "Gesperrt ✓");
        }),
        self ? null : button("Überall abmelden", () => accountAction(() => api("admin-logout", { id: u.id }),
          (r) => `${plural(r.count, "Sitzung", "Sitzungen")} beendet ✓`), { disabled: u.sessions === 0 })),
      el("div", { id: "detail-link", class: "link-box", hidden: true })),

    accessSection(u),

    u.isViewer ? null : detailSection("Daten",
      el("div", { class: "form-actions" }, button("Daten exportieren", () => accountAction(async () => {
        const data = await api(`admin-export&id=${u.id}`);
        downloadExport(data, `homeoffice-rechner-${data.username}-${Logic.today()}.json`);
      }, "Export heruntergeladen ✓")))),

    detailSection("Protokoll", log.length
      ? el("div", { class: "table-card" }, el("table", { class: "entries" }, el("tbody", {}, ...log.map((entry) => logRow(entry, false)))))
      : el("p", { class: "hint" }, "Noch keine Admin-Aktionen zu diesem Konto.")),

    el("div", { class: "form-actions detail-footer" },
      self ? null : button("Konto löschen", async () => {
        if (!window.confirm(`Konto ${u.username} mit allen Daten endgültig löschen?`)) return;
        await accountAction(() => api("admin-delete-user", { id: u.id }), "");
      }, { class: "danger" }),
      el("span", { id: "detail-status", class: "status", role: "status" }),
      button("Schließen", () => $("account-dialog").close(), { class: "primary" })),
  ].filter(Boolean));
}

// ---- invitations & links ---------------------------------------------------------------

function showLinkIn(box, text, url) {
  const input = el("input", { readonly: true, class: "w-link", value: url });
  const copy = el("button", { type: "button", onclick: () => copyLink(input, copy) }, "Kopieren");
  box.replaceChildren(el("p", {}, text), el("div", { class: "form-actions" }, input, copy));
  box.hidden = false;
  input.select();
}

async function invite(event) {
  event.preventDefault();
  $("invite-error").textContent = "";
  const username = $("i-username").value.trim();
  try {
    const role = $("i-role").value;
    const { link } = await api("admin-invite", { username, isAdmin: role === "admin", isViewer: role === "viewer" });
    showLinkIn($("link-box"), `Schicke diesen Link an ${username}. Er ist 7 Tage gültig und funktioniert einmal.`, link);
    $("invite-form").reset();
  } catch (error) {
    $("invite-error").textContent = error.message;
  }
  loadAdmin();
}

async function revokeLink(link) {
  await api("admin-revoke", { id: link.id }).catch((error) => { $("invite-error").textContent = error.message; });
  loadAdmin();
}

async function copyLink(input, button) {
  try {
    await navigator.clipboard.writeText(input.value);
    button.textContent = "Kopiert ✓";
  } catch {
    input.select();
    button.textContent = "Mit Strg+C kopieren";
  }
  setTimeout(() => { button.textContent = "Kopieren"; }, 2500);
}

// ---- wiring --------------------------------------------------------------------------

(function setupAdmin() {
  $("invite-form").addEventListener("submit", invite);
  $("u-search").addEventListener("input", () => admin.overview && renderUsers());
  $("u-filter").addEventListener("change", () => admin.overview && renderUsers());
  $("f-filter").addEventListener("change", () => admin.overview && renderFeedback());
  $("f-copy").addEventListener("click", copyFeedback);
})();
