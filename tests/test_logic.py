"""Tests for webapp/assets/logic.js, run in a headless browser."""

import json
import unittest

from tests.support import WEBAPP, Browser


class LogicTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.browser = Browser()
        cls.browser.js((WEBAPP / "assets" / "logic.js").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()

    def js(self, expression):
        return self.browser.js(expression)

    def error(self, expression):
        """The InputError message raised by the expression."""
        return self.js(f"(() => {{ try {{ {expression}; return null; }} catch (e) {{"
                       f" return e instanceof Logic.InputError ? e.message : 'kein InputError: ' + e; }} }})()")

    # -- dates & parsing --

    def test_easter_and_holidays(self):
        self.assertEqual(self.js("[2024, 2026, 2027].map(Logic.easterSunday)"),
                         ["2024-03-31", "2026-04-05", "2027-03-28"])
        nw = self.js("Logic.holidays(2026, 'NW')")
        self.assertEqual(nw["2026-06-04"], "Fronleichnam")
        self.assertIn("2026-11-01", nw)
        self.assertNotIn("2026-10-31", nw)
        self.assertIn("2026-10-31", self.js("Logic.holidays(2026, 'NI')"))
        self.assertEqual(self.js("Logic.holidays(2026, 'SN')['2026-11-18']"), "Buß- und Bettag")
        self.assertEqual(self.js("Logic.holidays(2026, null)"), {})

    def test_parse_date(self):
        cases = {"05.11.2026": "2026-11-05", "5.11.26": "2026-11-05", "5.11.": "2026-11-05",
                 "5.11": "2026-11-05", "5": "2026-10-05", " 5. ": "2026-10-05"}
        for text, expected in cases.items():
            self.assertEqual(self.js(f"Logic.parseDate({json.dumps(text)}, 2026, 10)"), expected, text)
        for text in ("", "31.11.2026", "a.b", "1.2.3.4", "1-2-2026"):
            self.assertIsNotNone(self.error(f"Logic.parseDate({json.dumps(text)}, 2026, 10)"), text)

    def test_parse_time_and_numbers(self):
        cases = {"8": 480, "08": 480, "830": 510, "0830": 510, "8:30": 510, "8.30": 510, "16": 960, "1645": 1005}
        for text, expected in cases.items():
            self.assertEqual(self.js(f"Logic.parseTime({json.dumps(text)}, 'Beginn')"), expected, text)
        for text in ("", "24", "8:60", "12345", "acht"):
            self.assertIn("Beginn", self.error(f"Logic.parseTime({json.dumps(text)}, 'Beginn')"), text)
        self.assertEqual(self.js("['7:48', '7,8', '8'].map(Logic.parseDuration)"), [468, 468, 480])
        self.assertEqual(self.js("['30', '30 %', '12,5'].map(Logic.parsePercent)"), [30, 30, 12.5])
        self.assertIsNotNone(self.error("Logic.parsePercent('')"))
        self.assertEqual(self.js("[485, -30].map(Logic.formatMinutes)"), ["8:05", "-0:30"])

    def test_validation(self):
        entry = "{day: '2026-10-01', start: '08:00', end: '16:30', break: 30, location: 'homeoffice'}"
        self.assertEqual(self.js(f"Logic.workedMinutes({entry})"), 480)
        self.assertIn("Ende", self.error(f"Logic.validateEntry({{...{entry}, end: '07:00'}})"))
        self.assertIn("Pause", self.error(f"Logic.validateEntry({{...{entry}, break: 600}})"))
        self.assertTrue(self.js(f"!!Logic.findOverlap([{{...{entry}, id: 'a'}}], {{...{entry}, start: '16:00', end: '17:00'}})"))
        self.assertFalse(self.js(f"!!Logic.findOverlap([{{...{entry}, id: 'a'}}], {{...{entry}, start: '16:30', end: '17:00'}})"))
        self.assertIn("Wochentag", self.error("Logic.validateSettings({...Logic.DEFAULT_SETTINGS, workdays: []})"))

    # -- month & forecast --

    def test_day_kinds(self):
        kinds = self.js("""Object.fromEntries(Logic.monthDays(2026, 10, {
            settings: {...Logic.DEFAULT_SETTINGS, workdays: [0, 1, 2, 3], state: 'NI'},
            entries: [], plan: {'2026-10-05': 'frei'}}).map(d => [Number(d.date.slice(8)), d.kind]))""")
        self.assertEqual((kinds["1"], kinds["2"], kinds["3"], kinds["4"], kinds["5"], kinds["31"]),
                         ("arbeitstag", "frei", "feiertag", "kein_arbeitstag", "frei", "feiertag"))

    def test_weekdays_outside_workdays_are_free_but_can_be_planned(self):
        # workdays Mo, Do, Fr: Tuesdays and Wednesdays are free by default
        days = self.js("""Object.fromEntries(Logic.monthDays(2026, 10, {
            settings: {...Logic.DEFAULT_SETTINGS, workdays: [0, 3, 4]}, entries: [],
            plan: {'2026-10-07': 'buero', '2026-10-10': 'homeoffice'}})
            .map(d => [Number(d.date.slice(8)), [d.kind, d.defaultOff, d.planned]]))""")
        self.assertEqual(days["5"], ["arbeitstag", False, None])    # Monday
        self.assertEqual(days["6"], ["frei", True, None])           # Tuesday, free by default
        self.assertEqual(days["7"], ["arbeitstag", True, "buero"])  # Wednesday planned anyway
        self.assertEqual(days["10"], ["arbeitstag", False, "homeoffice"])  # Saturday planned
        self.assertEqual(days["11"], ["kein_arbeitstag", False, None])      # Sunday
        f = self.js("""(() => { const data = {settings: {...Logic.DEFAULT_SETTINGS, workdays: [0, 3, 4]},
            entries: [], plan: {'2026-10-07': 'buero'}};
            return Logic.forecast(Logic.monthDays(2026, 10, data), data.settings); })()""")
        self.assertEqual(f["workdays"], 15)  # 14 Mo/Do/Fr in October 2026 + the planned Wednesday
        self.assertEqual(f["daysOff"], 7)   # 4 Tuesdays + 3 unplanned Wednesdays
        self.assertEqual(f["planned"]["buero"], 480)

    def test_school_days_from_settings(self):
        days = self.js("""Object.fromEntries(Logic.monthDays(2026, 10, {
            settings: {...Logic.DEFAULT_SETTINGS, workdays: [0, 2, 3, 4], schoolDays: [1, 5]}, entries: [],
            plan: {'2026-10-13': 'homeoffice', '2026-10-20': 'urlaub'}})
            .map(d => [Number(d.date.slice(8)), [d.kind, d.offType, d.defaultOffType, d.planned]]))""")
        self.assertEqual(days["6"], ["frei", "schule", "schule", None])        # Tuesday = Berufsschule
        self.assertEqual(days["13"], ["arbeitstag", None, "schule", "homeoffice"])  # planned anyway
        self.assertEqual(days["20"], ["frei", "urlaub", "schule", None])
        self.assertEqual(days["10"], ["frei", "schule", "schule", None])       # Saturday Berufsschule
        self.assertEqual(days["11"], ["kein_arbeitstag", None, None, None])    # Sunday
        self.assertIn("zugleich", self.error(
            "Logic.validateSettings({...Logic.DEFAULT_SETTINGS, workdays: [0, 1], schoolDays: [1]})"))
        # settings without schoolDays (older data) still work
        self.assertEqual(self.js("""Logic.monthDays(2026, 10, {settings: {workdays: [0, 1, 2, 3, 4],
            dailyMinutes: 480, limitPercent: 30, state: null, defaultStart: '08:00', defaultBreak: 30},
            entries: [], plan: {}})[5].kind"""), "arbeitstag")

    def test_weekday_default_locations(self):
        # Mo Homeoffice, Di Büro, Mi–Fr plain workdays; NW: 03.10. is a holiday (Saturday, irrelevant)
        data = ("{settings: {...Logic.DEFAULT_SETTINGS, homeOfficeDays: [0], officeDays: [1]}, entries: [],"
                " plan: {'2026-10-12': 'buero', '2026-10-13': 'urlaub'}}")
        days = self.js(f"Object.fromEntries(Logic.monthDays(2026, 10, {data})"
                       ".map(d => [Number(d.date.slice(8)), [d.kind, d.planned, d.defaultLocation]]))")
        self.assertEqual(days["5"], ["arbeitstag", "homeoffice", "homeoffice"])  # Monday by default
        self.assertEqual(days["6"], ["arbeitstag", "buero", "buero"])            # Tuesday by default
        self.assertEqual(days["7"], ["arbeitstag", None, None])                  # Wednesday unplanned
        self.assertEqual(days["12"], ["arbeitstag", "buero", "homeoffice"])      # plan row wins
        self.assertEqual(days["13"], ["frei", None, "buero"])                    # planned day off wins
        f = self.js(f"(() => {{ const data = {data}; return Logic.forecast(Logic.monthDays(2026, 10, data), data.settings); }})()")
        # 4 Mondays HO (one replaced by Büro), 4 Tuesdays Büro (one on vacation) + the Monday
        self.assertEqual((f["planned"]["homeoffice"], f["planned"]["buero"]), (3 * 480, 4 * 480))
        self.assertEqual(self.js(f"Logic.prefill({data}, '2026-10-19').location"), "homeoffice")
        self.assertIsNone(self.js(f"Logic.prefill({data}, '2026-10-13').location"))
        # only workdays, not both at once
        for bad in ("workdays: [0, 1], homeOfficeDays: [2]", "homeOfficeDays: [0], officeDays: [0]"):
            self.assertIn("Arbeitstage", self.error(f"Logic.validateSettings({{...Logic.DEFAULT_SETTINGS, {bad}}})"))

    def test_day_off_types_only_differ_in_look(self):
        days = self.js("""Object.fromEntries(Logic.monthDays(2026, 10, {
            settings: {...Logic.DEFAULT_SETTINGS, workdays: [0, 3, 4]}, entries: [],
            plan: {'2026-10-05': 'urlaub', '2026-10-08': 'krank', '2026-10-09': 'schule',
                   '2026-10-12': 'frei', '2026-10-06': 'urlaub'}})
            .map(d => [Number(d.date.slice(8)), [d.kind, d.offType]]))""")
        self.assertEqual(days["5"], ["frei", "urlaub"])
        self.assertEqual(days["8"], ["frei", "krank"])
        self.assertEqual(days["9"], ["frei", "schule"])
        self.assertEqual(days["12"], ["frei", "frei"])
        self.assertEqual(days["6"], ["frei", "urlaub"])   # Tuesday, free by default, marked as vacation
        self.assertEqual(days["13"], ["frei", "frei"])    # Tuesday, free by default
        self.assertEqual(days["1"], ["arbeitstag", None])
        counts = self.js("""(() => { const s = {...Logic.DEFAULT_SETTINGS};
            const f = (plan) => Logic.forecast(Logic.monthDays(2026, 10, {settings: s, entries: [], plan}), s);
            return ['frei', 'schule', 'krank', 'urlaub'].map(t => {
                const r = f({'2026-10-05': t}); return [r.workdays, r.daysOff, r.remaining]; }); })()""")
        self.assertEqual(len({tuple(c) for c in counts}), 1)  # identical results for all four

    def test_school_holidays(self):
        api = [{"startDate": "2026-10-17", "endDate": "2026-10-31", "name": [{"language": "DE", "text": "Herbstferien"}]},
               {"startDate": "2026-09-01", "endDate": "2026-09-01", "name": []},
               {"foo": "kaputt"}]
        periods = self.js(f"Logic.normalizeSchoolHolidays({json.dumps(api)})")
        self.assertEqual(periods, [{"start": "2026-10-17", "end": "2026-10-31", "name": "Herbstferien"},
                                   {"start": "2026-09-01", "end": "2026-09-01", "name": "Schulferien"}])
        self.assertEqual(self.js("Logic.normalizeSchoolHolidays({error: 1})"), [])
        days = self.js(f"""Object.fromEntries(Logic.monthDays(2026, 10,
            {{settings: {{...Logic.DEFAULT_SETTINGS}}, entries: [], plan: {{}}}}, {json.dumps(periods)})
            .map(d => [Number(d.date.slice(8)), [d.school, d.schoolStart]]))""")
        self.assertEqual(days["16"], [None, False])
        self.assertEqual(days["17"], ["Herbstferien", True])
        self.assertEqual(days["20"], ["Herbstferien", False])
        # display only: the forecast does not change
        same = self.js(f"""(() => {{ const data = {{settings: {{...Logic.DEFAULT_SETTINGS}}, entries: [], plan: {{}}}};
            const a = Logic.forecast(Logic.monthDays(2026, 10, data), data.settings);
            const b = Logic.forecast(Logic.monthDays(2026, 10, data, {json.dumps(periods)}), data.settings);
            return JSON.stringify(a) === JSON.stringify(b); }})()""")
        self.assertTrue(same)

    def test_forecast(self):
        f = self.js("""(() => {
            const data = {settings: {...Logic.DEFAULT_SETTINGS},
              entries: [{day: '2026-10-01', start: '08:00', end: '14:00', break: 0, location: 'homeoffice'}],
              plan: {'2026-10-05': 'homeoffice', '2026-10-06': 'buero', '2026-10-01': 'buero'}};
            return Logic.forecast(Logic.monthDays(2026, 10, data), data.settings);
        })()""")
        self.assertEqual(f["workdays"], 22)
        self.assertEqual(f["actual"]["homeoffice"], 360)
        self.assertEqual(f["planned"], {"homeoffice": 480, "buero": 480})
        self.assertEqual(f["openDays"], 19)
        self.assertAlmostEqual(f["forecastPercent"], 100 * 14 / 174)
        self.assertEqual(f["remaining"], int(174 * 60 * 0.3 - 14 * 60))

    def test_prefill(self):
        data = ("{settings: {...Logic.DEFAULT_SETTINGS}, plan: {'2026-10-05': 'buero'}, entries: "
                "[{day: '2026-10-06', start: '08:00', end: '16:00', break: 30, location: 'buero'}]}")
        self.assertEqual(self.js(f"Logic.prefill({data}, '2026-10-05')"),
                         {"start": "08:00", "end": "16:30", "break": 30, "location": "buero"})
        self.assertEqual(self.js(f"Logic.prefill({data}, '2026-10-06')"),
                         {"start": "16:00", "end": "17:30", "break": 30, "location": None})

    def test_parse_and_format_signed_duration(self):
        cases = {"-0:20": -20, "−0:20": -20, "+1:30": 90, "1:30": 90, "-20": -20, "45": 45, " - 2:05 ": -125}
        for text, expected in cases.items():
            self.assertEqual(self.js(f"Logic.parseSignedDuration({json.dumps(text)})"), expected, text)
        for text in ("", "0", "-0:00", "1:75", "abc", "1,5"):
            self.assertIsNotNone(self.error(f"Logic.parseSignedDuration({json.dumps(text)})"), text)
        self.assertEqual(self.js("[25, -20, 0, 125].map(Logic.formatSigned)"), ["+0:25", "-0:20", "±0:00", "+2:05"])

    def test_flextime(self):
        # target 8:00 per day with logged work (+5 min gift per such day); days without entries don't count
        data = """{settings: {...Logic.DEFAULT_SETTINGS}, plan: {}, entries: [
            {day: '2026-10-01', start: '08:00', end: '17:15', break: 30, location: 'homeoffice'},
            {day: '2026-10-02', start: '08:00', end: '12:00', break: 0, location: 'buero'},
            {day: '2026-10-02', start: '13:00', end: '16:30', break: 0, location: 'homeoffice'},
            {day: '2026-11-02', start: '08:00', end: '15:30', break: 0, location: 'buero'}],
            flex: [{day: '2026-09-30', minutes: -20, note: 'Übertrag September'}]}"""
        self.assertEqual(self.js(f"Logic.flexByDay({data})"),
                         {"2026-10-01": 50, "2026-10-02": -25, "2026-11-02": -25})
        self.assertEqual(self.js(f"Logic.flexSummary({data}, 2026, 9)"), {"month": -20, "balance": -20})
        self.assertEqual(self.js(f"Logic.flexSummary({data}, 2026, 10)"), {"month": 25, "balance": 5})
        self.assertEqual(self.js(f"Logic.flexSummary({data}, 2026, 11)"), {"month": -25, "balance": -20})
        self.assertEqual(self.js("Logic.flexSummary({settings: Logic.DEFAULT_SETTINGS, entries: [], plan: {}}, 2026, 10)"),
                         {"month": 0, "balance": 0})

    def test_import_of_former_desktop_file(self):
        legacy = {"version": 2, "settings": {"workdays": [0, 3, 4], "daily_minutes": 480, "limit_percent": 30.0,
                                             "state": "NW", "default_start": "08:00", "default_break_minutes": 30},
                  "entries": [{"id": "x", "day": "2026-10-01", "start": "08:02", "end": "17:17",
                               "break_minutes": 30, "location": "homeoffice"}],
                  "plan": {"2026-10-05": "buero"}, "days_off": ["2026-10-12"]}
        result = self.js(f"Logic.normalizeImport({json.dumps(legacy)})")
        self.assertEqual(result["settings"]["state"], "NW")
        self.assertEqual(result["entries"], [{"day": "2026-10-01", "start": "08:02", "end": "17:17",
                                              "break": 30, "location": "homeoffice"}])
        self.assertEqual(result["plan"], {"2026-10-05": "buero", "2026-10-12": "frei"})
        self.assertIsNotNone(self.error("Logic.normalizeImport({foo: 1})"))


if __name__ == "__main__":
    unittest.main()
