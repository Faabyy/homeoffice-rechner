"use strict";

// The app UI. All calculation happens locally with Logic (logic.js) on the user's data,
// which is loaded once from api.php; changes are sent to the server and then applied
// to the local copy.

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August",
  "September", "Oktober", "November", "Dezember"];
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const LABELS = { homeoffice: "Homeoffice", buero: "Büro", frei: "Frei", schule: "Berufsschule/Studium",
  krank: "Krank", urlaub: "Urlaub", null: "Nicht geplant" };
// shorter text inside the calendar cells
const CELL_LABELS = { ...LABELS, schule: "Schule/Studium" };
// day-off kinds offered in the menu besides "Frei" (they all count like a day off)
const OFF_OPTIONS = [["frei", "Frei"], ["schule", LABELS.schule], ["krank", "Krank"], ["urlaub", "Urlaub"]];
const PLAN_CYCLE = [null, "homeoffice", "buero", "frei"];
const TIME_STEP = 15;
const BREAK_STEP = 5;

const now = new Date();
const state = {
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  user: null,
  account: { createdAt: null, admins: [] }, // from `me`: account creation date, admin e-mails
  data: null,           // {settings, entries, plan} of the logged-in user (read-only account: of the viewed one)
  readOnly: false,      // read-only account: no own data, only views accounts assigned by an admin
  days: [],             // Logic.monthDays of the displayed month
  school: {},           // "<state>-<year>" -> school holiday periods, "loading" or "failed"
  editingId: null,      // id of the entry loaded into the form, or null when adding
  highlightDay: null,   // ISO date whose entries are highlighted in the table
  highlightEntry: null, // id of the entry just saved
};

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

// ---- server ---------------------------------------------------------------------

async function api(action, body) {
  const options = body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  let response;
  try {
    response = await fetch(`api.php?action=${action}`, options);
  } catch {
    throw new Error("Keine Verbindung zum Server. Bitte später erneut versuchen.");
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    location.href = "login.php";
    throw new Error(data.error || "Bitte melde dich an.");
  }
  if (!response.ok) throw new Error(data.error || `Serverfehler (${response.status})`);
  return data;
}

function showAppError(message) {
  $("app-error").textContent = message || "";
}

// ---- helpers ----------------------------------------------------------------------

const fmtMinutes = Logic.formatMinutes;
const fmtPercent = (value) => `${value.toFixed(1).replace(".", ",")} %`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function dayLabel(day, withYear = true) {
  const [y, m, d] = day.split("-");
  return `${WEEKDAYS[Logic.weekday(day)]} ${d}.${m}.${withYear ? y : ""}`;
}

function showError(message) {
  $("form-error").textContent = message || "";
}

function setStatus(id, message, isError = false) {
  const status = $(id);
  status.textContent = message;
  status.classList.toggle("error", isError);
  if (!isError && message) setTimeout(() => { if (status.textContent === message) status.textContent = ""; }, 2500);
}

// ---- rendering of the month ---------------------------------------------------------

// ---- school holidays (display only) ---------------------------------------------------

const SCHOOL_API = "https://openholidaysapi.org/SchoolHolidays";
const SCHOOL_CACHE_DAYS = 7;

function schoolPeriods() {
  const periods = state.school[`${state.data.settings.state}-${state.year}`];
  return Array.isArray(periods) ? periods : [];
}

/** Load the school holidays of the displayed year once; renders again when they arrive. */
async function ensureSchoolHolidays() {
  const region = state.data.settings.state;
  const year = state.year;
  const key = `${region}-${year}`;
  if (!region || key in state.school) return;
  const storageKey = `schulferien-${key}`;
  try {
    const cached = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (cached && Date.now() - cached.at < SCHOOL_CACHE_DAYS * 86400000) {
      state.school[key] = cached.periods;
      return;
    }
  } catch { /* no usable cache */ }
  state.school[key] = "loading";
  try {
    const query = new URLSearchParams({ countryIsoCode: "DE", subdivisionCode: `DE-${region}`,
      validFrom: `${year}-01-01`, validTo: `${year}-12-31`, languageIsoCode: "DE" });
    const response = await fetch(`${SCHOOL_API}?${query}`);
    if (!response.ok) throw new Error(String(response.status));
    const periods = Logic.normalizeSchoolHolidays(await response.json());
    state.school[key] = periods;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ at: Date.now(), periods }));
    } catch { /* storage full or blocked */ }
  } catch {
    state.school[key] = "failed"; // display only: the calendar simply shows no school holidays
    return;
  }
  if (state.data.settings.state === region && state.year === year) render();
}

function render() {
  $("month-label").textContent = `${MONTHS[state.month - 1]} ${state.year}`;
  ensureSchoolHolidays();
  state.days = Logic.monthDays(state.year, state.month, state.data, schoolPeriods());
  renderCalendar();
  renderTable();
  renderSummary();
  updatePreview();
}

function changeMonth(delta) {
  const index = state.year * 12 + (state.month - 1) + delta;
  state.year = Math.floor(index / 12);
  state.month = (index % 12) + 1;
  render();
}

function showMonthOf(day) {
  const [y, m] = day.split("-").map(Number);
  if (y !== state.year || m !== state.month) {
    state.year = y;
    state.month = m;
    render();
  }
}

// ---- calendar -------------------------------------------------------------------

const isPlannable = (day) => !state.readOnly && (day.kind === Logic.WORKDAY || day.kind === Logic.DAY_OFF);
const planState = (day) => (day.kind === Logic.DAY_OFF ? day.offType : day.planned);
/** What a day is without a plan row: Frei/Berufsschule or Homeoffice/Büro per the weekday settings, or null. */
const defaultStatus = (day) => (day.defaultOff ? day.defaultOffType : day.defaultLocation);

