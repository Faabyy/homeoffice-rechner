"""Test helpers: a PHP dev server with a throwaway database, an HTTP client with
cookies, and a minimal Chrome DevTools Protocol client to drive a headless browser.

Needs PHP (env PHP_BIN or `php` on PATH) and, for browser tests, Edge or Chrome
(env BROWSER_BIN or the default install locations). Tests skip what is missing.
"""

from __future__ import annotations

import base64
import http.cookiejar
import json
import os
import shutil
import socket
import struct
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

WEBAPP = Path(__file__).resolve().parent.parent / "webapp"
SETUP_KEY = "test-setup-key-1234567890"

BROWSER_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
]


LOCAL_PHP = WEBAPP.parent / "lokal" / "php" / "php.exe"


def php_bin() -> str | None:
    if os.environ.get("PHP_BIN"):
        return os.environ["PHP_BIN"]
    # the portable php.exe only runs on Windows
    return str(LOCAL_PHP) if os.name == "nt" and LOCAL_PHP.exists() else shutil.which("php")


def browser_bin() -> str | None:
    if os.environ.get("BROWSER_BIN"):
        return os.environ["BROWSER_BIN"]
    return next((p for p in BROWSER_CANDIDATES if Path(p).exists()), None)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class PhpServer:
    """`php -S` serving webapp/ with its own config and SQLite file in a temp dir."""

    def __init__(self, extra_config: str = "") -> None:
        php = php_bin()
        if not php:
            raise unittest.SkipTest("PHP nicht gefunden (PHP_BIN setzen)")
        self.tmp = tempfile.TemporaryDirectory()
        tmp = Path(self.tmp.name)
        db_path = str(tmp / "test.sqlite").replace("\\", "\\\\")
        config = tmp / "config.php"
        config.write_text(
            "<?php return ['db' => ['driver' => 'sqlite', 'path' => '" + db_path + "'], "
            f"'require_https' => false, 'setup_key' => '{SETUP_KEY}', {extra_config}];\n", encoding="utf-8")
        self.port = free_port()
        self.base = f"http://127.0.0.1:{self.port}/"
        self.log = open(tmp / "server.log", "wb")
        self.proc = subprocess.Popen(
            [php, "-S", f"127.0.0.1:{self.port}", "-t", str(WEBAPP)],
            cwd=WEBAPP, env={**os.environ, "HOR_CONFIG": str(config)},
            stdout=self.log, stderr=subprocess.STDOUT)
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", self.port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)

    def close(self) -> None:
        self.proc.kill()
        self.proc.wait()
        self.log.close()
        self.tmp.cleanup()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Client:
    """HTTP client with its own cookie jar (= one browser / one person)."""

    def __init__(self, server: PhpServer) -> None:
        self.base = server.base
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar), NoRedirect())

    def request(self, method: str, path: str, body: bytes | None = None,
                headers: dict | None = None) -> tuple[int, dict, bytes]:
        req = urllib.request.Request(self.base + path, data=body, method=method, headers=headers or {})
        try:
            with self.opener.open(req, timeout=15) as res:
                return res.status, dict(res.headers), res.read()
        except urllib.error.HTTPError as err:
            with err:
                return err.code, dict(err.headers), err.read()

    def api(self, action: str, body: dict | None = None, **headers) -> tuple[int, dict]:
        if body is None:
            status, _, raw = self.request("GET", f"api.php?action={action}", headers=headers)
        else:
            headers = {"Content-Type": "application/json", **headers}
            status, _, raw = self.request("POST", f"api.php?action={action}",
                                          json.dumps(body).encode(), headers)
        return status, json.loads(raw or b"{}")

    def setup_admin(self, email: str = "admin@example.org", password: str = "geheim12345") -> int:
        form = f"username={email}&password={password}&password2={password}".encode()
        status, _, _ = self.request("POST", f"setup.php?key={SETUP_KEY}", form,
                                    {"Content-Type": "application/x-www-form-urlencoded"})
        return status


