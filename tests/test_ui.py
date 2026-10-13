"""End-to-end test of the web UI in a headless browser against the PHP dev server."""

import unittest

from tests.support import Browser, Client, PhpServer


def cell(label):
    return f"[...document.querySelectorAll('.day')].find(b => b.getAttribute('aria-label').startsWith('{label}'))"


class UiTest(unittest.TestCase):
    def setUp(self):
        self.server = PhpServer()
        Client(self.server).setup_admin()
        self.browser = Browser()

    def tearDown(self):
        self.browser.close()
        self.server.close()

    def js(self, expression):
        return self.browser.js(expression)

    def login(self, email, password):
        self.browser.goto(self.server.base + "login.php")
        self.js(f"document.getElementById('username').value = '{email}';"
                f"document.getElementById('password').value = '{password}';"
                "document.getElementById('login-form').requestSubmit()")
        self.browser.wait_for("location.pathname === '/' && !!document.querySelector('.day')")
        self.js("document.getElementById('news-dialog').close()")  # "what's new" depends on today's date

    def test_full_flow(self):
        b = self.browser
        # wrong password, then login
        b.goto(self.server.base)
        self.assertTrue(b.wait_for("location.pathname === '/login.php'"))
        self.js("document.getElementById('username').value = 'admin@example.org';"
                "document.getElementById('password').value = 'falsch';"
                "document.getElementById('login-form').requestSubmit()")
        self.assertIn("falsch", b.wait_for("document.getElementById('error').textContent"))
        self.login("admin@example.org", "geheim12345")
        self.assertEqual(self.js("document.getElementById('user-name').textContent"), "admin@example.org")
        self.assertFalse(self.js("document.querySelector('[data-tab=benutzer]').hidden"))

        # plan: show October 2026, click a day three times quickly -> Frei
        self.js("state.year = 2026; state.month = 10; render()")
        day = cell("Fr 09.10.2026")
        self.js(f"{day}.click(); {day}.click(); {day}.click()")
        b.wait_for(f"{day}.textContent.includes('Frei')")
        self.js(f"{cell('Fr 09.10.2026')}.click()")  # -> unplanned again
        b.wait_for(f"!{cell('Fr 09.10.2026')}.textContent.includes('Frei')")
        self.js(f"{cell('Mo 05.10.2026')}.click()")
        b.wait_for(f"{cell('Mo 05.10.2026')}.textContent.includes('Homeoffice')")

        # right click -> time entry for that day, prefilled from the plan
        self.js(f"{cell('Mo 05.10.2026')}.dispatchEvent(new MouseEvent('contextmenu', {{bubbles: true, clientX: 300, clientY: 300}}))")
        self.js("document.querySelector('#context-menu button').click()")
        self.assertEqual(self.js("document.getElementById('f-date').value"), "05.10.2026")
        self.assertEqual(self.js("document.querySelector('input[name=location]:checked').value"), "homeoffice")
        self.js("const s = document.getElementById('f-start'); s.value = '730'; s.dispatchEvent(new Event('blur'));"
                "document.getElementById('entry-form').requestSubmit()")
        b.wait_for("document.querySelectorAll('#entries-body tr').length === 1")
        self.assertIn("07:30", self.js("document.querySelector('#entries-body tr').textContent"))
        self.assertIn("✓ HO", self.js(f"{cell('Mo 05.10.2026')}.textContent"))

        # overlap error comes back to the form
        self.js("document.getElementById('f-date').value = '5'; document.getElementById('f-start').value = '9';"
                "document.getElementById('f-end').value = '10'; document.getElementById('entry-form').requestSubmit()")
        self.assertIn("überschneidet", b.wait_for("document.getElementById('form-error').textContent"))

        # edit
        self.js("document.querySelector('#entries-body tr button').click()")
        self.js("document.getElementById('f-end').value = '12'; document.getElementById('entry-form').requestSubmit()")
        b.wait_for("document.querySelector('#entries-body tr').textContent.includes('12:00')")

        # data survives a reload
        b.goto(self.server.base + "#planung")
        b.wait_for("!!document.querySelector('.day')")
        self.js("state.year = 2026; state.month = 10; render()")
        self.assertIn("✓ HO 4:", self.js(f"{cell('Mo 05.10.2026')}.textContent"))

        # settings
        self.js("document.querySelector('[data-tab=einstellungen]').click();"
                "document.getElementById('s-state').value = 'NW';"
                "document.getElementById('settings-form').requestSubmit()")
        b.wait_for("document.getElementById('settings-status').textContent.includes('Gespeichert')")
        self.assertIn("Tag der Deutschen Einheit", self.js(f"{cell('Sa 03.10.2026')}.textContent"))

        # untick Wednesday: Wednesdays become "Frei", a single one can still be planned
        self.js("document.getElementById('s-weekday-2').value = 'frei';"
                "document.getElementById('settings-form').requestSubmit()")
        b.wait_for(f"{cell('Mi 14.10.2026')}.textContent.includes('Frei')")
        self.assertIn("Frei", self.js(f"{cell('Mi 07.10.2026')}.textContent"))
        self.js(f"{cell('Mi 14.10.2026')}.click()")
        b.wait_for(f"{cell('Mi 14.10.2026')}.textContent.includes('Homeoffice')")
        self.js(f"{cell('Mi 14.10.2026')}.dispatchEvent(new MouseEvent('contextmenu', {{bubbles: true, clientX: 300, clientY: 300}}))")
        self.assertEqual(self.js("[...document.querySelectorAll('#context-menu button')].slice(1).map(b => b.textContent)"),
                         ["✓Homeoffice", "Büro", "Frei (Standard)", "Berufsschule/Studium", "Krank", "Urlaub"])
        self.js("[...document.querySelectorAll('#context-menu button')].find(b => b.textContent === 'Urlaub').click()")
        b.wait_for(f"{cell('Mi 14.10.2026')}.textContent.includes('Urlaub')")
        self.assertTrue(self.js(f"{cell('Mi 14.10.2026')}.classList.contains('c-urlaub')"))
        self.js(f"{cell('Mi 14.10.2026')}.click()")  # a click resets it to the default
        b.wait_for(f"{cell('Mi 14.10.2026')}.textContent.includes('Frei')")

        # Tuesdays as Berufsschule: shown as such, a single Tuesday can still be Homeoffice
        self.js("document.getElementById('s-weekday-1').value = 'schule';"
                "document.getElementById('settings-form').requestSubmit()")
        b.wait_for(f"{cell('Di 13.10.2026')}.textContent.includes('Schule/Studium')")
        self.assertTrue(self.js(f"{cell('Di 13.10.2026')}.classList.contains('c-schule')"))
        self.js(f"{cell('Di 13.10.2026')}.click()")
        b.wait_for(f"{cell('Di 13.10.2026')}.textContent.includes('Homeoffice')")
        self.js(f"{cell('Di 13.10.2026')}.dispatchEvent(new MouseEvent('contextmenu', {{bubbles: true, clientX: 300, clientY: 300}}))")
        self.assertEqual(self.js("[...document.querySelectorAll('#context-menu button')].slice(1).map(b => b.textContent)"),
                         ["✓Homeoffice", "Büro", "Frei", "Berufsschule/Studium (Standard)", "Krank", "Urlaub"])
        self.js("[...document.querySelectorAll('#context-menu button')].find(b => b.textContent.startsWith('Berufsschule')).click()")
        b.wait_for(f"{cell('Di 13.10.2026')}.textContent.includes('Schule/Studium')")
        # Thursdays as Homeoffice: planned without clicking; a click switches a single one to Büro
        self.js("document.getElementById('s-weekday-3').value = 'homeoffice';"
                "document.getElementById('settings-form').requestSubmit()")
        b.wait_for(f"{cell('Do 22.10.2026')}.textContent.includes('Homeoffice')")
        self.assertTrue(self.js(f"{cell('Do 08.10.2026')}.classList.contains('c-homeoffice')"))
        self.js(f"{cell('Do 15.10.2026')}.click()")
        b.wait_for(f"{cell('Do 15.10.2026')}.textContent.includes('Büro')")
        self.js(f"{cell('Do 15.10.2026')}.dispatchEvent(new MouseEvent('contextmenu', {{bubbles: true, clientX: 300, clientY: 300}}))")
        self.assertEqual(self.js("[...document.querySelectorAll('#context-menu button')].slice(1).map(b => b.textContent)"),
                         ["Homeoffice (Standard)", "✓Büro", "Frei", "Berufsschule/Studium", "Krank", "Urlaub"])
        self.js("document.getElementById('context-menu').hidden = true")
        self.js(f"{cell('Do 15.10.2026')}.click()")  # Büro -> Frei -> back to the default
        self.js(f"{cell('Do 15.10.2026')}.click()")
        b.wait_for(f"{cell('Do 15.10.2026')}.textContent.includes('Homeoffice')")
        self.assertNotIn("2026-10-15", self.js("state.data.plan"))
        # reload shows the saved weekday types in the form
        b.goto(self.server.base + "#einstellungen")
        b.wait_for("!!document.getElementById('s-weekday-1')")
        self.assertEqual(self.js("[0, 1, 2, 3].map(i => document.getElementById('s-weekday-' + i).value)"),
                         ["arbeit", "schule", "frei", "homeoffice"])
        self.js("state.year = 2026; state.month = 10; render()")

        # school holidays are shown (fed directly instead of calling the external API)
        self.js("state.school['NW-2026'] = [{start: '2026-10-17', end: '2026-10-31', name: 'Herbstferien'}]; render()")
        self.assertTrue(self.js(f"{cell('Mo 19.10.2026')}.classList.contains('school')"))
        self.assertIn("Herbstferien", self.js(f"{cell('Sa 17.10.2026')}.textContent"))

        # flextime: 05.10. has 07:30–12:00 minus 30 min break (4:00) + 0:05 gift -> -3:55; add a correction of -0:20 on 30.09.
        self.assertEqual(self.js("document.querySelector('.summary .flex-balance').textContent"), "-3:55 h")
        self.js("document.getElementById('x-date').value = '30.9.2026';"
                "document.getElementById('x-minutes').value = '-0:20';"
                "document.getElementById('x-note').value = 'Übertrag September';"
                "document.getElementById('flex-form').requestSubmit()")
        b.wait_for("document.getElementById('flex-body').textContent.includes('Übertrag September')")
        self.assertEqual(self.js("document.querySelector('.summary .flex-balance').textContent"), "-4:15 h")
        self.assertIn("-3:55", self.js("document.querySelector('.summary .flex .caption').textContent"))

        # invite someone, log out, use the link
        self.js("document.querySelector('[data-tab=benutzer]').click()")
        b.wait_for("typeof loadAdmin === 'function'")
        self.js("document.getElementById('i-username').value = 'kollegin@example.org';"
                "document.getElementById('invite-form').requestSubmit()")
        link = b.wait_for("!document.getElementById('link-box').hidden && document.querySelector('#link-box input').value")
        self.assertIn("login.php?token=", link)
        b.wait_for("document.getElementById('links-body').textContent.includes('kollegin@example.org')")
        self.js("document.getElementById('logout').click()")
        b.wait_for("location.pathname === '/login.php'")

        b.goto(link)
        self.assertEqual(b.wait_for("document.getElementById('redeem-username').textContent"), "für kollegin@example.org")
        self.assertNotIn("token", self.js("location.href"))
        self.js("document.getElementById('new-password').value = 'kollegin-pw-1';"
                "document.getElementById('new-password2').value = 'kollegin-pw-1';"
                "document.getElementById('redeem-form').requestSubmit()")
        b.wait_for("location.pathname === '/' && document.getElementById('user-name').textContent")
        self.assertEqual(self.js("document.getElementById('user-name').textContent"), "kollegin@example.org")
        self.assertTrue(self.js("document.querySelector('[data-tab=benutzer]').hidden"))
        self.js("state.year = 2026; state.month = 10; render()")
        self.assertNotIn("✓", self.js(f"{cell('Mo 05.10.2026')}.textContent"))  # admin's data not visible

        self.assertEqual(b.errors, [])

    def test_news_dialog(self):
        b = self.browser
        self.login("admin@example.org", "geheim12345")
        # login() closed the dialog; its close event (marking everything seen) comes asynchronously
        b.wait_for("localStorage.getItem('neuigkeiten-gesehen-' + state.user.id) === CHANGELOG[0].id")
        # pretend the second newest entry was seen last: only the newest one is marked new
        self.js(f"localStorage.setItem('neuigkeiten-gesehen-' + state.user.id, CHANGELOG[1].id)")
        b.goto(self.server.base)
        b.wait_for("document.getElementById('news-dialog').open")
        self.assertEqual(self.js("[...document.querySelectorAll('#news-list .news.new h4')].map(h => h.textContent)"),
                         [self.js("'Neu' + CHANGELOG[0].title + Logic.germanDate(CHANGELOG[0].date)")])
        self.js("document.querySelector('#news-dialog button').click()")
        # the close event comes asynchronously
        self.assertTrue(b.wait_for("localStorage.getItem('neuigkeiten-gesehen-' + state.user.id) === CHANGELOG[0].id"))
        b.goto(self.server.base)
        b.wait_for("!!document.querySelector('.day')")
        self.assertFalse(self.js("document.getElementById('news-dialog').open"))
        # always available from the top bar, nothing marked new
        self.js("document.getElementById('news-btn').click()")
        self.assertTrue(self.js("document.getElementById('news-dialog').open"))
        self.assertEqual(self.js("document.querySelectorAll('#news-list .news.new').length"), 0)
        self.assertGreater(self.js("document.querySelectorAll('#news-list .news').length"), 1)
        self.assertIn("Du bist selbst Admin", self.js("document.getElementById('admin-contacts').textContent"))
        self.assertEqual(b.errors, [])

    def test_design_switch(self):
        b = self.browser
        self.login("admin@example.org", "geheim12345")
        active = ("[...document.styleSheets].filter(s => !s.disabled).map(s => s.ownerNode.id)"
                  ".filter(id => id.startsWith('css-'))")
        self.assertEqual(self.js(active), ["css-modern"])  # default
        # mobile.css applies to every design
        self.assertTrue(self.js("[...document.styleSheets].some(s => s.href.includes('mobile.css') && !s.disabled)"))
        self.js("document.querySelector('[data-tab=einstellungen]').click();"
                "const d = document.getElementById('s-design'); d.value = 'klassisch'; d.dispatchEvent(new Event('change'))")
        # the current stylesheet stays until the chosen one has loaded (no unstyled moment)
        self.assertTrue(self.js("[...document.styleSheets].some(s => s.ownerNode.id.startsWith('css-'))"))
        b.wait_for(f"JSON.stringify({active}) === '[\"css-klassisch\"]'")
        self.assertEqual(self.js("getComputedStyle(document.querySelector('.panel:not([hidden])')).borderTopStyle"), "solid")
        # remembered, also on the login page
        b.goto(self.server.base)
        b.wait_for("!!document.querySelector('.day')")
        self.assertEqual(self.js(active), ["css-klassisch"])
        self.assertEqual(self.js("document.getElementById('s-design').value"), "klassisch")
        self.js("const d = document.getElementById('s-design'); d.value = 'warm'; d.dispatchEvent(new Event('change'))")
        b.wait_for(f"JSON.stringify({active}) === '[\"css-warm\"]'")
        self.assertEqual(self.js("[...document.getElementById('s-design').options].map(o => o.textContent)"),
                         ["Modern", "Klassisch", "Warm"])
        # colour mode: explicit choice beats the system setting, also after reloading
        self.assertIsNone(self.js("document.documentElement.dataset.scheme ?? null"))  # default: automatic
        self.js("{ const s = document.getElementById('s-scheme'); s.value = 'dark'; s.dispatchEvent(new Event('change')) }")
        self.assertEqual(self.js("getComputedStyle(document.documentElement).colorScheme"), "dark")
        # the installed app's colours follow the choice (cookie read by manifest.php)
        self.assertIn("look=warm-dark", self.js("document.cookie"))
        manifest = self.js("fetch('manifest.php', { credentials: 'include' }).then(r => r.json())")
        self.assertEqual((manifest["theme_color"], manifest["background_color"]), ("#1c1b1a", "#1c1b1a"))
        b.goto(self.server.base + "#einstellungen")
        b.wait_for("!!document.getElementById('s-scheme')")
        self.assertEqual(self.js("[document.documentElement.dataset.scheme, document.getElementById('s-scheme').value]"),
                         ["dark", "dark"])
        self.js("{ const s = document.getElementById('s-scheme'); s.value = 'light'; s.dispatchEvent(new Event('change')) }")
        self.assertEqual(self.js("getComputedStyle(document.documentElement).colorScheme"), "light")
        self.js("{ const s = document.getElementById('s-scheme'); s.value = 'auto'; s.dispatchEvent(new Event('change')) }")
        self.assertIsNone(self.js("document.documentElement.dataset.scheme ?? null"))
        # a workday without preset says so
        self.assertEqual(self.js("document.querySelector('#s-weekday-0 option[value=arbeit]').textContent"),
                         "Arbeitstag (nicht vorbelegt)")
        self.js("document.getElementById('logout').click()")
        b.wait_for("location.pathname === '/login.php'")
        self.assertEqual(self.js(active), ["css-warm"])
        self.assertEqual(b.errors, [])

    def test_phone_view(self):
        b = self.browser
        b.call("Emulation.setDeviceMetricsOverride", width=390, height=844, deviceScaleFactor=2, mobile=True)
        b.call("Emulation.setTouchEmulationEnabled", enabled=True, maxTouchPoints=5)
        b.call("Emulation.setEmulatedMedia", features=[{"name": "pointer", "value": "coarse"},
                                                       {"name": "hover", "value": "none"}])
        self.login("admin@example.org", "geheim12345")
        self.js("state.year = 2026; state.month = 10; render()")
        day = cell("Fr 09.10.2026")

        def touch(duration, move=0):
            x, y = self.js(f"(() => {{ const r = {day}.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }})()")
            b.call("Input.dispatchTouchEvent", type="touchStart", touchPoints=[{"x": x, "y": y}])
            if move:
                b.call("Input.dispatchTouchEvent", type="touchMove", touchPoints=[{"x": x, "y": y + move}])
            b.wait_for("new Promise(r => setTimeout(() => r(true), %d))" % (duration * 1000))
            b.call("Input.dispatchTouchEvent", type="touchEnd", touchPoints=[])

        # a tap plans the day, the cell shows the short label
        touch(0.1)
        b.wait_for(f"{day}.classList.contains('c-homeoffice')")
        self.assertEqual(self.js(f"{day}.querySelector('.txt').innerText"), "HO")
        self.assertIn("lange drücken", self.js("document.querySelector('.legend .hint').innerText"))
        # holding the day opens its menu and leaves the plan alone; moving the finger does nothing
        touch(0.8)
        b.wait_for("!document.getElementById('context-menu').hidden")
        self.assertTrue(self.js(f"{day}.classList.contains('c-homeoffice')"))
        self.js("document.getElementById('context-menu').hidden = true")
        touch(0.8, move=40)
        self.assertTrue(self.js("document.getElementById('context-menu').hidden"))
        self.assertTrue(self.js(f"{day}.classList.contains('c-homeoffice')"))

        # time entries: two-line rows, edited by tapping the row
        self.js(f"{day}.dispatchEvent(new MouseEvent('contextmenu', {{bubbles: true, clientX: 50, clientY: 50}}));"
                "document.querySelector('#context-menu button').click();"
                "document.getElementById('f-start').value = '08:00'; document.getElementById('f-end').value = '16:30';"
                "document.getElementById('entry-form').requestSubmit()")
        b.wait_for("document.querySelectorAll('#entries-body tr').length === 1")
        self.assertEqual(self.js("getComputedStyle(document.querySelector('.entry-list thead')).display"), "none")
        self.assertEqual(self.js("getComputedStyle(document.querySelector('#entries-body button')).display"), "none")
        self.js("document.querySelector('#entries-body td').click()")
        self.assertEqual(self.js("document.getElementById('form-title').textContent"), "Eintrag bearbeiten")

        # the summary stays on the planning tabs; the status bar takes the page colour
        self.assertNotEqual(self.js("getComputedStyle(document.getElementById('summary')).display"), "none")
        self.js("document.querySelector('[data-tab=einstellungen]').click()")
        self.assertEqual(self.js("getComputedStyle(document.getElementById('summary')).display"), "none")
        self.assertEqual(self.js("document.querySelector('meta[name=theme-color]').content"), "rgb(255, 255, 255)")
        self.assertEqual(self.js("document.documentElement.scrollWidth"), 390)  # nothing sticks out sideways
        self.assertEqual(b.errors, [])

    def test_account_management(self):
        b = self.browser
        admin = Client(self.server)
        admin.api("login", {"username": "admin@example.org", "password": "geheim12345"})
        for email in ("anna@example.org", "bernd@example.org"):
            link = admin.api("admin-invite", {"username": email})[1]["link"]
            Client(self.server).api("redeem", {"token": link.split("token=")[1], "password": "passwort-123"})

        self.login("admin@example.org", "geheim12345")
        self.js("document.querySelector('[data-tab=benutzer]').click()")
        b.wait_for("document.querySelectorAll('#users-body tr').length === 3")
        self.assertEqual(self.js("document.getElementById('u-count').textContent"), "3 Konten")
        self.js("{ const s = document.getElementById('u-search'); s.value = 'ann'; s.dispatchEvent(new Event('input')) }")
        self.assertEqual(self.js("[...document.querySelectorAll('#users-body tr')].map(r => r.cells[0].textContent)"),
                         ["anna@example.org"])
        self.assertEqual(self.js("document.getElementById('u-count').textContent"), "1 von 3")

        # own account: no lock, logout or delete; role fixed
        self.js("{ const s = document.getElementById('u-search'); s.value = ''; s.dispatchEvent(new Event('input')) }"
                "[...document.querySelectorAll('#users-body tr')].find(r => r.textContent.includes('(du)')).click()")
        buttons = "[...document.querySelectorAll('#account-detail button')].map(x => x.textContent)"
        self.assertNotIn("Sperren", self.js(buttons))
        self.assertNotIn("Konto löschen", self.js(buttons))
        self.assertTrue(self.js("document.querySelector('#account-detail select').disabled"))
        self.js("[...document.querySelectorAll('#account-detail button')].find(x => x.textContent === 'Schließen').click()")

        # Anna: make admin, then lock (confirmation dialog accepted)
        self.js("window.confirm = () => true;"
                "[...document.querySelectorAll('#users-body tr')].find(r => r.textContent.includes('anna@')).click()")
        click = "[...document.querySelectorAll('#account-detail button')].find(x => x.textContent === '{}').click()"
        self.js("document.querySelector('#account-detail select').value = 'admin';" + click.format("Rolle ändern"))
        b.wait_for("document.getElementById('detail-status').textContent.includes('Rolle geändert')")
        self.assertIn("Admin · seit", self.js("document.querySelector('#account-detail .hint').textContent"))
        self.js(click.format("Sperren"))
        b.wait_for("document.getElementById('detail-status').textContent.includes('Gesperrt')")
        self.assertIn("Entsperren", self.js(buttons))
        self.assertIn("Gesperrt", self.js("[...document.querySelectorAll('#users-body tr')].find(r => r.textContent.includes('anna@')).textContent"))
        self.assertEqual(self.js("document.querySelectorAll('#account-detail .detail-section tbody tr').length"), 2)  # its log
        self.js("document.getElementById('account-dialog').close();"
                "{ const f = document.getElementById('u-filter'); f.value = 'locked'; f.dispatchEvent(new Event('change')) }")
        self.assertEqual(self.js("document.querySelectorAll('#users-body tr').length"), 1)
        self.assertIn("Gesperrt", self.js("document.getElementById('log-body').rows[0].textContent"))

        # Bernd: delete from the detail view
        self.js("{ const f = document.getElementById('u-filter'); f.value = ''; f.dispatchEvent(new Event('change')) }"
                "[...document.querySelectorAll('#users-body tr')].find(r => r.textContent.includes('bernd@')).click()")
        self.js(click.format("Konto löschen"))
        b.wait_for("!document.getElementById('account-dialog').open && document.querySelectorAll('#users-body tr').length === 2")
        self.assertEqual(b.errors, [])

    def test_read_only_account(self):
        b = self.browser
        admin = Client(self.server)
        admin.api("login", {"username": "admin@example.org", "password": "geheim12345"})
        admin.api("entry", {"day": "2026-10-05", "start": "08:00", "end": "16:30", "break": 30, "location": "homeoffice"})
        admin.api("plan", {"day": "2026-10-06", "status": "buero"})

        # the admin invites a read-only account and assigns the own account to it
        self.login("admin@example.org", "geheim12345")
        self.js("document.querySelector('[data-tab=benutzer]').click()")
        b.wait_for("typeof loadAdmin === 'function'")
        self.js("document.getElementById('i-username').value = 'leser@example.org';"
                "document.getElementById('i-role').value = 'viewer';"
                "document.getElementById('invite-form').requestSubmit()")
        link = b.wait_for("!document.getElementById('link-box').hidden && document.querySelector('#link-box input').value")
        b.wait_for("document.getElementById('links-body').textContent.includes('Nur Lesen')")
        self.js("document.getElementById('logout').click()")
        b.wait_for("location.pathname === '/login.php'")
        b.goto(link)
        b.wait_for("document.getElementById('redeem-username').textContent")
        self.js("document.getElementById('new-password').value = 'leser-pw-123';"
                "document.getElementById('new-password2').value = 'leser-pw-123';"
                "document.getElementById('redeem-form').requestSubmit()")
        # nothing shared yet: only the account tab
        b.wait_for("!document.getElementById('viewer-empty').hidden")
        self.assertTrue(self.js("document.querySelector('[data-tab=planung]').hidden"))
        self.js("document.getElementById('logout').click()")
        b.wait_for("location.pathname === '/login.php'")

        self.login("admin@example.org", "geheim12345")
        self.js("document.querySelector('[data-tab=benutzer]').click()")
        b.wait_for("document.getElementById('users-body').textContent.includes('leser@example.org')")
        self.js("[...document.querySelectorAll('#users-body tr')].find(r => r.textContent.includes('leser@')).click()")
        self.assertTrue(self.js("document.getElementById('account-dialog').open"))
        # a read-only account has no "Daten" section; nothing stray (e.g. the text "null") in its place
        self.assertFalse(self.js("[...document.getElementById('account-detail').childNodes].some(n => n.nodeType === 3)"))
        self.js("document.querySelector('#account-detail .access input').click();"
                "[...document.querySelectorAll('#account-detail button')].find(x => x.textContent === 'Freigaben speichern').click()")
        # saved and reloaded: the owner (here the admin) sees who can read the data
        b.wait_for("document.getElementById('viewers-info').textContent.includes('leser@example.org')")
        self.assertIn("gespeichert", b.wait_for("document.getElementById('detail-status').textContent"))
        self.assertTrue(self.js("document.querySelector('#account-detail .access input').checked"))
        self.assertIn("sieht 1 Konto", self.js("document.getElementById('users-body').textContent"))
        self.js("document.getElementById('logout').click()")
        b.wait_for("location.pathname === '/login.php'")

        # the read-only account sees the admin's data but cannot change anything
        self.login("leser@example.org", "leser-pw-123")
        b.wait_for("!document.getElementById('owner-box').hidden")
        self.assertEqual(self.js("document.getElementById('owner-select').selectedOptions[0].textContent"), "admin@example.org")
        self.js("state.year = 2026; state.month = 10; render()")
        self.assertIn("✓ HO 8:00", self.js(f"{cell('Mo 05.10.2026')}.textContent"))
        self.assertIn("Büro", self.js(f"{cell('Di 06.10.2026')}.textContent"))
        self.js(f"{cell('Mi 07.10.2026')}.click()")
        self.js(f"{cell('Mi 07.10.2026')}.dispatchEvent(new MouseEvent('contextmenu', {{bubbles: true, clientX: 300, clientY: 300}}))")
        self.assertTrue(self.js("document.getElementById('context-menu').hidden"))
        self.assertEqual(self.js(f"{cell('Mi 07.10.2026')}.querySelector('.txt').textContent"), "")
        self.js("document.querySelector('[data-tab=zeiterfassung]').click()")
        self.assertEqual(self.js("getComputedStyle(document.getElementById('entry-form')).display"), "none")
        self.assertEqual(self.js("document.querySelectorAll('#entries-body tr').length"), 1)
        self.assertEqual(self.js("document.querySelectorAll('#entries-body button').length"), 0)
        self.js("document.querySelector('[data-tab=einstellungen]').click()")
        self.assertEqual(self.js("getComputedStyle(document.getElementById('settings-form')).display"), "none")
        self.assertFalse(self.js("getComputedStyle(document.getElementById('password-form')).display === 'none'"))
        self.assertTrue(self.js("document.querySelector('[data-tab=benutzer]').hidden"))
        # where to ask for more access
        self.assertIn("admin@example.org", self.js("document.getElementById('admin-contacts').textContent"))
        self.assertTrue(self.js("document.querySelector('.help-list .viewer-only').offsetParent !== null"))
        self.assertEqual(b.errors, [])

    def test_feedback(self):
        b = self.browser
        admin = Client(self.server)
        admin.api("login", {"username": "admin@example.org", "password": "geheim12345"})
        link = admin.api("admin-invite", {"username": "anna@example.org"})[1]["link"]
        Client(self.server).api("redeem", {"token": link.split("token=")[1], "password": "passwort-123"})

        # Anna writes a report in Einstellungen
        self.login("anna@example.org", "passwort-123")
        self.js("document.querySelector('[data-tab=einstellungen]').click()")
        self.js("document.getElementById('f-kind').value = 'bug';"
                "document.getElementById('f-message').value = 'ab';"
                "document.getElementById('feedback-form').requestSubmit()")
        self.assertIn("kurz", b.wait_for("document.getElementById('feedback-status').textContent"))
        self.js("document.getElementById('f-message').value = 'Der Kalender springt beim Scrollen.';"
                "document.getElementById('feedback-form').requestSubmit()")
        b.wait_for("document.getElementById('feedback-status').textContent.includes('Danke')")
        self.assertEqual(self.js("document.getElementById('f-message').value"), "")

        # the admin sees "(1)" behind the tab and the text in the inbox
        self.js("fetch('api.php?action=logout', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})")
        self.login("admin@example.org", "geheim12345")
        b.wait_for("document.querySelector('.tabs [data-tab=benutzer]').textContent === 'Benutzer (1)'")
        self.js("document.querySelector('[data-tab=benutzer]').click()")
        b.wait_for("document.querySelectorAll('.feedback').length === 1")
        self.assertIn("Der Kalender springt", self.js("document.querySelector('.feedback-text').textContent"))
        self.assertIn("anna@example.org", self.js("document.querySelector('.feedback-head').textContent"))
        self.js("[...document.querySelectorAll('.feedback button')].find(x => x.textContent === 'Gelesen').click()")
        b.wait_for("document.querySelector('.tabs [data-tab=benutzer]').textContent === 'Benutzer'")
        self.js("window.confirm = () => true;"
                "[...document.querySelectorAll('.feedback button')].find(x => x.textContent === 'Erledigt').click()")
        b.wait_for("document.querySelectorAll('.feedback').length === 0")
        self.assertFalse(self.js("document.getElementById('no-feedback').hidden"))
        self.assertEqual(b.errors, [])


if __name__ == "__main__":
    unittest.main()