/**
 * Plan choices for a day as [status to store, label]. A weekday can have a default in the
 * settings (Frei, Berufsschule/Studium, Homeoffice or Büro); choosing the default there
 * means "no override" (null).
 */
function planOptions(day) {
  const fallback = defaultStatus(day);
  const options = [["homeoffice", "Homeoffice"], ["buero", "Büro"], ...OFF_OPTIONS]
    .map(([status, label]) => (status === fallback ? [null, `${label} (Standard)`] : [status, label]));
  return fallback ? options : [...options, [null, "Nicht geplant"]];
}

/** The option of planOptions(day) that is currently in effect. */
function currentOption(day) {
  const current = planState(day);
  return current === defaultStatus(day) ? null : current;
}

/**
 * Click order: workday  – → Homeoffice → Büro → Frei → –;
 * workday with a default location  default → the other location → Frei → default;
 * default day off (Frei or Berufsschule)  default → Homeoffice → Büro → default.
 * Krank/Urlaub/Schule are only set via the menu; a click on such a day resets it (indexOf -1 → first).
 */
function nextPlanStatus(day) {
  const fallback = defaultStatus(day);
  let order = PLAN_CYCLE;
  if (day.defaultOff) order = [null, "homeoffice", "buero"];
  else if (fallback) order = PLAN_CYCLE.filter((status) => status !== fallback);
  return order[(order.indexOf(currentOption(day)) + 1) % order.length];
}

function dayContent(day) {
  let text = "";
  let color = "c-offen";
  if (day.kind === Logic.HOLIDAY) { text = day.holiday; color = "c-feiertag"; }
  else if (day.kind === Logic.DAY_OFF) { text = CELL_LABELS[day.offType]; color = `c-${day.offType}`; }
  else if (day.kind === Logic.NON_WORKDAY) { color = "c-kein"; }
  else if (day.planned) { text = LABELS[day.planned]; color = `c-${day.planned}`; }

  const logged = Object.entries(day.actual);
  if (logged.length) {
    text = "✓ " + logged
      .map(([loc, minutes]) => `${loc === Logic.HOME_OFFICE ? "HO" : "Büro"} ${fmtMinutes(minutes)}`)
      .join(" + ");
    const [main] = logged.reduce((a, b) => (b[1] > a[1] ? b : a));
    color = `c-${main}`;
  }
  return { text, color };
}

function renderCalendar() {
  const cells = WEEKDAYS.map((name) => el("div", { class: "weekday" }, name));
  const offset = Logic.weekday(state.days[0].date);
  for (let i = 0; i < offset; i++) cells.push(el("div"));

  const today = Logic.today();
  for (const day of state.days) {
    const { text, color } = dayContent(day);
    const classes = ["day", color];
    if (!isPlannable(day)) classes.push("static");
    if (day.date === today) classes.push("today");
    if (day.school) classes.push("school");
    let hint = isPlannable(day) ? "Klick: Planung wechseln · Rechtsklick: Menü" : "Rechtsklick: Zeit erfassen";
    if (state.readOnly) hint = "";
    cells.push(el("button", {
      type: "button",
      class: classes.join(" "),
      title: [day.school && `${day.school} (Schulferien)`, hint].filter(Boolean).join("\n"),
      "aria-label": `${dayLabel(day.date)} ${text}${day.school ? `, ${day.school}` : ""}`.trim(),
      onclick: () => cyclePlan(day.date),
      oncontextmenu: state.readOnly ? undefined : (event) => {
        event.preventDefault();
        let { clientX: x, clientY: y } = event;
        if (x === 0 && y === 0) { // opened via keyboard (context menu key / Shift+F10)
          const rect = event.currentTarget.getBoundingClientRect();
          x = rect.left + 8;
          y = rect.bottom;
        }
        showDayMenu(day, x, y);
      },
    }, el("span", { class: "num" }, el("span", {}, String(Number(day.date.slice(8))))),
       el("span", { class: "txt" }, text),
       day.schoolStart ? el("span", { class: "sch" }, day.school) : null));
  }
  $("calendar").replaceChildren(...cells);
}

// Plan changes are queued so fast repeated clicks are applied in order.
let planQueue = Promise.resolve();

function enqueuePlanChange(change) {
  planQueue = planQueue.then(change).catch((error) => showAppError(error.message));
}

async function savePlan(date, status) {
  await api("plan", { day: date, status });
  if (status) state.data.plan[date] = status;
  else delete state.data.plan[date];
  showAppError("");
  render();
}

function setPlan(date, status) {
  enqueuePlanChange(() => savePlan(date, status));
}

function cyclePlan(date) {
  // Decide the next state when the queued click runs, so it builds on the previous one.
  enqueuePlanChange(() => {
    const day = state.days.find((d) => d.date === date);
    if (!day || !isPlannable(day)) return undefined;
    return savePlan(date, nextPlanStatus(day));
  });
}

// ---- context menu ---------------------------------------------------------------

function showDayMenu(day, x, y) {
  const menu = $("context-menu");
  const items = [
    el("button", {
      type: "button", role: "menuitem", class: "primary-item",
      onclick: () => { hideMenu(); openDay(day.date); },
    }, `Zeit erfassen für ${dayLabel(day.date)} …`),
  ];
  if (isPlannable(day)) {
    items.push(el("hr"));
    const current = currentOption(day);
    for (const [status, label] of planOptions(day)) {
      items.push(el("button", {
        type: "button", role: "menuitemradio", "aria-checked": String(status === current),
        onclick: () => { hideMenu(); setPlan(day.date, status); },
      }, el("span", { class: "check" }, status === current ? "✓" : ""), label));
    }
  }
  menu.replaceChildren(...items);
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
  menu.querySelector("button").focus();
}

