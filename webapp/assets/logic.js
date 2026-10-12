"use strict";

// Pure domain logic: dates, parsing of user input, German public holidays,
// day classification, monthly forecast and form prefill. No DOM, no network.
// Dates are ISO strings ("2026-10-05"), times are minutes since midnight.
// Errors meant for the user are thrown as InputError with a German message.

const Logic = (() => {
  const HOME_OFFICE = "homeoffice";
  const OFFICE = "buero";
  const LOCATIONS = [HOME_OFFICE, OFFICE];

  // Day kinds
  const WORKDAY = "arbeitstag";
  const NON_WORKDAY = "kein_arbeitstag";
  const HOLIDAY = "feiertag";
  const DAY_OFF = "frei";
  // Kinds of days off. They differ only in label and color; all count like "frei".
  const OFF_TYPES = ["frei", "schule", "krank", "urlaub"];

  const STATES = {
    BW: "Baden-Württemberg", BY: "Bayern", BE: "Berlin", BB: "Brandenburg", HB: "Bremen",
    HH: "Hamburg", HE: "Hessen", MV: "Mecklenburg-Vorpommern", NI: "Niedersachsen",
    NW: "Nordrhein-Westfalen", RP: "Rheinland-Pfalz", SL: "Saarland", SN: "Sachsen",
    ST: "Sachsen-Anhalt", SH: "Schleswig-Holstein", TH: "Thüringen",
  };

  const DEFAULT_SETTINGS = Object.freeze({
    workdays: [0, 1, 2, 3, 4], schoolDays: [], homeOfficeDays: [], officeDays: [], dailyMinutes: 480, limitPercent: 30,
    state: null, defaultStart: "08:00", defaultBreak: 30,
  });

  class InputError extends Error {}

  // ---- dates & times ------------------------------------------------------------

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const parts = (day) => day.split("-").map(Number);

  function utc(day) {
    const [y, m, d] = parts(day);
    return new Date(Date.UTC(y, m - 1, d));
  }

  function fromUtc(date) {
    return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  /** Monday = 0 … Sunday = 6 */
  const weekday = (day) => (utc(day).getUTCDay() + 6) % 7;
  const addDays = (day, n) => { const t = utc(day); t.setUTCDate(t.getUTCDate() + n); return fromUtc(t); };
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  function isValidDate(y, m, d) {
    const t = new Date(Date.UTC(y, m - 1, d));
    return y >= 1 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }

  function today() {
    const t = new Date();
    return iso(t.getFullYear(), t.getMonth() + 1, t.getDate());
  }

  const germanDate = (day) => { const [y, m, d] = day.split("-"); return `${d}.${m}.${y}`; };
  const timeToMinutes = (text) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5));
  const minutesToTime = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

  /** 485 -> "8:05", -30 -> "-0:30" */
  function formatMinutes(minutes) {
    const sign = minutes < 0 ? "-" : "";
    const abs = Math.abs(minutes);
    return `${sign}${Math.floor(abs / 60)}:${pad(abs % 60)}`;
  }

  // ---- parsing of user input --------------------------------------------------------

  /** '5.10.2026', '5.10.26', '5.10.', '5.10', '5' -> ISO date; missing parts from refYear/refMonth. */
  function parseDate(text, refYear, refMonth) {
    const trimmed = text.trim();
    const pieces = trimmed.replace(/\.+$/, "").split(".");
    if (!trimmed || pieces.length > 3 || !pieces.every((p) => /^\d+$/.test(p))) {
      throw new InputError("Datum bitte als TT.MM.JJJJ eingeben (Kurzform: TT.MM. oder TT).");
    }
    const d = Number(pieces[0]);
    const m = pieces.length > 1 ? Number(pieces[1]) : refMonth;
    let y = pieces.length > 2 ? Number(pieces[2]) : refYear;
    if (y < 100) y += 2000;
    if (!isValidDate(y, m, d)) throw new InputError(`„${trimmed}“ ist kein gültiges Datum.`);
    return iso(y, m, d);
  }

  /** '8', '08', '830', '0830', '8:30', '8.30' -> minutes */
  function parseTime(text, label) {
    const match = /^(\d{1,2})(?:[:.,]?(\d{2}))?$/.exec(text.trim());
    if (match) {
      const hours = Number(match[1]);
      const minutes = Number(match[2] || 0);
      if (hours < 24 && minutes < 60) return hours * 60 + minutes;
    }
    throw new InputError(`${label} bitte als Uhrzeit eingeben, z. B. 8:30 oder 830.`);
  }

  function parseBreak(text) {
    const trimmed = text.trim() || "0";
    if (!/^\d+$/.test(trimmed)) throw new InputError("Pause bitte als ganze Minuten eingeben.");
    return Number(trimmed);
  }

  /** '7:30', '7,5' or '8' -> minutes */
  function parseDuration(text) {
    const trimmed = text.trim();
    let match = /^(\d+):(\d{1,2})$/.exec(trimmed);
    if (match) return Number(match[1]) * 60 + Number(match[2]);
    match = /^\d+(?:[.,]\d+)?$/.exec(trimmed);
    if (match) return Math.round(Number(trimmed.replace(",", ".")) * 60);
    throw new InputError("Sollstunden bitte als H:MM oder Zahl eingeben, z. B. 7:48.");
  }

  function parsePercent(text) {
    const trimmed = text.trim().replace(/%$/, "").trim().replace(",", ".");
    if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) throw new InputError("Limit bitte als Zahl eingeben, z. B. 30.");
    return Number(trimmed);
  }

  // ---- validation ---------------------------------------------------------------------

  function validateSettings(s) {
    const weekdays = (list) => list.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (!s.workdays.length || !weekdays(s.workdays)) {
      throw new InputError("Mindestens ein Wochentag muss Arbeitstag sein.");
    }
    if (!weekdays(s.schoolDays) || s.schoolDays.some((d) => s.workdays.includes(d))) {
      throw new InputError("Ein Wochentag kann nicht zugleich Arbeitstag und Berufsschultag sein.");
    }
    const homeOffice = s.homeOfficeDays || [];
    const office = s.officeDays || [];
    if (!weekdays(homeOffice) || !weekdays(office) || homeOffice.some((d) => office.includes(d))
      || [...homeOffice, ...office].some((d) => !s.workdays.includes(d))) {
      throw new InputError("Homeoffice- und Bürotage müssen Arbeitstage sein und dürfen sich nicht überschneiden.");
    }
    if (!(s.dailyMinutes > 0 && s.dailyMinutes <= 24 * 60)) {
      throw new InputError("Die Sollstunden pro Tag müssen zwischen 0:01 und 24:00 liegen.");
    }
    if (!(s.limitPercent >= 0 && s.limitPercent <= 100)) {
      throw new InputError("Das Limit muss zwischen 0 und 100 % liegen.");
    }
    if (s.state !== null && !(s.state in STATES)) throw new InputError("Unbekanntes Bundesland.");
    if (s.defaultBreak < 0) throw new InputError("Die Standard-Pause darf nicht negativ sein.");
    return s;
  }

  /** Entry in API shape: {id?, day, start "HH:MM", end, break, location}. */
  function validateEntry(e) {
    if (!LOCATIONS.includes(e.location)) throw new InputError("Bitte Homeoffice oder Büro wählen.");
    if (e.break < 0) throw new InputError("Die Pause darf nicht negativ sein.");
    const span = timeToMinutes(e.end) - timeToMinutes(e.start);
    if (span <= 0) throw new InputError("Das Ende muss nach dem Beginn liegen.");
    if (span - e.break <= 0) throw new InputError("Die Pause ist länger als die Arbeitszeit.");
    return e;
  }

  /** Minutes credited per day with logged work, on top of the worked time (flextime only). */
  const GIFT_MINUTES = 5;
  const workedMinutes = (e) => timeToMinutes(e.end) - timeToMinutes(e.start) - e.break;

  function findOverlap(entries, entry) {
    return entries.find((e) => e.id !== entry.id && e.day === entry.day
      && e.start < entry.end && entry.start < e.end) || null;
  }

  function defaultEnd(settings) {
    const end = timeToMinutes(settings.defaultStart) + settings.dailyMinutes + settings.defaultBreak;
    return minutesToTime(Math.min(end, 23 * 60 + 59));
  }

  // ---- holidays -------------------------------------------------------------------------

  /** Gregorian Easter Sunday (anonymous Gregorian algorithm). */
  function easterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return iso(year, month, day);
  }

  /**
   * Statewide public holidays as {isoDate: name}; empty without a state.
   * Holidays that only apply in parts of a state (e.g. Mariä Himmelfahrt in Bavaria) are omitted.
   */
  function holidays(year, state) {
    if (!state) return {};
    const easter = easterSunday(year);
    const result = {
      [iso(year, 1, 1)]: "Neujahr",
      [addDays(easter, -2)]: "Karfreitag",
      [addDays(easter, 1)]: "Ostermontag",
      [iso(year, 5, 1)]: "Tag der Arbeit",
      [addDays(easter, 39)]: "Christi Himmelfahrt",
      [addDays(easter, 50)]: "Pfingstmontag",
      [iso(year, 10, 3)]: "Tag der Deutschen Einheit",
      [iso(year, 12, 25)]: "1. Weihnachtstag",
      [iso(year, 12, 26)]: "2. Weihnachtstag",
    };
    const add = (states, day, name, since = 0) => {
      if (states.includes(state) && year >= since) result[day] = name;
    };
    add(["BW", "BY", "ST"], iso(year, 1, 6), "Heilige Drei Könige");
    add(["BE"], iso(year, 3, 8), "Frauentag", 2019);
    add(["MV"], iso(year, 3, 8), "Frauentag", 2023);
    add(["BB"], easter, "Ostersonntag");
    add(["BB"], addDays(easter, 49), "Pfingstsonntag");
    add(["BW", "BY", "HE", "NW", "RP", "SL"], addDays(easter, 60), "Fronleichnam");
    add(["SL"], iso(year, 8, 15), "Mariä Himmelfahrt");
    add(["TH"], iso(year, 9, 20), "Weltkindertag", 2019);
    add(["BB", "MV", "SN", "ST", "TH"], iso(year, 10, 31), "Reformationstag");
    add(["HB", "HH", "NI", "SH"], iso(year, 10, 31), "Reformationstag", 2018);
    add(["BW", "BY", "NW", "RP", "SL"], iso(year, 11, 1), "Allerheiligen");
    const nov22 = iso(year, 11, 22);
    add(["SN"], addDays(nov22, -((weekday(nov22) - 2 + 7) % 7)), "Buß- und Bettag");
    return result;
  }

  /**
   * Location a workday of this weekday is planned with by default (settings.homeOfficeDays /
   * officeDays, optional: older stored settings lack them), or null.
   */
  function defaultLocation(settings, day) {
    const wd = weekday(day);
    if (!settings.workdays.includes(wd)) return null;
    if ((settings.homeOfficeDays || []).includes(wd)) return HOME_OFFICE;
    if ((settings.officeDays || []).includes(wd)) return OFFICE;
    return null;
  }

  /** Planned location of a day: its plan row, else the weekday default (unless planned off). */
  function plannedLocation(data, day) {
    const status = data.plan[day] || null;
    if (LOCATIONS.includes(status)) return status;
    return status === null ? defaultLocation(data.settings, day) : null;
  }

  // ---- month view & forecast --------------------------------------------------------------

  /**
   * Classify every day of a month. data = {settings, entries, plan: {isoDate: status}}.
   * schoolPeriods = [{start, end, name}] (display only, see normalizeSchoolHolidays).
   *
   * Precedence: holiday > planned day off > workday. A weekday that the settings mark as
   * Berufsschule/Studium (settings.schoolDays), and a Monday–Friday that is no workday, is a
   * day off by default ("defaultOff", shown as "schule" or "frei"), but can be planned as
   * Homeoffice/Büro for single days. Saturday/Sunday that are neither stay non-workdays
   * unless planned. A workday whose weekday has a default location (settings.homeOfficeDays /
   * officeDays) counts as planned with it unless the day has its own plan row.
   */
  function monthDays(year, month, data, schoolPeriods = []) {
    const names = holidays(year, data.settings.state);
    const prefix = `${year}-${pad(month)}-`;
    const actual = {};
    for (const e of data.entries) {
      if (!e.day.startsWith(prefix)) continue;
      const perDay = (actual[e.day] = actual[e.day] || {});
      perDay[e.location] = (perDay[e.location] || 0) + workedMinutes(e);
    }
    const days = [];
    for (let d = 1; d <= daysInMonth(year, month); d++) {
      const day = iso(year, month, d);
      const status = data.plan[day] || null;
      const location = plannedLocation(data, day);
      const isWorkday = data.settings.workdays.includes(weekday(day));
      const isSchoolDay = (data.settings.schoolDays || []).includes(weekday(day));
      const defaultOff = !isWorkday && (isSchoolDay || weekday(day) <= 4);
      const defaultOffType = isSchoolDay ? "schule" : DAY_OFF;
      let kind;
      if (day in names) kind = HOLIDAY;
      else if (OFF_TYPES.includes(status)) kind = DAY_OFF;
      else if (isWorkday || location) kind = WORKDAY;
      else kind = defaultOff ? DAY_OFF : NON_WORKDAY;
      const school = schoolPeriods.find((p) => p.start <= day && day <= p.end) || null;
      days.push({
        date: day,
        kind,
        defaultOff,
        defaultOffType: defaultOff ? defaultOffType : null,
        defaultLocation: defaultLocation(data.settings, day),
        offType: kind === DAY_OFF ? (OFF_TYPES.includes(status) ? status : defaultOffType) : null,
        holiday: names[day] || null,
        planned: kind === WORKDAY ? location : null,
        actual: actual[day] || {},
        school: school && school.name,
        schoolStart: school !== null && (school.start === day || d === 1),
      });
    }
    return days;
  }

  /** OpenHolidays API response -> [{start, end, name}] (German name). */
  function normalizeSchoolHolidays(response) {
    if (!Array.isArray(response)) return [];
    return response
      .filter((p) => typeof p.startDate === "string" && typeof p.endDate === "string")
      .map((p) => {
        const names = Array.isArray(p.name) ? p.name : [];
        const german = names.find((n) => n.language === "DE") || names[0];
        return { start: p.startDate, end: p.endDate, name: (german && german.text) || "Schulferien" };
      });
  }

  /**
   * Logged time beats planning; planned, unlogged workdays count with the daily target;
   * unplanned, unlogged workdays count toward the total as office, so the forecast
   * percentage is a lower bound.
   */
  function forecast(days, settings) {
    const actual = { [HOME_OFFICE]: 0, [OFFICE]: 0 };
    const planned = { [HOME_OFFICE]: 0, [OFFICE]: 0 };
    let openDays = 0;
    for (const d of days) {
      for (const [loc, minutes] of Object.entries(d.actual)) actual[loc] += minutes;
      const logged = Object.keys(d.actual).length > 0;
      if (d.kind !== WORKDAY || logged) continue;
      if (d.planned) planned[d.planned] += settings.dailyMinutes;
      else openDays += 1;
    }
    const percent = (part, total) => (total === 0 ? 0 : (100 * part) / total);
    const actualTotal = actual[HOME_OFFICE] + actual[OFFICE];
    const expectedHomeOffice = actual[HOME_OFFICE] + planned[HOME_OFFICE];
    const expectedTotal = actualTotal + planned[HOME_OFFICE] + planned[OFFICE] + openDays * settings.dailyMinutes;
    return {
      workdays: days.filter((d) => d.kind === WORKDAY).length,
      holidays: days.filter((d) => d.kind === HOLIDAY).length,
      daysOff: days.filter((d) => d.kind === DAY_OFF).length,
      actual,
      planned,
      openDays,
      actualPercent: percent(actual[HOME_OFFICE], actualTotal),
      forecastPercent: percent(expectedHomeOffice, expectedTotal),
      limitPercent: settings.limitPercent,
      dailyMinutes: settings.dailyMinutes,
      // home office minutes still allowed this month; negative = limit exceeded
      remaining: Math.trunc((expectedTotal * settings.limitPercent) / 100 - expectedHomeOffice),
    };
  }

  /**
   * Suggested values for a new entry on `day`: defaults from the settings, or, if the day
   * already has entries, continuing after the last one. The break is always the default.
   */
  function prefill(data, day) {
    const s = data.settings;
    const ends = data.entries.filter((e) => e.day === day).map((e) => e.end).sort();
    let start = s.defaultStart;
    let end = defaultEnd(s);
    if (ends.length) {
      start = ends[ends.length - 1];
      const after = minutesToTime(Math.min(timeToMinutes(start) + 60 + s.defaultBreak, 23 * 60 + 59));
      end = after > end ? after : end;
    }
    return { start, end, break: s.defaultBreak, location: plannedLocation(data, day) };
  }

  // ---- flextime account ------------------------------------------------------------------

  /** '-0:20', '+1:30', '1:30', '-20' (minutes) -> signed minutes. */
  function parseSignedDuration(text) {
    const trimmed = text.trim().replace("−", "-").replace(/\s+/g, "");
    const match = /^([+-]?)(\d+)(?::(\d{2}))?$/.exec(trimmed);
    if (!match || (match[3] !== undefined && Number(match[3]) > 59)) {
      throw new InputError("Korrektur bitte als ±H:MM oder in Minuten eingeben, z. B. -0:20 oder -20.");
    }
    const minutes = match[3] === undefined ? Number(match[2]) : Number(match[2]) * 60 + Number(match[3]);
    if (minutes === 0) throw new InputError("Die Korrektur darf nicht 0:00 sein.");
    return match[1] === "-" ? -minutes : minutes;
  }

  /** 25 -> "+0:25", -20 -> "-0:20", 0 -> "±0:00" */
  function formatSigned(minutes) {
    if (minutes === 0) return "±0:00";
    return (minutes > 0 ? "+" : "") + formatMinutes(minutes);
  }

  /**
   * Flextime: every day with logged work has the daily target as "Soll"; the difference
   * per day is worked − target. Days without entries (vacation, days off, not yet logged)
   * don't count. Every such day gets GIFT_MINUTES on top of the worked time. Manual corrections (data.flex) are added on their date.
   */
  function flexByDay(data) {
    const worked = {};
    for (const e of data.entries) worked[e.day] = (worked[e.day] || 0) + workedMinutes(e);
    const result = {};
    for (const [day, minutes] of Object.entries(worked)) result[day] = minutes + GIFT_MINUTES - data.settings.dailyMinutes;
    return result;
  }

  /** Flextime of one month and the balance at its end (including corrections). */
  function flexSummary(data, year, month) {
    const prefix = `${year}-${pad(month)}-`;
    const monthEnd = iso(year, month, daysInMonth(year, month));
    let monthTotal = 0;
    let balance = 0;
    const add = (day, minutes) => {
      if (day <= monthEnd) balance += minutes;
      if (day.startsWith(prefix)) monthTotal += minutes;
    };
    for (const [day, diff] of Object.entries(flexByDay(data))) add(day, diff);
    for (const f of data.flex || []) add(f.day, f.minutes);
    return { month: monthTotal, balance };
  }

  // ---- import ------------------------------------------------------------------------------

  /** Accepts an export of this app or the data file of the former desktop version. */
  function normalizeImport(json) {
    if (!json || typeof json !== "object" || !Array.isArray(json.entries)) {
      throw new InputError("Die Datei enthält keine gültigen Homeoffice-Rechner-Daten.");
    }
    if (json.app === "homeoffice-rechner") {
      return { settings: json.settings, entries: json.entries, plan: json.plan || {}, flex: json.flex || [] };
    }
    // former desktop version (eintraege.json, snake_case)
    const s = json.settings || {};
    const plan = { ...(json.plan || {}) };
    for (const day of json.days_off || []) plan[day] = DAY_OFF;
    return {
      settings: json.settings ? {
        workdays: s.workdays, dailyMinutes: s.daily_minutes, limitPercent: s.limit_percent,
        state: s.state ?? null, defaultStart: s.default_start ?? "08:00",
        defaultBreak: s.default_break_minutes ?? 30,
      } : { ...DEFAULT_SETTINGS },
      entries: json.entries.map((e) => ({
        day: e.day, start: e.start, end: e.end, break: e.break_minutes, location: e.location,
      })),
      plan,
      flex: [],
    };
  }

  return {
    HOME_OFFICE, OFFICE, LOCATIONS, WORKDAY, NON_WORKDAY, HOLIDAY, DAY_OFF, OFF_TYPES, STATES, DEFAULT_SETTINGS,
    GIFT_MINUTES, InputError, iso, weekday, addDays, daysInMonth, today, germanDate, timeToMinutes, minutesToTime,
    formatMinutes, parseDate, parseTime, parseBreak, parseDuration, parsePercent, validateSettings,
    validateEntry, workedMinutes, findOverlap, defaultEnd, easterSunday, holidays, defaultLocation,
    plannedLocation, monthDays,
    normalizeSchoolHolidays, forecast, prefill, parseSignedDuration, formatSigned, flexByDay,
    flexSummary, normalizeImport,
  };
})();
