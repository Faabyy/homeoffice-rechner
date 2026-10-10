<?php
declare(strict_types=1);

// One-time setup: checks the server and creates the first administrator.
// Only usable with the setup key from lib/config.php: setup.php?key=...
// Once an account exists it only shows the checks; it can then be deleted.

require __DIR__ . '/lib/bootstrap.php';

security_headers();
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');

$key = (string) ($_GET['key'] ?? '');
$validKey = is_string(config('setup_key')) && strlen(config('setup_key')) >= 16
    && hash_equals(config('setup_key'), $key);
$error = '';

/** @return array{0: bool|null, 1: string} */
function probe_data_protection(): array
{
    // Request a file in data/ over HTTP: if it is readable, the database would be too.
    $file = __DIR__ . '/data/probe.txt';
    @file_put_contents($file, 'probe');
    $context = stream_context_create(['http' => ['timeout' => 5, 'ignore_errors' => true],
        'ssl' => ['verify_peer' => false, 'verify_peer_name' => false]]);
    $body = @file_get_contents(base_url() . 'data/probe.txt', false, $context);
    @unlink($file);
    if ($body === false) {
        return [null, 'nicht prüfbar (der Server kann sich selbst nicht abrufen) – bitte selbst testen: '
            . base_url() . 'data/ muss „Forbidden“ zeigen'];
    }
    return $body === 'probe' ? [false, 'NICHT geschützt – die .htaccess in data/ wirkt nicht'] : [true, 'geschützt'];
}

$checks = [];
$checks[] = [version_compare(PHP_VERSION, '7.4', '>='), 'PHP-Version', PHP_VERSION];
$driver = db_driver();
$checks[] = [extension_loaded("pdo_$driver"), "PHP-Erweiterung pdo_$driver", extension_loaded("pdo_$driver") ? 'vorhanden' : 'fehlt'];
$checks[] = [is_https(), 'HTTPS', is_https() ? 'aktiv' : 'nicht aktiv – bitte über https:// aufrufen'];
if ($driver === 'sqlite') {
    $dir = dirname(config('db')['path']);
    $checks[] = [is_writable($dir), 'Ordner data/ beschreibbar', is_writable($dir) ? 'ja' : 'nein – Schreibrechte setzen (z. B. 755 oder 775)'];
}
$dbOk = false;
$userCount = 0;
try {
    $userCount = (int) db_row('SELECT COUNT(*) AS n FROM users')['n'];
    $dbOk = true;
    $checks[] = [true, 'Datenbank', 'verbunden'];
} catch (Throwable $e) {
    $checks[] = [false, 'Datenbank', 'Fehler: ' . $e->getMessage()];
}
// The PHP dev server (php -S) handles one request at a time and cannot fetch itself.
if ($validKey && $driver === 'sqlite' && PHP_SAPI !== 'cli-server'
    && ($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    [$ok, $text] = probe_data_protection();
    $checks[] = [$ok, 'Datenbank vor Abruf aus dem Web geschützt', $text];
}

if ($validKey && $dbOk && $userCount === 0 && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    try {
        if (!https_ok()) {
            throw new UserError('Bitte die Seite über https:// aufrufen.');
        }
        if ((string) ($_POST['password'] ?? '') !== (string) ($_POST['password2'] ?? '')) {
            throw new UserError('Die beiden Passwörter stimmen nicht überein.');
        }
        $userId = create_user((string) ($_POST['email'] ?? ''), (string) ($_POST['password'] ?? ''), true);
        start_session($userId);
        header('Location: ' . base_path());
        exit;
    } catch (UserError $e) {
        $error = $e->getMessage();
    }
}
?>
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Einrichtung · Homeoffice-Rechner</title>
  <link rel="stylesheet" href="assets/app.css?v=<?= filemtime(__DIR__ . '/assets/app.css') ?>">
</head>
<body>
  <main class="narrow">
    <h1>Einrichtung</h1>
<?php if (!$validKey): ?>
    <p class="form-error">Ungültiger oder fehlender Schlüssel. Rufe die Seite mit dem Link aus der Anleitung auf
      (setup.php?key=…, der Schlüssel steht in lib/config.php).</p>
<?php else: ?>
    <table class="checks">
<?php foreach ($checks as [$ok, $label, $text]): ?>
      <tr>
        <td class="<?= $ok === true ? 'ok' : ($ok === false ? 'bad' : 'warn') ?>"><?= $ok === true ? '✓' : ($ok === false ? '✗' : '?') ?></td>
        <td><?= h($label) ?></td>
        <td><?= h((string) $text) ?></td>
      </tr>
<?php endforeach; ?>
    </table>
<?php if ($dbOk && $userCount === 0): ?>
    <h2>Admin-Konto anlegen</h2>
    <p class="hint">Mit diesem Konto lädst du später weitere Personen ein.</p>
<?php if ($error !== ''): ?>
    <p class="form-error"><?= h($error) ?></p>
<?php endif; ?>
    <form method="post" action="setup.php?key=<?= h($key) ?>" class="stack">
      <label class="field">E-Mail-Adresse <input type="email" name="email" id="email" required autocomplete="username"
        value="<?= h((string) ($_POST['email'] ?? '')) ?>"></label>
      <label class="field">Passwort (mindestens <?= MIN_PASSWORD_LENGTH ?> Zeichen)
        <input type="password" name="password" id="password" required autocomplete="new-password"></label>
      <label class="field">Passwort wiederholen
        <input type="password" name="password2" id="password2" required autocomplete="new-password"></label>
      <button type="submit" class="primary">Konto anlegen</button>
    </form>
<?php elseif ($dbOk): ?>
    <p>Die Einrichtung ist abgeschlossen. <a href="./">Zur App</a></p>
    <p class="hint">Du kannst setup.php jetzt vom Server löschen.</p>
<?php endif; ?>
<?php endif; ?>
  </main>
</body>
</html>