function hideMenu() {
  $("context-menu").hidden = true;
}

function setupMenu() {
  const menu = $("context-menu");
  document.addEventListener("pointerdown", (e) => { if (!menu.contains(e.target)) hideMenu(); });
  window.addEventListener("blur", hideMenu);
  window.addEventListener("resize", hideMenu);
  document.addEventListener("scroll", hideMenu, true);
  menu.addEventListener("keydown", (e) => {
    const buttons = [...menu.querySelectorAll("button")];
    const index = buttons.indexOf(document.activeElement);
    if (e.key === "Escape") hideMenu();
    else if (e.key === "ArrowDown") { e.preventDefault(); buttons[(index + 1) % buttons.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); buttons[(index - 1 + buttons.length) % buttons.length].focus(); }
  });
}

// ---- entry form -----------------------------------------------------------------

const getLocation = () => document.querySelector('input[name="location"]:checked').value;

function setLocation(location) {
  document.querySelector(`input[name="location"][value="${location}"]`).checked = true;
}

const parseFormDate = () => Logic.parseDate($("f-date").value, state.year, state.month);

/** Read the form into an entry (API shape); throws InputError. */
function formEntry() {
  const entry = {
    day: parseFormDate(),
    start: Logic.minutesToTime(Logic.parseTime($("f-start").value, "Beginn")),
    end: Logic.minutesToTime(Logic.parseTime($("f-end").value, "Ende")),
    break: Logic.parseBreak($("f-break").value),
    location: getLocation(),
  };
  if (state.editingId) entry.id = state.editingId;
  return Logic.validateEntry(entry);
}

/** Put a day into the form and prefill times and location for a new entry. */
function setFormDay(day, onlyDate = false) {
  showError("");
  $("f-date").value = Logic.germanDate(day);
  if (!onlyDate) {
    const p = Logic.prefill(state.data, day);
    $("f-start").value = p.start;
    $("f-end").value = p.end;
    $("f-break").value = p.break;
    if (p.location) setLocation(p.location);
  }
  showMonthOf(day);
  updatePreview();
}

function formDayOrToday() {
  try {
    return parseFormDate();
  } catch {
    return Logic.today();
  }
}

function shiftDay(delta) {
  // While editing, only the date moves; otherwise the new day gets fresh suggestions.
  setFormDay(Logic.addDays(formDayOrToday(), delta), state.editingId !== null);
}

function updatePreview() {
  const info = $("form-info");
  let day;
  try {
    day = parseFormDate();
  } catch {
    info.textContent = "Datum unvollständig";
    return;
  }
  const parts = [dayLabel(day)];
  const status = state.data.plan[day];
  const location = Logic.plannedLocation(state.data, day);
  if (Logic.OFF_TYPES.includes(status)) parts.push(LABELS[status]);
  else if (location) parts.push(`geplant: ${LABELS[location]}`);
  const logged = state.data.entries
    .filter((e) => e.day === day && e.id !== state.editingId)
    .reduce((sum, e) => sum + Logic.workedMinutes(e), 0);
  if (logged) parts.push(`schon erfasst: ${fmtMinutes(logged)} h`);

  let worked;
  let dayFlex = "";
  try {
    const minutes = Logic.workedMinutes(formEntry());
    worked = el("span", { class: "worked" }, `${fmtMinutes(minutes)} h`);
    const diff = logged + minutes - state.data.settings.dailyMinutes;
    dayFlex = `   (Tag gesamt ${fmtMinutes(logged + minutes)} h, Gleitzeit ${Logic.formatSigned(diff)})`;
  } catch (error) {
    worked = el("span", { class: "problem" }, `– (${error.message})`);
  }
  info.replaceChildren(`${parts.join(" · ")}   →   Arbeitszeit: `, worked, dayFlex);
}

function normalizeField(input, normalize) {
  try {
    input.value = normalize(input.value);
  } catch { /* leave the raw input; the preview shows the problem */ }
}

function stepTime(input, delta) {
  try {
    const minutes = Logic.parseTime(input.value, "");
    input.value = Logic.minutesToTime(Math.min(Math.max(minutes + delta, 0), 23 * 60 + 59));
    updatePreview();
  } catch { /* not a time yet */ }
}

function stepBreak(delta) {
  try {
    $("f-break").value = String(Math.max(Logic.parseBreak($("f-break").value) + delta, 0));
    updatePreview();
  } catch { /* not a number yet */ }
}

async function submitEntry(event) {
  event.preventDefault();
  showError("");
  let entry;
  try {
    entry = formEntry();
    const clash = Logic.findOverlap(state.data.entries, entry);
    if (clash) {
      throw new Error(`Der Eintrag überschneidet sich mit ${clash.start}–${clash.end} am ${Logic.germanDate(clash.day)}.`);
    }
    entry = (await api("entry", entry)).entry;
  } catch (error) {
    showError(error.message);
    return;
  }
  const others = state.data.entries.filter((e) => e.id !== entry.id);
  state.data.entries = [...others, entry].sort((a, b) => (a.day + a.start).localeCompare(b.day + b.start));
  exitEditMode();
  state.highlightEntry = entry.id;
  state.highlightDay = null;
  setFormDay(entry.day);
  render();
  $("f-start").focus();
}