class Browser:
    """Headless Edge/Chrome driven over the DevTools protocol (stdlib only)."""

    def __init__(self) -> None:
        exe = browser_bin()
        if not exe:
            raise unittest.SkipTest("Kein Browser gefunden (BROWSER_BIN setzen)")
        self.profile = tempfile.TemporaryDirectory()
        port = free_port()
        self.proc = subprocess.Popen(
            [exe, "--headless=new", "--disable-gpu", f"--remote-debugging-port={port}",
             f"--user-data-dir={self.profile.name}", "--window-size=1280,900", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        targets = None
        for _ in range(100):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=1) as res:
                    targets = json.load(res)
                if any(t["type"] == "page" for t in targets):
                    break
            except OSError:
                pass
            time.sleep(0.1)
        ws_url = next(t for t in targets if t["type"] == "page")["webSocketDebuggerUrl"]
        host, path = ws_url[len("ws://"):].split("/", 1)
        h, p = host.split(":")
        self.sock = socket.create_connection((h, int(p)))
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            f"GET /{path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
        self.buf = b""
        while b"\r\n\r\n" not in self.buf:
            self.buf += self.sock.recv(4096)
        self.buf = self.buf.split(b"\r\n\r\n", 1)[1]
        self.msg_id = 0
        self.errors: list = []
        self.dialogs: list[str] = []
        self.call("Runtime.enable")
        self.call("Page.enable")

    # -- websocket framing --
    def _send(self, obj: dict) -> None:
        data = json.dumps(obj).encode()
        mask = os.urandom(4)
        n = len(data)
        if n < 126:
            header = bytes([0x81, 0x80 | n])
        elif n < 65536:
            header = bytes([0x81, 0x80 | 126]) + struct.pack(">H", n)
        else:
            header = bytes([0x81, 0x80 | 127]) + struct.pack(">Q", n)
        self.sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _read(self, n: int) -> bytes:
        while len(self.buf) < n:
            self.buf += self.sock.recv(65536)
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _recv(self) -> dict:
        _, b2 = self._read(2)
        n = b2 & 0x7F
        if n == 126:
            n = struct.unpack(">H", self._read(2))[0]
        elif n == 127:
            n = struct.unpack(">Q", self._read(8))[0]
        return json.loads(self._read(n))

    def _handle_event(self, msg: dict) -> None:
        method = msg.get("method")
        if method == "Runtime.exceptionThrown":
            self.errors.append(msg["params"]["exceptionDetails"])
        elif method == "Runtime.consoleAPICalled" and msg["params"]["type"] == "error":
            self.errors.append(msg["params"]["args"])
        elif method == "Page.javascriptDialogOpening":
            self.dialogs.append(msg["params"]["message"])
            self._send({"id": 0, "method": "Page.handleJavaScriptDialog", "params": {"accept": True}})

    def call(self, method: str, **params) -> dict:
        self.msg_id += 1
        self._send({"id": self.msg_id, "method": method, "params": params})
        while True:
            msg = self._recv()
            self._handle_event(msg)
            if msg.get("id") == self.msg_id:
                if "error" in msg:
                    raise RuntimeError(msg["error"])
                return msg.get("result", {})

    def js(self, expression: str):
        result = self.call("Runtime.evaluate", expression=expression, awaitPromise=True, returnByValue=True)
        if "exceptionDetails" in result:
            raise AssertionError(result["exceptionDetails"])
        return result["result"].get("value")

    def wait_for(self, expression: str, timeout: float = 5.0):
        """Poll until the JS expression is truthy; returns its value."""
        deadline = time.time() + timeout
        while True:
            try:
                value = self.js(expression)
            except AssertionError:
                value = None
            if value:
                return value
            if time.time() > deadline:
                raise AssertionError(f"Zeitüberschreitung beim Warten auf: {expression}")
            time.sleep(0.1)

    def goto(self, url: str) -> None:
        self.call("Page.navigate", url=url)
        self.wait_for("document.readyState === 'complete'")

    def close(self) -> None:
        try:
            # Ask the browser to quit first: a confined (snap) browser may not accept kill().
            self._send({"id": 0, "method": "Browser.close", "params": {}})
            self.proc.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            try:
                self.proc.kill()
                self.proc.wait()
            except PermissionError:
                pass
        finally:
            self.sock.close()
            self.profile.cleanup()
