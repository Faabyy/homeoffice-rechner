import os
import sqlite3
import time
import unittest
from pathlib import Path

from tests.support import SETUP_KEY, Client, PhpServer

ENTRY = {"day": "2026-10-05", "start": "08:00", "end": "16:30", "break": 30, "location": "homeoffice"}


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.server = PhpServer()
        self.admin = Client(self.server)
        self.assertEqual(self.admin.setup_admin(), 302)

    def tearDown(self):
        self.server.close()

    def invite_user(self, email="kollegin@example.org", password="kollegin-pw-1"):
        status, res = self.admin.api("admin-invite", {"username": email})
        self.assertEqual(status, 200, res)
        token = res["link"].split("token=")[1]
        user = Client(self.server)
        status, res = user.api("redeem", {"token": token, "password": password})
        self.assertEqual(status, 200, res)
        return user, token

    # -- setup & login --

    def test_setup_only_once_and_needs_key(self):
        status, _, body = Client(self.server).request("GET", "setup.php?key=falsch")
        self.assertIn("Ungültiger oder fehlender Schlüssel", body.decode())
        other = Client(self.server)
        other.setup_admin("zweiter@example.org")
        self.assertEqual(other.api("me")[0], 401)
        _, _, body = other.request("GET", f"setup.php?key={SETUP_KEY}")
        self.assertIn("Einrichtung ist abgeschlossen", body.decode())

    def test_login_logout_and_pages(self):
        client = Client(self.server)
        status, headers, _ = client.request("GET", "")
        self.assertEqual((status, headers["Location"]), (302, "/login.php"))
        self.assertEqual(client.api("login", {"username": "ADMIN@example.org", "password": "falsch"})[0], 401)
        status, res = client.api("login", {"username": "ADMIN@example.org", "password": "geheim12345"})
        self.assertEqual((status, res["user"]["username"], res["user"]["isAdmin"]), (200, "admin@example.org", True))
        status, headers, body = client.request("GET", "")
        self.assertEqual(status, 200)
        self.assertIn("default-src 'self'", headers["Content-Security-Policy"])
        self.assertRegex(body.decode(), r'src="assets/app\.js\?v=\d+"')  # versioned against stale caches
        cookie = next(c for c in client.jar if c.name == "hor_session")
        self.assertTrue(cookie.has_nonstandard_attr("HttpOnly"))
        client.api("logout", {})
        self.assertEqual(client.api("me")[0], 401)

    def test_login_rate_limit(self):
        client = Client(self.server)
        for _ in range(5):
            self.assertEqual(client.api("login", {"username": "admin@example.org", "password": "falsch"})[0], 401)
        status, res = client.api("login", {"username": "admin@example.org", "password": "geheim12345"})
        self.assertEqual(status, 429)
        self.assertIn("15 Minuten", res["error"])

    def test_manifest_colours_follow_the_look_cookie(self):
        def colours(cookie=None):
            headers = {"Cookie": cookie} if cookie else {}
            status, hdrs, raw = Client(self.server).request("GET", "manifest.php", headers=headers)
            self.assertEqual(status, 200)
            self.assertIn("manifest+json", hdrs["Content-Type"])
            manifest = __import__("json").loads(raw)
            return manifest["theme_color"], manifest["background_color"], manifest["start_url"]
        self.assertEqual(colours(), ("#ffffff", "#ffffff", "./"))
        self.assertEqual(colours("look=warm-dark")[:2], ("#1c1b1a", "#1c1b1a"))
        self.assertEqual(colours("look=klassisch-light")[:2], ("#e2ddd2", "#e2ddd2"))
        for junk in ("look=evil-dark", "look=warm-purple", "look=../../x", "look="):
            self.assertEqual(colours(junk)[:2], ("#ffffff", "#ffffff"), junk)

    def test_protected_files_are_not_served_by_api(self):
        self.assertEqual(Client(self.server).api("data")[0], 401)
        self.assertEqual(self.admin.api("unbekannt")[0], 404)

    # -- CSRF --

    def test_writes_need_json_and_same_origin(self):
        status, _, _ = self.admin.request("POST", "api.php?action=plan", b"day=2026-10-05",
                                          {"Content-Type": "application/x-www-form-urlencoded"})
        self.assertEqual(status, 415)
        status, res = self.admin.api("plan", {"day": "2026-10-05", "status": "frei"}, Origin="https://evil.example")
        self.assertEqual(status, 403)
        status, _ = self.admin.api("plan", {"day": "2026-10-05", "status": "frei"},
                                   Origin=self.server.base.rstrip("/"))
        self.assertEqual(status, 200)

    # -- data --

    def test_entries_plan_settings(self):
        status, res = self.admin.api("entry", ENTRY)
        self.assertEqual(status, 200, res)
        entry = res["entry"]
        status, res = self.admin.api("entry", {**ENTRY, "start": "09:00", "end": "10:00"})
        self.assertEqual(status, 400)
        self.assertIn("überschneidet", res["error"])
        status, res = self.admin.api("entry", {**entry, "end": "12:00", "location": "buero"})
        self.assertEqual((status, res["entry"]["id"]), (200, entry["id"]))
        for bad, message in [({"end": "07:00"}, "Ende"), ({"break": 600}, "Pause"),
                             ({"day": "2026-02-30"}, "Datum"), ({"location": "mond"}, "Homeoffice")]:
            status, res = self.admin.api("entry", {**ENTRY, "day": "2026-10-06", **bad})
            self.assertEqual(status, 400)
            self.assertIn(message, res["error"])
        self.admin.api("plan", {"day": "2026-10-07", "status": "homeoffice"})
        self.admin.api("plan", {"day": "2026-10-08", "status": "frei"})
        for status in ("schule", "krank", "urlaub"):
            self.assertEqual(self.admin.api("plan", {"day": "2026-10-09", "status": status})[0], 200, status)
        self.assertEqual(self.admin.api("plan", {"day": "2026-10-09", "status": "mond"})[0], 400)
        self.admin.api("plan", {"day": "2026-10-09", "status": None})
        self.admin.api("plan", {"day": "2026-10-08", "status": None})
        status, res = self.admin.api("settings", {"workdays": [0, 3, 4], "dailyMinutes": 468, "limitPercent": 40,
                                                  "state": "NW", "defaultStart": "07:30", "defaultBreak": 45})
        self.assertEqual(status, 200, res)
        self.assertEqual(self.admin.api("settings", {**res["settings"], "workdays": []})[0], 400)
        self.assertEqual(res["settings"]["schoolDays"], [])  # not sent -> default
        status, res = self.admin.api("settings", {**res["settings"], "schoolDays": [2, 1, 2]})
        self.assertEqual((status, res["settings"]["schoolDays"]), (200, [1, 2]))
        status, res = self.admin.api("settings", {**res["settings"], "schoolDays": [0]})
        self.assertEqual(status, 400)
        self.assertIn("zugleich", res["error"])
        # weekdays planned as Homeoffice/Büro by default: only workdays, not both
        settings = self.admin.api("data")[1]["settings"]
        self.assertEqual((settings["homeOfficeDays"], settings["officeDays"]), ([], []))  # default
        status, res = self.admin.api("settings", {**settings, "homeOfficeDays": [4, 0], "officeDays": [3]})
        self.assertEqual((status, res["settings"]["homeOfficeDays"], res["settings"]["officeDays"]), (200, [0, 4], [3]))
        for bad in ({"homeOfficeDays": [2]}, {"homeOfficeDays": [0], "officeDays": [0]}, {"officeDays": [9]}):
            self.assertEqual(self.admin.api("settings", {**res["settings"], **bad})[0], 400, bad)

        _, data = self.admin.api("data")
        self.assertEqual([(e["start"], e["end"], e["location"]) for e in data["entries"]], [("08:00", "12:00", "buero")])
        self.assertEqual(data["plan"], {"2026-10-07": "homeoffice"})
        self.assertEqual(data["settings"]["state"], "NW")

        self.admin.api("delete-entry", {"id": entry["id"]})
        self.assertEqual(self.admin.api("data")[1]["entries"], [])

    def test_users_only_see_and_change_their_own_data(self):
        status, res = self.admin.api("entry", ENTRY)
        admin_entry = res["entry"]
        user, _ = self.invite_user()
        _, data = user.api("data")
        self.assertEqual(data["entries"], [])
        # same time on the same day is fine for another person
        self.assertEqual(user.api("entry", ENTRY)[0], 200)
        # changing or deleting someone else's entry does nothing
        status, res = user.api("entry", {**admin_entry, "end": "09:00"})
        self.assertEqual(status, 400)
        user.api("delete-entry", {"id": admin_entry["id"]})
        self.assertEqual(len(self.admin.api("data")[1]["entries"]), 1)
        # no admin functions
        self.assertEqual(user.api("admin-overview")[0], 403)
        self.assertEqual(user.api("admin-invite", {"username": "x@example.org"})[0], 403)

    def test_import_replaces_data(self):
        self.admin.api("entry", ENTRY)
        payload = {"settings": {"workdays": [0, 1, 2, 3, 4], "dailyMinutes": 480, "limitPercent": 30,
                                "state": None, "defaultStart": "08:00", "defaultBreak": 30},
                   "entries": [{**ENTRY, "day": "2026-09-01"}, {**ENTRY, "day": "2026-09-02"}],
                   "plan": {"2026-09-03": "frei"}}
        status, data = self.admin.api("import", payload)
        self.assertEqual(status, 200, data)
        self.assertEqual([e["day"] for e in data["entries"]], ["2026-09-01", "2026-09-02"])
        self.assertEqual(data["plan"], {"2026-09-03": "frei"})
        overlapping = {**payload, "entries": [ENTRY, {**ENTRY, "start": "09:00"}]}
        self.assertEqual(self.admin.api("import", overlapping)[0], 400)
        self.assertEqual(len(self.admin.api("data")[1]["entries"]), 2)  # unchanged

    def test_import_many_rows_in_chunks(self):
        days = [f"2025-{m:02d}-{d:02d}" for m in range(1, 13) for d in range(1, 29)]  # 336 > one INSERT chunk
        payload = {"settings": {"workdays": [0, 1, 2, 3, 4], "dailyMinutes": 480, "limitPercent": 30,
                                "state": None, "defaultStart": "08:00", "defaultBreak": 30},
                   "entries": [{**ENTRY, "day": day} for day in days],
                   "plan": {day: "frei" for day in days},
                   "flex": [{"day": day, "minutes": 5, "note": ""} for day in days]}
        status, data = self.admin.api("import", payload)
        self.assertEqual(status, 200, data)
        self.assertEqual([e["day"] for e in data["entries"]], days)
        self.assertEqual((len(data["plan"]), len(data["flex"])), (336, 336))

    def test_responses_are_compressed_on_request(self):
        import gzip
        status, headers, raw = self.admin.request("GET", "api.php?action=me", headers={"Accept-Encoding": "gzip"})
        if headers.get("Content-Encoding") != "gzip":
            self.skipTest("PHP ohne zlib")
        self.assertEqual(status, 200)
        self.assertIn("user", __import__("json").loads(gzip.decompress(raw)))

    # -- flextime corrections --

    def test_flex_corrections(self):
        status, res = self.admin.api("flex", {"day": "2026-09-30", "minutes": -20, "note": "Übertrag September"})
        self.assertEqual(status, 200, res)
        item = res["flex"]
        self.assertEqual((item["day"], item["minutes"], item["note"]), ("2026-09-30", -20, "Übertrag September"))
        for bad in ({"minutes": 0}, {"minutes": "x"}, {"day": "2026-13-01"}, {"note": "x" * 201}):
            self.assertEqual(self.admin.api("flex", {"day": "2026-09-30", "minutes": 5, "note": "", **bad})[0], 400, bad)
        self.assertEqual(self.admin.api("data")[1]["flex"], [item])

        user, _ = self.invite_user()
        self.assertEqual(user.api("data")[1]["flex"], [])
        user.api("delete-flex", {"id": item["id"]})  # someone else's correction: no effect
        self.assertEqual(len(self.admin.api("data")[1]["flex"]), 1)
        self.admin.api("delete-flex", {"id": item["id"]})
        self.assertEqual(self.admin.api("data")[1]["flex"], [])

    def test_import_with_flex(self):
        payload = {"settings": {"workdays": [0, 1, 2, 3, 4], "dailyMinutes": 480, "limitPercent": 30,
                                "state": None, "defaultStart": "08:00", "defaultBreak": 30},
                   "entries": [ENTRY], "plan": {}, "flex": [{"day": "2026-09-30", "minutes": -20, "note": "Übertrag"}]}
        self.admin.api("flex", {"day": "2026-01-01", "minutes": 60, "note": "alt"})
        status, data = self.admin.api("import", payload)
        self.assertEqual(status, 200, data)
        self.assertEqual([(f["day"], f["minutes"]) for f in data["flex"]], [("2026-09-30", -20)])
        del payload["flex"]  # files without corrections (e.g. older exports) are fine
        self.assertEqual(self.admin.api("import", payload)[1]["flex"], [])

    def test_older_database_gets_new_table(self):
        self.admin.api("entry", ENTRY)
        db = next(Path(self.server.tmp.name).glob("*.sqlite"))
        conn = sqlite3.connect(db)
        conn.execute("DROP TABLE flex_adjustments")
        conn.execute("DROP TABLE viewer_access")  # a database from before these tables existed
        conn.execute("DROP TABLE admin_log")
        conn.execute("DROP TABLE schema_meta")  # databases from before the schema version was tracked
        conn.commit()
        conn.close()
        status, data = self.admin.api("data")  # still logged in, data intact, table created again
        self.assertEqual((status, len(data["entries"]), data["flex"]), (200, 1, []))
        self.assertEqual(self.admin.api("flex", {"day": "2026-09-30", "minutes": -20, "note": ""})[0], 200)
        conn = sqlite3.connect(db)
        self.assertEqual(conn.execute("SELECT v FROM schema_meta WHERE k = 'version'").fetchone()[0], 2)
        names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'index'")}
        self.assertLessEqual({"sessions_expires", "sessions_user", "login_failures_at"}, names)
        conn.close()

    # -- invitations & administration --

    def test_invitation_and_password_reset_links(self):
        user, token = self.invite_user()
        self.assertEqual(user.api("me")[1]["user"]["isAdmin"], False)
        # links work only once
        self.assertEqual(Client(self.server).api("redeem", {"token": token, "password": "irgendwas-123"})[0], 400)
        self.assertEqual(self.admin.api("admin-invite", {"username": "Kollegin@example.org"})[0], 400)
        self.assertEqual(self.admin.api("admin-invite", {"username": "zu kurz und mit Leerzeichen!"})[0], 400)

        status, res = self.admin.api("admin-reset", {"username": "kollegin@example.org"})
        reset_token = res["link"].split("token=")[1]
        self.assertEqual(Client(self.server).api(f"link&token={reset_token}")[1]["kind"], "reset")
        fresh = Client(self.server)
        self.assertEqual(fresh.api("redeem", {"token": reset_token, "password": "kurz"})[0], 400)
        self.assertEqual(fresh.api("redeem", {"token": reset_token, "password": "neues-passwort-1"})[0], 200)
        self.assertEqual(user.api("me")[0], 401)  # old sessions ended
        self.assertEqual(Client(self.server).api("login", {"username": "kollegin@example.org",
                                                           "password": "neues-passwort-1"})[0], 200)

    def test_admin_overview_revoke_delete(self):
        user, _ = self.invite_user()
        user.api("entry", ENTRY)
        self.admin.api("admin-invite", {"username": "offen@example.org", "isAdmin": True})
        _, overview = self.admin.api("admin-overview")
        self.assertEqual([u["username"] for u in overview["users"]], ["admin@example.org", "kollegin@example.org"])
        self.assertEqual([(l["username"], l["isAdmin"]) for l in overview["links"]], [("offen@example.org", True)])
        self.admin.api("admin-revoke", {"id": overview["links"][0]["id"]})
        self.assertEqual(self.admin.api("admin-overview")[1]["links"], [])

        own_id = overview["users"][0]["id"]
        self.assertEqual(self.admin.api("admin-delete-user", {"id": own_id})[0], 400)
        self.admin.api("admin-delete-user", {"id": overview["users"][1]["id"]})
        self.assertEqual(user.api("me")[0], 401)
        self.assertEqual(len(self.admin.api("admin-overview")[1]["users"]), 1)

    # -- read-only accounts --

    def test_read_only_accounts(self):
        self.admin.api("entry", ENTRY)
        colleague, _ = self.invite_user()
        colleague.api("entry", {**ENTRY, "location": "buero"})
        self.assertEqual(self.admin.api("admin-invite", {"username": "x@example.org", "isAdmin": True, "isViewer": True})[0], 400)
        status, res = self.admin.api("admin-invite", {"username": "leser@example.org", "isViewer": True})
        self.assertEqual(status, 200, res)
        self.assertEqual([(l["username"], l["isViewer"]) for l in self.admin.api("admin-overview")[1]["links"]],
                         [("leser@example.org", True)])
        viewer = Client(self.server)
        self.assertEqual(viewer.api("redeem", {"token": res["link"].split("token=")[1], "password": "leser-pw-123"})[0], 200)
        self.assertEqual(viewer.api("me")[1]["user"]["isViewer"], True)
        # everyone learns whom to ask for admin-only things
        self.assertEqual(viewer.api("me")[1]["admins"], ["admin@example.org"])

        # nothing assigned yet; no own data, no writes, no admin functions
        self.assertEqual(viewer.api("shared"), (200, {"accounts": []}))
        _, overview = self.admin.api("admin-overview")
        ids = {u["username"]: u["id"] for u in overview["users"]}
        self.assertEqual(viewer.api(f"shared-data&owner={ids['admin@example.org']}")[0], 403)
        for action, body in [("data", None), ("entry", ENTRY), ("plan", {"day": "2026-10-05", "status": "frei"}),
                             ("settings", {}), ("import", {}), ("flex", {}), ("admin-overview", None)]:
            self.assertEqual(viewer.api(action, body)[0], 403, action)
        self.assertEqual(viewer.api("password", {"current": "leser-pw-123", "new": "leser-pw-456"})[0], 200)

        # the admin assigns the admin's account
        leser = ids["leser@example.org"]
        self.assertEqual(colleague.api("admin-viewer-access", {"id": leser, "canView": [ids["kollegin@example.org"]]})[0], 403)
        self.assertEqual(self.admin.api("admin-viewer-access", {"id": leser, "canView": [leser]})[0], 400)
        self.assertEqual(self.admin.api("admin-viewer-access", {"id": ids["admin@example.org"], "canView": []})[0], 400)
        self.assertEqual(self.admin.api("admin-viewer-access", {"id": leser, "canView": [ids["admin@example.org"]]})[0], 200)
        self.assertEqual([u.get("canView") for u in self.admin.api("admin-overview")[1]["users"]],
                         [None, None, [ids["admin@example.org"]]])
        self.assertEqual(viewer.api("shared")[1]["accounts"], [{"id": ids["admin@example.org"], "username": "admin@example.org"}])
        status, data = viewer.api(f"shared-data&owner={ids['admin@example.org']}")
        self.assertEqual((status, [e["location"] for e in data["entries"]]), (200, ["homeoffice"]))
        self.assertNotIn("viewers", data)
        self.assertEqual(viewer.api(f"shared-data&owner={ids['kollegin@example.org']}")[0], 403)
        # owners see who can read their data
        self.assertEqual(self.admin.api("data")[1]["viewers"], ["leser@example.org"])
        self.assertEqual(colleague.api("data")[1]["viewers"], [])

        # deleting the viewed account removes the access
        self.admin.api("admin-viewer-access", {"id": leser, "canView": [ids["kollegin@example.org"]]})
        self.assertEqual(viewer.api(f"shared-data&owner={ids['admin@example.org']}")[0], 403)
        self.admin.api("admin-delete-user", {"id": ids["kollegin@example.org"]})
        self.assertEqual(viewer.api("shared")[1]["accounts"], [])

    # -- account management --

    def ids(self):
        return {u["username"]: u["id"] for u in self.admin.api("admin-overview")[1]["users"]}

    def test_usernames_need_no_at_sign(self):
        for good in ("anna", "Max.Muster", "a_b-c+1", "ab"):
            self.assertEqual(self.admin.api("admin-invite", {"username": good})[0], 200, good)
        for bad in ("a", "x" * 65, "mit leer", "über", "a/b", ""):
            self.assertEqual(self.admin.api("admin-invite", {"username": bad})[0], 400, bad)
        user, _ = self.invite_user("Anna2", "anna-pw-12345")
        self.assertEqual(user.api("me")[1]["user"]["username"], "anna2")
        status, res = Client(self.server).api("login", {"username": "ANNA2", "password": "anna-pw-12345"})
        self.assertEqual((status, res["user"]["username"]), (200, "anna2"))
        self.assertIn("Benutzername", Client(self.server).api("login", {"username": "anna2", "password": "x"})[1]["error"])

    def test_account_roles_and_username(self):
        colleague, _ = self.invite_user()
        ids = self.ids()
        me, kollegin = ids["admin@example.org"], ids["kollegin@example.org"]
        for action, body in [("admin-role", {"id": me, "role": "admin"}), ("admin-username", {"id": me, "username": "x@example.org"}),
                             ("admin-lock", {"id": me, "locked": True}), ("admin-logout", {"id": me}),
                             ("admin-owner-access", {"id": me, "viewers": []})]:
            self.assertEqual(colleague.api(action, body)[0], 403, action)  # admins only
        self.assertEqual(colleague.api(f"admin-export&id={me}")[0], 403)

        # roles: not the own one; a user becomes admin and back
        self.assertIn("anderer Admin", self.admin.api("admin-role", {"id": me, "role": "user"})[1]["error"])
        self.assertEqual(self.admin.api("admin-role", {"id": kollegin, "role": "chef"})[0], 400)
        self.assertEqual(self.admin.api("admin-role", {"id": kollegin, "role": "admin"})[0], 200)
        self.assertEqual(colleague.api("admin-overview")[0], 200)  # effective immediately
        self.assertEqual(colleague.api("me")[1]["admins"], ["admin@example.org", "kollegin@example.org"])
        self.admin.api("admin-role", {"id": kollegin, "role": "user"})
        self.assertEqual(colleague.api("admin-overview")[0], 403)
        # an account with own data cannot become read-only
        colleague.api("entry", ENTRY)
        status, res = self.admin.api("admin-role", {"id": kollegin, "role": "viewer"})
        self.assertEqual(status, 400)
        self.assertIn("1 Einträge", res["error"])
        self.assertEqual(self.admin.api("admin-role", {"id": 9999, "role": "user"})[0], 404)

        # username: valid, unique, then login with the new one
        self.assertEqual(self.admin.api("admin-username", {"id": kollegin, "username": "kaputt!"})[0], 400)
        self.assertEqual(self.admin.api("admin-username", {"id": kollegin, "username": "admin@example.org"})[0], 400)
        self.assertEqual(self.admin.api("admin-username", {"id": kollegin, "username": " Neu@Example.org "})[0], 200)
        self.assertEqual(Client(self.server).api("login", {"username": "neu@example.org", "password": "kollegin-pw-1"})[0], 200)
        self.assertEqual(Client(self.server).api("login", {"username": "kollegin@example.org", "password": "kollegin-pw-1"})[0], 401)

        # everything is in the log, newest first
        log = self.admin.api("admin-overview")[1]["log"]
        self.assertEqual([(e["action"], e["target"], e["details"]) for e in log[:4]], [
            ("username", "neu@example.org", "kollegin@example.org → neu@example.org"),
            ("role", "kollegin@example.org", "Admin → Nutzer"),
            ("role", "kollegin@example.org", "Nutzer → Admin"),
            ("invite", None, "kollegin@example.org als Nutzer")])
        self.assertTrue(all(e["admin"] == "admin@example.org" for e in log))

    def test_lock_and_logout_everywhere(self):
        colleague, _ = self.invite_user()
        second = Client(self.server)
        second.api("login", {"username": "kollegin@example.org", "password": "kollegin-pw-1"})
        kollegin = self.ids()["kollegin@example.org"]
        overview = self.admin.api("admin-overview")[1]
        self.assertEqual([(u["sessions"], u["lockedAt"]) for u in overview["users"]], [(1, None), (2, None)])

        self.assertEqual(self.admin.api("admin-logout", {"id": kollegin}), (200, {"count": 2}))
        self.assertEqual(colleague.api("me")[0], 401)
        self.assertEqual(colleague.api("login", {"username": "kollegin@example.org", "password": "kollegin-pw-1"})[0], 200)

        # locked: logged out, cannot log in (the message only with the right password), no reset link
        self.assertEqual(self.admin.api("admin-lock", {"id": kollegin, "locked": "ja"})[0], 400)
        self.admin.api("admin-reset", {"username": "kollegin@example.org"})
        self.assertEqual(len(self.admin.api("admin-overview")[1]["links"]), 1)
        self.assertEqual(self.admin.api("admin-lock", {"id": kollegin, "locked": True})[0], 200)
        self.assertEqual(colleague.api("me")[0], 401)
        self.assertEqual(self.admin.api("admin-overview")[1]["links"], [])  # open reset link removed
        status, res = colleague.api("login", {"username": "kollegin@example.org", "password": "kollegin-pw-1"})
        self.assertEqual(status, 403)
        self.assertIn("gesperrt", res["error"])
        self.assertEqual(colleague.api("login", {"username": "kollegin@example.org", "password": "falsch-falsch"})[0], 401)
        self.assertIn("gesperrt", self.admin.api("admin-reset", {"username": "kollegin@example.org"})[1]["error"])
        self.assertIsNotNone(self.admin.api("admin-overview")[1]["users"][1]["lockedAt"])
        # a locked admin is not offered as contact
        self.admin.api("admin-role", {"id": kollegin, "role": "admin"})
        self.assertEqual(self.admin.api("me")[1]["admins"], ["admin@example.org"])

        self.assertEqual(self.admin.api("admin-lock", {"id": kollegin, "locked": False})[0], 200)
        self.assertEqual(colleague.api("login", {"username": "kollegin@example.org", "password": "kollegin-pw-1"})[0], 200)
        self.assertEqual([e["action"] for e in self.admin.api("admin-overview")[1]["log"][:5]],
                         ["unlock", "role", "lock", "reset", "logout"])

    def test_access_from_both_sides_and_export(self):
        self.admin.api("entry", ENTRY)
        self.admin.api("flex", {"day": "2026-09-30", "minutes": -20, "note": "Übertrag"})
        colleague, _ = self.invite_user()
        viewer = Client(self.server)
        status, res = self.admin.api("admin-invite", {"username": "leser2@example.org", "isViewer": True})
        viewer.api("redeem", {"token": res["link"].split("token=")[1], "password": "leser-pw-123"})
        ids = self.ids()
        me, leser2 = ids["admin@example.org"], ids["leser2@example.org"]

        # the owner side: which read-only accounts see this account
        self.assertEqual(self.admin.api("admin-owner-access", {"id": me, "viewers": [ids["kollegin@example.org"]]})[0], 400)
        self.assertEqual(self.admin.api("admin-owner-access", {"id": leser2, "viewers": []})[0], 400)
        self.assertEqual(self.admin.api("admin-owner-access", {"id": me, "viewers": [leser2]})[0], 200)
        self.assertEqual(viewer.api("shared")[1]["accounts"], [{"id": me, "username": "admin@example.org"}])
        users = {u["username"]: u for u in self.admin.api("admin-overview")[1]["users"]}
        self.assertEqual((users["admin@example.org"]["viewedBy"], users["leser2@example.org"]["canView"]), ([leser2], [me]))
        self.assertEqual(self.admin.api("admin-overview")[1]["log"][0]["details"], "sichtbar für: leser2@example.org")

        # a read-only account turned into a normal one loses its access
        self.assertEqual(self.admin.api("admin-role", {"id": leser2, "role": "user"})[0], 200)
        self.assertEqual(self.admin.api("data")[1]["viewers"], [])
        self.assertEqual(viewer.api("data")[0], 200)

        # export of another account's data, in the format of the own export
        status, data = self.admin.api(f"admin-export&id={ids['kollegin@example.org']}")
        self.assertEqual((status, data["username"], data["entries"]), (200, "kollegin@example.org", []))
        status, data = self.admin.api(f"admin-export&id={me}")
        self.assertEqual(([e["day"] for e in data["entries"]], [f["minutes"] for f in data["flex"]]), (["2026-10-05"], [-20]))
        self.assertEqual(self.admin.api("admin-overview")[1]["log"][0]["action"], "export")
        self.assertEqual(self.admin.api("admin-export&id=9999")[0], 404)

    def test_older_database_gets_viewer_columns(self):
        self.admin.api("entry", ENTRY)
        db = next(Path(self.server.tmp.name).glob("*.sqlite"))
        conn = sqlite3.connect(db)
        conn.execute("DROP TABLE viewer_access")
        conn.execute("DROP TABLE admin_log")
        conn.execute("ALTER TABLE users DROP COLUMN is_viewer")
        conn.execute("ALTER TABLE users DROP COLUMN locked_at")
        conn.execute("ALTER TABLE tokens DROP COLUMN is_viewer")
        conn.execute("DROP TABLE schema_meta")
        conn.commit()
        conn.close()
        status, res = self.admin.api("me")
        self.assertEqual((status, res["user"]["isViewer"]), (200, False))
        self.assertEqual(len(self.admin.api("data")[1]["entries"]), 1)
        self.assertEqual(self.admin.api("admin-invite", {"username": "leser@example.org", "isViewer": True})[0], 200)

    # -- automatic backups --

    def test_automatic_backup(self):
        backups = Path(self.server.tmp.name) / "backups"
        self.assertFalse(backups.exists())  # nothing before the app is opened
        self.admin.api("entry", ENTRY)
        self.assertFalse(backups.exists())  # single changes don't check for a backup
        self.admin.api("me")
        files = sorted(backups.glob("sicherung-*.sqlite"))
        self.assertEqual(len(files), 1)
        conn = sqlite3.connect(files[0])
        self.assertEqual(conn.execute("SELECT email FROM users").fetchone()[0], "admin@example.org")
        conn.close()
        self.assertTrue((backups / ".htaccess").exists())
        self.assertEqual(list(backups.glob("*.tmp")), [])
        self.admin.api("me")  # not due yet
        self.assertEqual(len(list(backups.glob("sicherung-*.sqlite"))), 1)
        _, overview = self.admin.api("admin-overview")
        self.assertEqual((overview["backup"]["enabled"], overview["backup"]["count"]), (True, 1))
        self.assertRegex(overview["backup"]["last"], r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$")

    def test_backup_rotation_keeps_newest(self):
        backups = Path(self.server.tmp.name) / "backups"
        self.admin.api("me")
        for old in backups.glob("sicherung-*.sqlite"):
            old.unlink()
        week_ago = time.time() - 8 * 86400
        for day in range(1, 10):
            fake = backups / f"sicherung-2020-01-0{day}-000000-aaaaaaaa.sqlite"
            fake.write_bytes(b"x")
            os.utime(fake, (week_ago, week_ago))
        (backups / ".lock").unlink()  # forget the last attempt
        self.admin.api("me")
        names = sorted(p.name for p in backups.glob("sicherung-*.sqlite"))
        self.assertEqual(len(names), 8)
        self.assertTrue(names[-1].startswith("sicherung-2026") or names[-1] > "sicherung-2021")
        self.assertNotIn("sicherung-2020-01-01-000000-aaaaaaaa.sqlite", names)  # oldest are gone

    def test_change_password(self):
        status, res = self.admin.api("password", {"current": "falsch", "new": "neues-passwort-1"})
        self.assertEqual(status, 400)
        self.assertEqual(self.admin.api("password", {"current": "geheim12345", "new": "neues-passwort-1"})[0], 200)
        self.assertEqual(self.admin.api("me")[0], 200)  # this session stays logged in
        self.assertEqual(Client(self.server).api("login", {"username": "admin@example.org",
                                                           "password": "neues-passwort-1"})[0], 200)


if __name__ == "__main__":
    unittest.main()