function startEdit(entry) {
  state.editingId = entry.id;
  state.highlightEntry = null;
  $("f-date").value = Logic.germanDate(entry.day);
  $("f-start").value = entry.start;
  $("f-end").value = entry.end;
  $("f-break").value = entry.break;
  setLocation(entry.location);
  $("form-title").textContent = "Eintrag bearbeiten";
  $("submit-btn").textContent = "Speichern";
  $("cancel-btn").hidden = false;
  $("entry-form").classList.add("editing");
  showError("");
  renderTable();
  updatePreview();
  $("f-start").focus();
}

function exitEditMode() {
  state.editingId = null;
  $("form-title").textContent = "Arbeitszeit erfassen";
  $("submit-btn").textContent = "Hinzufügen";
  $("cancel-btn").hidden = true;
  $("entry-form").classList.remove("editing");
}

function cancelEdit() {
  if (state.editingId === null) return;
  exitEditMode();
  renderTable();
  setFormDay(formDayOrToday());
}

async function deleteEntry(entry) {
  if (!window.confirm(`Eintrag ${dayLabel(entry.day)} ${entry.start}–${entry.end} löschen?`)) return;
  try {
    await api("delete-entry", { id: entry.id });
  } catch (error) {
    showError(error.message);
    return;
  }
  state.data.entries = state.data.entries.filter((e) => e.id !== entry.id);
  if (state.editingId === entry.id) exitEditMode();
  render();
  setFormDay(formDayOrToday());
}

/** From the calendar: jump to the time entry form for this day. */
function openDay(day) {
  if (state.editingId !== null) exitEditMode();
  state.highlightDay = day;
  state.highlightEntry = null;
  switchTab("zeiterfassung");
  setFormDay(day);
  renderTable();
  $("f-start").focus();
}

function renderTable() {
  const prefix = `${state.year}-${String(state.month).padStart(2, "0")}-`;
  const rows = state.data.entries.filter((e) => e.day.startsWith(prefix)).map((entry) => {
    let cls = "";
    if (entry.id === state.editingId) cls = "editing";
    else if (entry.id === state.highlightEntry || entry.day === state.highlightDay) cls = "highlight";
    return el("tr", { class: cls, ondblclick: state.readOnly ? undefined : () => startEdit(entry) },
      el("td", {}, dayLabel(entry.day, false)),
      el("td", {}, entry.start),
      el("td", {}, entry.end),
      el("td", {}, `${entry.break} min`),
      el("td", {}, fmtMinutes(Logic.workedMinutes(entry))),
      el("td", {}, el("span", { class: `badge c-${entry.location}` }, LABELS[entry.location])),
      el("td", { class: "actions" }, ...(state.readOnly ? [] : [
        el("button", { type: "button", class: "link", onclick: () => startEdit(entry) }, "Bearbeiten"),
        el("button", { type: "button", class: "link", onclick: () => deleteEntry(entry) }, "Löschen")])),
    );
  });
  $("entries-body").replaceChildren(...rows);
  $("no-entries").hidden = rows.length > 0;
  const marked = $("entries-body").querySelector("tr.highlight, tr.editing");
  if (marked) marked.scrollIntoView({ block: "nearest" });
}

function setupEntryForm() {
  $("entry-form").addEventListener("submit", submitEntry);
  $("cancel-btn").addEventListener("click", cancelEdit);
  $("day-prev").addEventListener("click", () => shiftDay(-1));
  $("day-next").addEventListener("click", () => shiftDay(1));

  const date = $("f-date");
  date.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp") { e.preventDefault(); shiftDay(1); }
    if (e.key === "ArrowDown") { e.preventDefault(); shiftDay(-1); }
  });
  date.addEventListener("change", () => {
    try {
      const day = parseFormDate();
      if (state.editingId === null) setFormDay(day);
      else normalizeField(date, () => Logic.germanDate(day));
    } catch { /* the preview shows the problem */ }
  });

  for (const id of ["f-start", "f-end"]) {
    const input = $(id);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp") { e.preventDefault(); stepTime(input, TIME_STEP); }
      if (e.key === "ArrowDown") { e.preventDefault(); stepTime(input, -TIME_STEP); }
    });
    input.addEventListener("blur", () =>
      normalizeField(input, (v) => Logic.minutesToTime(Logic.parseTime(v, ""))));
  }
  $("f-break").addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp") { e.preventDefault(); stepBreak(BREAK_STEP); }
    if (e.key === "ArrowDown") { e.preventDefault(); stepBreak(-BREAK_STEP); }
  });

  for (const input of $("entry-form").querySelectorAll("input")) {
    input.addEventListener("input", updatePreview);
    if (input.type !== "radio") input.addEventListener("focus", () => input.select());
  }
  $("entry-form").addEventListener("keydown", (e) => {
    if (e.key === "Escape") cancelEdit();
  });
}

// ---- summary --------------------------------------------------------------------

