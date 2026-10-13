import unittest

from tests.support import Client, PhpServer

PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36"
LAPTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0"


class AccessRestrictionTest(unittest.TestCase):
    """config "access": blocked networks and mobile-only apply to users, not to admins."""

    def start(self, access: str):
        self.server = PhpServer(f"'access' => {access}")
        self.addCleanup(self.server.close)
        admin = Client(self.server)
        self.assertEqual(admin.setup_admin(), 302)
        status, res = admin.api("admin-invite", {"username": "kollegin@example.org"}, **{"User-Agent": LAPTOP})
        self.assertEqual(status, 200, res)
        return res["link"].split("token=")[1]

    def test_mobile_only_blocks_laptops_but_not_phones_or_admins(self):
        token = self.start("['mobile_only' => true]")
        laptop = Client(self.server)
        status, res = laptop.api("redeem", {"token": token, "password": "kollegin-pw-1"}, **{"User-Agent": LAPTOP})
        self.assertEqual((status, res["error"]), (403, "Der Homeoffice-Rechner ist nur auf dem Handy oder Tablet verfügbar. Bitte öffne ihn dort."))
        phone = Client(self.server)  # the link still works on the phone
        self.assertEqual(phone.api("redeem", {"token": token, "password": "kollegin-pw-1"}, **{"User-Agent": PHONE})[0], 200)
        self.assertEqual(phone.api("me", **{"User-Agent": PHONE})[0], 200)
        self.assertEqual(phone.api("me", **{"User-Agent": LAPTOP})[0], 401)  # same session, laptop browser
        login = {"username": "kollegin@example.org", "password": "kollegin-pw-1"}
        self.assertEqual(laptop.api("login", login, **{"User-Agent": LAPTOP})[0], 403)
        self.assertEqual(laptop.api("login", login, **{"User-Agent": PHONE})[0], 200)
        admin = Client(self.server)
        status, res = admin.api("login", {"username": "admin@example.org", "password": "geheim12345"}, **{"User-Agent": LAPTOP})
        self.assertEqual(status, 200, res)
        self.assertEqual(admin.api("data", **{"User-Agent": LAPTOP})[0], 200)

    def test_blocked_network_applies_to_phones_too(self):
        token = self.start("['blocked_networks' => ['10.0.0.1', '127.0.0.0/8']]")
        phone = Client(self.server)
        status, res = phone.api("redeem", {"token": token, "password": "kollegin-pw-1"}, **{"User-Agent": PHONE})
        self.assertEqual(status, 403)
        self.assertIn("in diesem Netzwerk nicht verfügbar", res["error"])

    def test_blocked_network_gets_no_login_page_but_laptops_do(self):
        self.start("['blocked_networks' => ['127.0.0.0/8']]")
        status, _, body = Client(self.server).request("GET", "login.php", headers={"User-Agent": LAPTOP})
        self.assertEqual(status, 403)
        self.assertIn("in diesem Netzwerk nicht verfügbar", body.decode())
        self.assertEqual(Client(self.server).request("GET", "login.php?token=x", headers={"User-Agent": PHONE})[0], 403)
        self.server.close()
        self.start("['blocked_networks' => ['10.0.0.0/8'], 'mobile_only' => true]")
        status, _, _ = Client(self.server).request("GET", "login.php", headers={"User-Agent": LAPTOP})
        self.assertEqual(status, 200)  # mobile_only still shows the page; only the login itself is refused

    def test_network_outside_the_list_is_allowed(self):
        token = self.start("['blocked_networks' => ['127.0.0.2/32', '10.0.0.0/8', '::1/128']]")
        phone = Client(self.server)
        self.assertEqual(phone.api("redeem", {"token": token, "password": "kollegin-pw-1"})[0], 200)
