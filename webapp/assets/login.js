"use strict";

// Login page; with ?token=… it sets the password of an invitation or reset link instead.

const $ = (id) => document.getElementById(id);

async function post(action, body) {
  const response = await fetch(`api.php?action=${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Serverfehler (${response.status})`);
  return data;
}

function showError(message) {
  $("error").textContent = message || "";
}

async function login(event) {
  event.preventDefault();
  showError("");
  try {
    await post("login", { username: $("username").value, password: $("password").value });
    location.href = "./";
  } catch (error) {
    showError(error.message);
    $("password").select();
  }
}

async function setupRedeem(token) {
  $("login-form").hidden = true;
  let info;
  try {
    const response = await fetch(`api.php?action=link&token=${encodeURIComponent(token)}`);
    info = await response.json();
    if (!response.ok) throw new Error(info.error);
  } catch (error) {
    showError(error.message || "Der Link ist ungültig oder abgelaufen.");
    return;
  }
  const invite = info.kind === "invite";
  $("redeem-title").textContent = invite ? "Konto anlegen" : "Neues Passwort festlegen";
  $("redeem-username").textContent = `für ${info.username}`;
  $("redeem-submit").textContent = invite ? "Konto anlegen" : "Passwort speichern";
  $("redeem-form").hidden = false;
  $("new-password").focus();
  $("redeem-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");
    if ($("new-password").value !== $("new-password2").value) {
      showError("Die beiden Passwörter stimmen nicht überein.");
      return;
    }
    try {
      await post("redeem", { token, password: $("new-password").value });
      location.href = "./";
    } catch (error) {
      showError(error.message);
    }
  });
}

const token = new URLSearchParams(location.search).get("token");
if (token) {
  // Remove the token from the address bar and history.
  history.replaceState(null, "", location.pathname);
  setupRedeem(token);
} else {
  $("login-form").addEventListener("submit", login);
  $("username").focus();
}