function renderSummary() {
  const f = Logic.forecast(state.days, state.data.settings);
  const exceeded = f.forecastPercent > f.limitPercent;
  let remaining;
  if (f.remaining >= 0) {
    const days = Math.floor(f.remaining / f.dailyMinutes);
    remaining = el("p", { class: "remaining" },
      `Noch ${fmtMinutes(f.remaining)} h möglich (≈ ${plural(days, "Tag", "Tage")})`);
  } else {
    remaining = el("p", { class: "remaining bad" }, `${fmtMinutes(-f.remaining)} h über dem Limit`);
  }

  const fill = el("div", { class: exceeded ? "fill bad" : "fill" });
  fill.style.width = `${Math.min(f.forecastPercent, 100)}%`;
  const limit = el("div", { class: "limit" }, el("span", {}, `max. ${fmtPercent(f.limitPercent)}`));
  limit.style.left = `${f.limitPercent}%`;

  const row = (term, value) => [el("dt", {}, term), el("dd", {}, value)];
  const split = (m) => `${fmtMinutes(m.homeoffice)} HO · ${fmtMinutes(m.buero)} Büro`;
  const flex = Logic.flexSummary(state.data, state.year, state.month);
  const sign = (minutes) => (minutes < 0 ? "neg" : minutes > 0 ? "pos" : "");
  $("summary").replaceChildren(
    el("h3", {}, "Homeoffice-Anteil (Prognose)"),
    el("div", { class: `big ${exceeded ? "bad" : "ok"}` }, fmtPercent(f.forecastPercent)),
    el("div", { class: "bar", role: "img",
      "aria-label": `${fmtPercent(f.forecastPercent)} von maximal ${fmtPercent(f.limitPercent)}` },
      fill, limit),
    remaining,
    el("dl", {},
      ...row("Erfasst", split(f.actual)),
      ...row("Geplant", split(f.planned)),
      ...row("Arbeitstage", `${f.workdays}, davon ${f.openDays} ungeplant`),
    ),
    el("div", { class: "flex" },
      el("h3", {}, "Gleitzeitkonto"),
      el("div", { class: `flex-balance ${sign(flex.balance)}` }, `${Logic.formatSigned(flex.balance)} h`),
      el("p", { class: "caption" },
        `Stand Ende ${MONTHS[state.month - 1]} · im ${MONTHS[state.month - 1]} `,
        el("span", { class: sign(flex.month) }, `${Logic.formatSigned(flex.month)} h`)),
    ),
  );
}

// ---- settings, password, export/import ------------------------------------------------

function fillSettingsForm() {
  const s = state.data.settings;
  $("s-weekdays").replaceChildren(...WEEKDAYS.map((name, index) => {
    const select = el("select", { id: `s-weekday-${index}`, "aria-label": name },
      el("option", { value: "arbeit" }, "Arbeitstag (nicht vorbelegt)"),
      el("option", { value: "homeoffice" }, "Homeoffice"),
      el("option", { value: "buero" }, "Büro"),
      el("option", { value: "schule" }, "Berufsschule/Studium"),
      el("option", { value: "frei" }, "Frei"));
    select.value = weekdayType(s, index);
    return el("label", { class: "weekday-select" }, el("span", {}, name), select);
  }));
  $("s-daily").value = fmtMinutes(s.dailyMinutes);
  $("s-limit").value = String(s.limitPercent).replace(".", ",");
  $("s-start").value = s.defaultStart;
  $("s-break").value = s.defaultBreak;
  $("s-state").replaceChildren(
    el("option", { value: "" }, "– keine Feiertage –"),
    ...Object.entries(Logic.STATES).map(([key, name]) => el("option", { value: key }, name)),
  );
  $("s-state").value = s.state || "";
  renderViewers();
}

/** Type of a weekday for the settings dropdown. */
function weekdayType(settings, index) {
  if (settings.workdays.includes(index)) {
    if ((settings.homeOfficeDays || []).includes(index)) return "homeoffice";
    if ((settings.officeDays || []).includes(index)) return "buero";
    return "arbeit";
  }
  return (settings.schoolDays || []).includes(index) ? "schule" : "frei";
}

/** Tell owners which read-only accounts may see their data, and how to change that. */
function renderViewers() {
  const viewers = state.data.viewers || [];
  $("viewers-info").textContent = viewers.length ? `Lesezugriff auf deine Daten: ${viewers.join(", ")}.`
    : "Niemand hat Lesezugriff auf deine Daten.";
}

/** Weekday numbers (0 = Monday) set to one of the given types in the settings form. */
function weekdaysOfType(...types) {
  return WEEKDAYS.map((_, i) => i).filter((i) => types.includes($(`s-weekday-${i}`).value));
}

async function saveSettings(event) {
  event.preventDefault();
  let settings;
  try {
    settings = Logic.validateSettings({
      workdays: weekdaysOfType("arbeit", "homeoffice", "buero"),
      schoolDays: weekdaysOfType("schule"),
      homeOfficeDays: weekdaysOfType("homeoffice"),
      officeDays: weekdaysOfType("buero"),
      dailyMinutes: Logic.parseDuration($("s-daily").value),
      limitPercent: Logic.parsePercent($("s-limit").value),
      state: $("s-state").value || null,
      defaultStart: Logic.minutesToTime(Logic.parseTime($("s-start").value, "Standard-Beginn")),
      defaultBreak: Logic.parseBreak($("s-break").value),
    });
    state.data.settings = (await api("settings", settings)).settings;
  } catch (error) {
    setStatus("settings-status", error.message, true);
    return;
  }
  setStatus("settings-status", "Gespeichert ✓");
  fillSettingsForm();
  render();
  if (state.editingId === null) setFormDay(formDayOrToday());
}

async function changePassword(event) {
  event.preventDefault();
  if ($("p-new").value !== $("p-new2").value) {
    setStatus("password-status", "Die beiden neuen Passwörter stimmen nicht überein.", true);
    return;
  }
  try {
    await api("password", { current: $("p-current").value, new: $("p-new").value });
  } catch (error) {
    setStatus("password-status", error.message, true);
    return;
  }
  $("password-form").reset();
  setStatus("password-status", "Passwort geändert ✓");
}

function exportData() {
  downloadExport(state.data, `homeoffice-rechner-${Logic.today()}.json`);
}

