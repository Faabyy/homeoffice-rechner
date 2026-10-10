"""Fills the demo database of the design test version with sample data (run once, server must be running)."""
import json, sys, urllib.request, http.cookiejar
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8090/"
USER, PASSWORD = "demo", "demo-56f66ef6"
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def post(path, data, form=False):
    if data is None:  # GET
        return json.loads(opener.open(BASE + path).read())
    body = (data if form else json.dumps(data)).encode()
    req = urllib.request.Request(BASE + path, body, {"Content-Type": "application/x-www-form-urlencoded" if form else "application/json"})
    try:
        return json.loads(opener.open(req).read() or b"{}")
    except Exception:
        return {}

post("setup.php?key=design-test-123456", f"username={USER}&password={PASSWORD}&password2={PASSWORD}", form=True)
post("api.php?action=login", {"username": USER, "password": PASSWORD})
post("api.php?action=settings", {"workdays": [0, 1, 2, 3, 4], "homeOfficeDays": [], "officeDays": [], "schoolDays": [],
     "dailyMinutes": 468, "limitPercent": 30, "state": "NW", "defaultStart": "08:00", "defaultBreak": 30})
for day, start, end, loc in [("2026-10-01", "07:45", "16:15", "buero"), ("2026-10-02", "08:00", "16:30", "homeoffice"),
                             ("2026-10-05", "08:10", "12:00", "buero"), ("2026-10-05", "12:30", "17:05", "buero"),
                             ("2026-10-06", "08:00", "16:30", "buero"), ("2026-10-07", "08:15", "16:45", "homeoffice"),
                             ("2026-10-08", "07:50", "16:20", "buero"), ("2026-10-09", "08:00", "16:00", "homeoffice")]:
    post("api.php?action=entry", {"day": day, "start": start, "end": end, "break": 0 if day == "2026-10-05" else 30, "location": loc})
for day, status in [("2026-10-12", "buero"), ("2026-10-13", "urlaub"), ("2026-10-14", "urlaub"), ("2026-10-15", "buero"),
                    ("2026-10-19", "homeoffice"), ("2026-10-20", "krank"), ("2026-10-21", "homeoffice"), ("2026-10-27", "frei")]:
    post("api.php?action=plan", {"day": day, "status": status})
post("api.php?action=flex", {"day": "2026-09-30", "minutes": -20, "note": "Übertrag September"})

def redeem(link, password):
    """Accept an invitation like the invited person would (own cookie jar, so our session stays)."""
    token = link.split("token=")[1]
    other = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    body = json.dumps({"token": token, "password": password}).encode()
    other.open(urllib.request.Request(BASE + "api.php?action=redeem", body, {"Content-Type": "application/json"}))

# two accounts (a colleague and a read-only boss who may see the demo account) and one open invitation
for name, viewer in (("anna", False), ("chefin", True)):
    link = post("api.php?action=admin-invite", {"username": name, "isViewer": viewer})["link"]
    redeem(link, f"{name}-passwort-123")
post("api.php?action=admin-invite", {"username": "max", "isViewer": False})
users = {u["username"]: u["id"] for u in post("api.php?action=admin-overview", None)["users"]}
post("api.php?action=admin-viewer-access", {"id": users["chefin"], "canView": [users[USER]]})
print("Demo-Daten angelegt.")
