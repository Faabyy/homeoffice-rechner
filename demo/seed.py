"""Fills the demo database of the design test version with sample data (run once, server must be running)."""
import json, sys, urllib.request, http.cookiejar
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8090/"
EMAIL, PASSWORD = "demo@example.org", "demo-56f66ef6"
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def post(path, data, form=False):
    body = (data if form else json.dumps(data)).encode()
    req = urllib.request.Request(BASE + path, body, {"Content-Type": "application/x-www-form-urlencoded" if form else "application/json"})
    try:
        return json.loads(opener.open(req).read() or b"{}")
    except Exception:
        return {}

post("setup.php?key=design-test-123456", f"email={EMAIL}&password={PASSWORD}&password2={PASSWORD}", form=True)
post("api.php?action=login", {"email": EMAIL, "password": PASSWORD})
post("api.php?action=settings", {"workdays": [0, 1, 2, 3, 4], "homeOfficeDays": [4], "officeDays": [], "schoolDays": [],
     "dailyMinutes": 468, "limitPercent": 30, "state": "NW", "defaultStart": "08:00", "defaultBreak": 30})
for day, start, end, loc in [("2026-10-01", "07:45", "16:15", "buero"), ("2026-10-02", "08:00", "16:30", "homeoffice"),
                             ("2026-10-05", "08:10", "12:00", "buero"), ("2026-10-05", "12:30", "17:05", "buero")]:
    post("api.php?action=entry", {"day": day, "start": start, "end": end, "break": 0 if day == "2026-10-05" else 30, "location": loc})
for day, status in [("2026-10-07", "homeoffice"), ("2026-10-08", "buero"), ("2026-10-13", "urlaub"), ("2026-10-14", "urlaub"),
                    ("2026-10-20", "krank"), ("2026-10-21", "homeoffice"), ("2026-10-27", "frei")]:
    post("api.php?action=plan", {"day": day, "status": status})
post("api.php?action=flex", {"day": "2026-09-30", "minutes": -20, "note": "Übertrag September"})
for email, viewer in (("anna@example.org", False), ("chefin@example.org", True)):
    post("api.php?action=admin-invite", {"email": email, "isViewer": viewer})
print("Demo-Daten angelegt.")