/** Save an account's data ({settings, entries, plan, flex}) as an export file. */
function downloadExport(data, filename) {
  const payload = { app: "homeoffice-rechner", version: 1, exportedAt: new Date().toISOString(),
    settings: data.settings,
    entries: data.entries.map(({ day, start, end, break: brk, location }) => ({ day, start, end, break: brk, location })),
    plan: data.plan,
    flex: data.flex.map(({ day, minutes, note }) => ({ day, minutes, note })) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = el("a", { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importData(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  let payload;
  try {
    payload = Logic.normalizeImport(JSON.parse(await file.text()));
  } catch (error) {
    setStatus("data-status", error instanceof SyntaxError
      ? "Die Datei ist keine gültige JSON-Datei." : error.message, true);
    return;
  }
  const question = `${plural(payload.entries.length, "Eintrag", "Einträge")} importieren? `
    + "Deine aktuellen Daten werden dabei ersetzt.";
  if (!window.confirm(question)) return;
  try {
    state.data = await api("import", payload);
  } catch (error) {
    setStatus("data-status", error.message, true);
    return;
  }
  setStatus("data-status", `${plural(state.data.entries.length, "Eintrag", "Einträge")} importiert ✓`);
  fillSettingsForm();
  renderFlexList();
  render();
  setFormDay(formDayOrToday());
}

// ---- flextime corrections ---------------------------------------------------------------

function renderFlexList() {
  const rows = [...state.data.flex].sort((a, b) => a.day.localeCompare(b.day)).map((f) => el("tr", {},
    el("td", {}, Logic.germanDate(f.day)),
    el("td", { class: f.minutes < 0 ? "neg" : "pos" }, `${Logic.formatSigned(f.minutes)} h`),
    el("td", { class: "note" }, f.note),
    el("td", { class: "actions" },
      el("button", { type: "button", class: "link", onclick: () => deleteFlex(f) }, "Löschen")),
  ));
  $("flex-body").replaceChildren(...rows);
  $("no-flex").hidden = rows.length > 0;
}

async function addFlex(event) {
  event.preventDefault();
  $("flex-error").textContent = "";
  try {
    const item = {
      day: Logic.parseDate($("x-date").value, state.year, state.month),
      minutes: Logic.parseSignedDuration($("x-minutes").value),
      note: $("x-note").value.trim(),
    };
    state.data.flex.push((await api("flex", item)).flex);
  } catch (error) {
    $("flex-error").textContent = error.message;
    return;
  }
  $("x-minutes").value = "";
  $("x-note").value = "";
  renderFlexList();
  render();
}

async function deleteFlex(item) {
  if (!window.confirm(`Korrektur ${Logic.formatSigned(item.minutes)} h vom ${Logic.germanDate(item.day)} löschen?`)) return;
  try {
    await api("delete-flex", { id: item.id });
  } catch (error) {
    $("flex-error").textContent = error.message;
    return;
  }
  state.data.flex = state.data.flex.filter((f) => f.id !== item.id);
  renderFlexList();
  render();
}

// ---- administration -----------------------------------------------------------------

const ROLE_LABELS = { user: "Nutzer", admin: "Admin", viewer: "Nur Lesen" };
// actions in the admin log (admin_log.action, written by lib/admin.php)
const ADMIN_ACTIONS = { invite: "Eingeladen", reset: "Passwort-Link erstellt", revoke: "Link zurückgezogen",
  role: "Rolle geändert", email: "E-Mail geändert", lock: "Gesperrt", unlock: "Entsperrt",
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
  if (self && self.email !== state.user.email) { // the admin changed the own e-mail
    state.user.email = self.email;
    $("user-email").textContent = self.email;
  }
  // the admin's own account may just have been assigned or removed
  state.data.viewers = admin.overview.users.filter((u) => u.isViewer && u.canView.includes(state.user.id)).map((u) => u.email);
  renderViewers();
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

function renderUsers() {
  const search = $("u-search").value.trim().toLowerCase();
  const filter = $("u-filter").value;
  const users = admin.overview.users.filter((u) => u.email.includes(search)
    && (!filter || (filter === "locked" ? u.lockedAt !== null : u.role === filter)));
  $("users-body").replaceChildren(...users.map((u) => el("tr", { class: "clickable", onclick: () => openAccount(u.id) },
    el("td", {}, u.email, u.id === state.user.id ? el("span", { class: "muted" }, " (du)") : null),
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
    el("td", {}, l.email),
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
  $("account-title").focus(); // not the e-mail field, which showModal would focus
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
    el("div", { class: "access" }, ...candidates.map((o, i) => el("label", { class: "checkbox" }, boxes[i], o.email))),
    el("div", { class: "form-actions" }, el("button", { type: "button", onclick: save }, "Freigaben speichern")));
}

function renderAccount() {
  const u = accountById(admin.detailId);
  const self = u.id === state.user.id;
  const email = el("input", { type: "email", class: "w-email", value: u.email, "aria-label": "E-Mail-Adresse" });
  const role = el("select", { "aria-label": "Rolle", disabled: self },
    ...Object.entries(ROLE_LABELS).map(([value, label]) => el("option", { value, selected: value === u.role }, label)));
  const status = u.lockedAt ? `Gesperrt seit ${germanDateTime(u.lockedAt)}` : "Aktiv";
  const log = admin.overview.log.filter((entry) => entry.targetId === u.id).slice(0, 10);

  const button = (label, onclick, props = {}) => el("button", { type: "button", onclick, ...props }, label);
  $("account-detail").replaceChildren(
    el("h3", { id: "account-title", tabIndex: -1 }, u.email, self ? el("span", { class: "muted" }, " (du)") : null),
    el("p", { class: "hint" }, `${ROLE_LABELS[u.role]} · seit ${Logic.germanDate(u.createdAt)} · ${status}`),

    detailSection("Konto",
      el("div", { class: "form-actions" }, email, button("E-Mail ändern", () => accountAction(
        () => api("admin-email", { id: u.id, email: email.value }), "E-Mail geändert ✓"))),
      el("div", { class: "form-actions" }, role, button("Rolle ändern", () => accountAction(
        () => api("admin-role", { id: u.id, role: role.value }), "Rolle geändert ✓"),
        { disabled: self, title: self ? "Deine eigene Rolle kann nur ein anderer Admin ändern." : undefined }))),

    detailSection("Zugang",
      el("p", { class: "hint" }, `${status} · ${plural(u.sessions, "aktive Sitzung", "aktive Sitzungen")}`),
      el("div", { class: "form-actions wrap" },
        button("Passwort-Link erstellen", async () => {
          const result = await accountAction(() => api("admin-reset", { email: u.email }), "Passwort-Link erstellt ✓");
          if (result) showLinkIn($("detail-link"), `Passwort-Link für ${u.email}. Er ist 24 Stunden gültig und funktioniert einmal.`, result.link);
        }, { disabled: Boolean(u.lockedAt) }),
        self ? null : button(u.lockedAt ? "Entsperren" : "Sperren", () => {
          if (!u.lockedAt && !window.confirm(`${u.email} sperren? Die Person wird sofort abgemeldet und kann sich nicht mehr anmelden; die Daten bleiben erhalten.`)) return;
          accountAction(() => api("admin-lock", { id: u.id, locked: !u.lockedAt }), u.lockedAt ? "Entsperrt ✓" : "Gesperrt ✓");
        }),
        self ? null : button("Überall abmelden", () => accountAction(() => api("admin-logout", { id: u.id }),
          (r) => `${plural(r.count, "Sitzung", "Sitzungen")} beendet ✓`), { disabled: u.sessions === 0 })),
      el("div", { id: "detail-link", class: "link-box", hidden: true })),

    accessSection(u),

    u.isViewer ? null : detailSection("Daten",
      el("div", { class: "form-actions" }, button("Daten exportieren", () => accountAction(async () => {
        const data = await api(`admin-export&id=${u.id}`);
        downloadExport(data, `homeoffice-rechner-${data.email}-${Logic.today()}.json`);
      }, "Export heruntergeladen ✓")))),

    detailSection("Protokoll", log.length
      ? el("div", { class: "table-card" }, el("table", { class: "entries" }, el("tbody", {}, ...log.map((entry) => logRow(entry, false)))))
      : el("p", { class: "hint" }, "Noch keine Admin-Aktionen zu diesem Konto.")),

    el("div", { class: "form-actions detail-footer" },
      self ? null : button("Konto löschen", async () => {
        if (!window.confirm(`Konto ${u.email} mit allen Daten endgültig löschen?`)) return;
        await accountAction(() => api("admin-delete-user", { id: u.id }), "");
      }, { class: "danger" }),
      el("span", { id: "detail-status", class: "status", role: "status" }),
      button("Schließen", () => $("account-dialog").close(), { class: "primary" })),
  );
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
  const email = $("i-email").value.trim();
  try {
    const role = $("i-role").value;
    const { link } = await api("admin-invite", { email, isAdmin: role === "admin", isViewer: role === "viewer" });
    showLinkIn($("link-box"), `Schicke diesen Link an ${email}. Er ist 7 Tage gültig und funktioniert einmal.`, link);
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

// ---- design --------------------------------------------------------------------------

function setupDesign() {
  const pick = (id, options, current, choose) => {
    const select = $(id);
    select.replaceChildren(...Object.entries(options).map(([value, label]) => el("option", { value }, label)));
    select.value = current;
    select.addEventListener("change", () => choose(select.value));
  };
  pick("s-design", Design.DESIGNS, Design.current(), Design.choose);
  pick("s-scheme", Design.SCHEMES, Design.scheme(), Design.chooseScheme);
}

function setupAdmin() {
  $("invite-form").addEventListener("submit", invite);
  $("u-search").addEventListener("input", () => admin.overview && renderUsers());
  $("u-filter").addEventListener("change", () => admin.overview && renderUsers());
}

// ---- help & news ------------------------------------------------------------------------

/** Admin e-mails as mailto links, separated by commas. */
function adminLinks() {
  return state.account.admins.flatMap((email, i) =>
    [i ? ", " : null, el("a", { href: `mailto:${email}` }, email)]);
}

function renderHelp() {
  const contacts = $("admin-contacts");
  if (state.user.isAdmin) contacts.replaceChildren("Du bist selbst Admin (Tab Benutzer).");
  else if (state.account.admins.length) contacts.replaceChildren("Admins: ", ...adminLinks());
  else contacts.replaceChildren("Es ist noch kein Admin eingetragen.");
  if (!state.user.isAdmin && state.account.admins.length) {
    $("viewer-empty").replaceChildren("Dir wurden noch keine Konten zum Ansehen freigegeben. Bitte wende dich an einen Admin: ",
      ...adminLinks(), ".");
  }
}

const NEWS_KEY = "neuigkeiten-gesehen";

/**
 * Ids of entries the user hasn't seen: those above the last seen one, or, on first use in
 * this browser, those since the account was created. Undefined when storage is unavailable
 * (then the dialog doesn't open by itself, instead of on every visit).
 */
function unseenNews(entries) {
  let seen;
  try {
    seen = localStorage.getItem(`${NEWS_KEY}-${state.user.id}`);
  } catch {
    return undefined;
  }
  const index = seen === null ? -1 : CHANGELOG.findIndex((entry) => entry.id === seen);
  if (index >= 0) return entries.filter((entry) => CHANGELOG.indexOf(entry) < index).map((entry) => entry.id);
  if (seen !== null) return []; // an id that no longer exists
  return entries.filter((entry) => entry.date >= state.account.createdAt).map((entry) => entry.id);
}

function markNewsSeen() {
  try {
    localStorage.setItem(`${NEWS_KEY}-${state.user.id}`, CHANGELOG[0].id);
  } catch { /* no storage */ }
}

function showNews(unseen = []) {
  const entries = CHANGELOG;
  $("news-list").replaceChildren(...entries.map((entry) => el("article", { class: unseen.includes(entry.id) ? "news new" : "news" },
    el("h4", {}, unseen.includes(entry.id) ? el("span", { class: "badge new-badge" }, "Neu") : null,
      entry.title, el("span", { class: "date" }, Logic.germanDate(entry.date))),
    el("ul", {}, ...entry.items.map((item) => el("li", {}, item))),
    entry.ask && !state.user.isAdmin ? el("p", { class: "ask" }, entry.ask) : null)));
  $("news-contacts").replaceChildren(...(state.user.isAdmin || !state.account.admins.length ? []
    : ["Fragen oder Wünsche? Admins: ", ...adminLinks()]));
  $("news-dialog").showModal();
  $("news-list").scrollTop = 0;
}

/** After login: open the dialog once when there is something new. */
function maybeShowNews() {
  const unseen = unseenNews(CHANGELOG);
  if (unseen === undefined) return;
  if (unseen.length) showNews(unseen);
  else markNewsSeen();
}

function setupNews() {
  $("news-btn").addEventListener("click", () => showNews());
  $("news-dialog").addEventListener("close", markNewsSeen);
}

// ---- tabs & startup -------------------------------------------------------------

const TABS = ["planung", "zeiterfassung", "einstellungen", "benutzer"];

function availableTabs() {
  if (state.readOnly && !state.data) return ["einstellungen"]; // nothing shared yet: only the password
  return TABS.filter((t) => t !== "benutzer" || state.user?.isAdmin);
}

function switchTab(name) {
  const available = availableTabs();
  if (!available.includes(name)) name = available[0];
  for (const button of document.querySelectorAll(".tabs button")) {
    button.setAttribute("aria-selected", String(button.dataset.tab === name));
  }
  for (const tab of TABS) $(`tab-${tab}`).hidden = tab !== name;
  history.replaceState(null, "", `#${name}`);
  hideMenu();
  if (name === "benutzer") loadAdmin();
}

async function init() {
  for (const button of document.querySelectorAll(".tabs button")) {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  }
  $("prev-month").addEventListener("click", () => changeMonth(-1));
  $("next-month").addEventListener("click", () => changeMonth(1));
  $("go-today").addEventListener("click", () => {
    state.year = now.getFullYear();
    state.month = now.getMonth() + 1;
    render();
  });
  $("logout").addEventListener("click", async () => {
    await api("logout", {}).catch(() => {});
    location.href = "login.php";
  });
  $("settings-form").addEventListener("submit", saveSettings);
  $("password-form").addEventListener("submit", changePassword);
  $("flex-form").addEventListener("submit", addFlex);
  $("export-btn").addEventListener("click", exportData);
  $("import-file").addEventListener("change", importData);
  setupAdmin();
  setupMenu();
  setupEntryForm();
  setupNews();
  setupDesign();

  try {
    const me = await api("me");
    state.user = me.user;
    state.account = { createdAt: me.createdAt, admins: me.admins };
    renderHelp();
    if (state.user.isViewer) {
      await initReadOnly();
      maybeShowNews();
      return;
    }
    state.data = await api("data");
  } catch (error) {
    showAppError(error.message);
    return;
  }
  $("user-email").textContent = state.user.email;
  document.querySelector('[data-tab="benutzer"]').hidden = !state.user.isAdmin;
  fillSettingsForm();
  renderFlexList();
  $("x-date").value = Logic.germanDate(Logic.today());
  switchTab(location.hash.slice(1));
  setFormDay(Logic.today());
  render();
  maybeShowNews();
}

// ---- read-only accounts ---------------------------------------------------------------

const OWNER_KEY = "ansicht-konto";

async function initReadOnly() {
  state.readOnly = true;
  document.body.classList.add("read-only");
  $("user-email").textContent = state.user.email;
  document.querySelector('[data-tab="zeiterfassung"]').textContent = "Einträge";
  document.querySelector('[data-tab="einstellungen"]').textContent = "Konto";
  document.querySelector('[data-tab="benutzer"]').hidden = true;
  const { accounts } = await api("shared");
  if (!accounts.length) {
    $("viewer-empty").hidden = false;
    for (const tab of ["planung", "zeiterfassung"]) document.querySelector(`[data-tab="${tab}"]`).hidden = true;
    $("summary").hidden = true;
    document.querySelector(".month-nav").hidden = true;
    switchTab("einstellungen");
    return;
  }
  let remembered = null;
  try { remembered = Number(localStorage.getItem(OWNER_KEY)); } catch { /* no storage */ }
  const select = $("owner-select");
  select.replaceChildren(...accounts.map((a) => el("option", { value: String(a.id) }, a.email)));
  if (accounts.some((a) => a.id === remembered)) select.value = String(remembered);
  select.addEventListener("change", () => showAccount(Number(select.value)).catch((e) => showAppError(e.message)));
  $("owner-box").hidden = false;
  await showAccount(Number(select.value));
  switchTab(location.hash.slice(1));
}

async function showAccount(id) {
  state.data = await api(`shared-data&owner=${id}`);
  try { localStorage.setItem(OWNER_KEY, String(id)); } catch { /* no storage */ }
  showAppError("");
  render();
}

init();
