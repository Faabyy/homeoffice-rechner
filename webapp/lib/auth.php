<?php
declare(strict_types=1);

// Accounts, login sessions and one-time links (invitations, password resets).
// Sessions are random tokens in an HttpOnly cookie; only their SHA-256 hash is stored,
// so a leaked database does not allow logging in. The same holds for link tokens.

const SESSION_COOKIE = 'hor_session';
const SESSION_TTL = 30 * 24 * 3600;
const INVITE_TTL = 7 * 24 * 3600;
const RESET_TTL = 24 * 3600;
const MIN_PASSWORD_LENGTH = 10;
const FAIL_WINDOW = 15 * 60;
const MAX_FAILS_PER_USERNAME = 5;
const MAX_FAILS_PER_IP = 30;
const LOCKED_MESSAGE = 'Dieses Konto ist gesperrt. Bitte wende dich an einen Admin.';

function new_token(): string
{
    return bin2hex(random_bytes(32));
}

function token_hash(string $token): string
{
    return hash('sha256', $token);
}

/** Usernames are stored lowercase; no e-mail address is needed (but an existing one stays valid). */
function normalize_username(string $username): string
{
    $username = strtolower(trim($username));
    if (!preg_match('/^[a-z0-9._@+-]{2,64}$/', $username)) {
        throw new UserError('Der Benutzername muss 2 bis 64 Zeichen lang sein und darf nur Buchstaben (ohne Umlaute), Ziffern und . _ - @ + enthalten.');
    }
    return $username;
}

function check_password_policy(string $password): void
{
    $length = preg_match_all('/./us', $password);
    if ($length < MIN_PASSWORD_LENGTH) {
        throw new UserError('Das Passwort muss mindestens ' . MIN_PASSWORD_LENGTH . ' Zeichen lang sein.');
    }
    if ($length > 200) {
        throw new UserError('Das Passwort darf höchstens 200 Zeichen lang sein.');
    }
}

function client_ip(): string
{
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
}

// ---- access restriction (config "access"; administrators are exempt) -----------------------

/** Whether $ip lies in $network, given as a single address or CIDR ("203.0.113.0/24", IPv4 or IPv6). */
function ip_in_network(string $ip, string $network): bool
{
    $parts = explode('/', trim($network), 2);
    $addr = @inet_pton($ip);
    $net = @inet_pton($parts[0]);
    if ($addr === false || $net === false || strlen($addr) !== strlen($net)) {
        return false;
    }
    $bits = isset($parts[1]) ? (int) $parts[1] : strlen($addr) * 8;
    $bytes = intdiv($bits, 8);
    if (substr($addr, 0, $bytes) !== substr($net, 0, $bytes)) {
        return false;
    }
    if ($bits % 8 === 0) {
        return true;
    }
    $mask = (0xFF << (8 - $bits % 8)) & 0xFF;
    return (ord($addr[$bytes]) & $mask) === (ord($net[$bytes]) & $mask);
}

const BLOCKED_NETWORK_MESSAGE = 'Der Homeoffice-Rechner ist in diesem Netzwerk nicht verfügbar. Bitte wechsle in ein anderes WLAN oder nutze mobile Daten.';

/** Whether the client IP lies in one of the config "access" => "blocked_networks". */
function in_blocked_network(): bool
{
    $access = config('access');
    if (!is_array($access)) {
        return false;
    }
    foreach ((array) ($access['blocked_networks'] ?? []) as $network) {
        if (ip_in_network(client_ip(), (string) $network)) {
            return true;
        }
    }
    return false;
}

/** Why this request may not be used by a normal user, or null if it may. */
function access_restriction(): ?string
{
    $access = config('access');
    if (!is_array($access)) {
        return null;
    }
    if (in_blocked_network()) {
        return BLOCKED_NETWORK_MESSAGE;
    }
    $agent = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
    if (!empty($access['mobile_only']) && !preg_match('/Android|iPhone|iPad|iPod|Mobile/i', $agent)) {
        return 'Der Homeoffice-Rechner ist nur auf dem Handy oder Tablet verfügbar. Bitte öffne ihn dort.';
    }
    return null;
}

/** @param array<string,mixed> $row */
function user_from_row(array $row): array
{
    return ['id' => (int) $row['id'], 'username' => $row['email'], 'isAdmin' => (bool) $row['is_admin'],
        'isViewer' => (bool) $row['is_viewer']];
}

// ---- sessions ---------------------------------------------------------------------------

function set_session_cookie(string $value, int $expires): void
{
    setcookie(SESSION_COOKIE, $value, [
        'expires' => $expires,
        'path' => base_path(),
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

/** The logged-in user of this request, or null. */
function current_user(): ?array
{
    static $resolved = false;
    static $user = null;
    if ($resolved) {
        return $user;
    }
    $resolved = true;
    $token = (string) ($_COOKIE[SESSION_COOKIE] ?? '');
    if ($token === '' || !https_ok()) {
        return null;
    }
    $row = db_row(
        'SELECT u.id, u.email, u.is_admin, u.is_viewer FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.locked_at IS NULL',
        [token_hash($token), time()]
    );
    $user = $row ? user_from_row($row) : null;
    if ($user && !$user['isAdmin'] && access_restriction() !== null) {
        $user = null; // the session stays valid on the allowed device
    }
    return $user;
}

function start_session(int $userId): void
{
    $token = new_token();
    $expires = time() + SESSION_TTL;
    db_exec('DELETE FROM sessions WHERE expires_at <= ?', [time()]);
    db_exec('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
        [token_hash($token), $userId, $expires]);
    set_session_cookie($token, $expires);
}

function end_session(): void
{
    $token = (string) ($_COOKIE[SESSION_COOKIE] ?? '');
    if ($token !== '') {
        db_exec('DELETE FROM sessions WHERE token_hash = ?', [token_hash($token)]);
    }
    set_session_cookie('', time() - 3600);
}

// ---- login --------------------------------------------------------------------------------

function count_failures(string $key): int
{
    $row = db_row('SELECT COUNT(*) AS n FROM login_failures WHERE fail_key = ? AND at > ?',
        [$key, time() - FAIL_WINDOW]);
    return (int) $row['n'];
}

function login(string $username, string $password): array
{
    $username = strtolower(trim($username));
    $usernameKey = 'e:' . $username;
    $ipKey = 'i:' . client_ip();
    db_exec('DELETE FROM login_failures WHERE at <= ?', [time() - FAIL_WINDOW]);
    if (count_failures($usernameKey) >= MAX_FAILS_PER_USERNAME || count_failures($ipKey) >= MAX_FAILS_PER_IP) {
        throw new UserError('Zu viele fehlgeschlagene Anmeldungen. Bitte in 15 Minuten erneut versuchen.', 429);
    }
    $row = db_row('SELECT * FROM users WHERE email = ?', [$username]);
    // Verify against a dummy hash for unknown usernames so both cases take the same time.
    $hash = $row ? $row['password_hash'] : password_hash('unknown-user', PASSWORD_DEFAULT);
    if (!password_verify($password, $hash) || !$row) {
        $now = time();
        db_exec('INSERT INTO login_failures (fail_key, at) VALUES (?, ?), (?, ?)', [$usernameKey, $now, $ipKey, $now]);
        throw new UserError('Benutzername oder Passwort ist falsch.', 401);
    }
    if ($row['locked_at'] !== null) {
        throw new UserError(LOCKED_MESSAGE, 403); // only after the right password: says nothing to strangers
    }
    $restriction = access_restriction();
    if (!$row['is_admin'] && $restriction !== null) {
        throw new UserError($restriction, 403);
    }
    if (password_needs_rehash($row['password_hash'], PASSWORD_DEFAULT)) {
        db_exec('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $row['id']]);
    }
    db_exec('DELETE FROM login_failures WHERE fail_key = ?', [$usernameKey]);
    start_session((int) $row['id']);
    return user_from_row($row);
}

function change_password(array $user, string $current, string $new): void
{
    $row = db_row('SELECT password_hash FROM users WHERE id = ?', [$user['id']]);
    if (!$row || !password_verify($current, $row['password_hash'])) {
        throw new UserError('Das aktuelle Passwort stimmt nicht.');
    }
    check_password_policy($new);
    db_exec('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $user['id']]);
    // Log out all other devices.
    $token = (string) ($_COOKIE[SESSION_COOKIE] ?? '');
    db_exec('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [$user['id'], token_hash($token)]);
}

// ---- one-time links -------------------------------------------------------------------------

function create_user(string $username, string $password, bool $isAdmin, bool $isViewer = false): int
{
    $username = normalize_username($username);
    check_password_policy($password);
    if (db_row('SELECT id FROM users WHERE email = ?', [$username])) {
        throw new UserError('Diesen Benutzernamen gibt es schon.');
    }
    db_exec('INSERT INTO users (email, password_hash, is_admin, is_viewer, created_at) VALUES (?, ?, ?, ?, ?)',
        [$username, password_hash($password, PASSWORD_DEFAULT), $isAdmin ? 1 : 0, $isViewer ? 1 : 0, time()]);
    return (int) db()->lastInsertId();
}

/** Create an invitation or password-reset link and return its URL. */
function create_link(string $kind, string $username, bool $isAdmin = false, bool $isViewer = false): string
{
    $username = normalize_username($username);
    if ($isAdmin && $isViewer) {
        throw new UserError('Ein Lese-Konto kann kein Admin sein.');
    }
    $exists = db_row('SELECT id FROM users WHERE email = ?', [$username]) !== null;
    if ($kind === 'invite' && $exists) {
        throw new UserError('Diesen Benutzernamen gibt es schon.');
    }
    if ($kind === 'reset' && !$exists) {
        throw new UserError('Dieses Konto gibt es nicht.');
    }
    $token = new_token();
    db_exec('DELETE FROM tokens WHERE email = ? AND kind = ?', [$username, $kind]);
    db_exec('INSERT INTO tokens (token_hash, kind, email, is_admin, is_viewer, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
        [token_hash($token), $kind, $username, $isAdmin ? 1 : 0, $isViewer ? 1 : 0,
            time() + ($kind === 'invite' ? INVITE_TTL : RESET_TTL)]);
    return base_url() . 'login.php?token=' . $token;
}

function link_info(string $token): ?array
{
    $row = db_row('SELECT * FROM tokens WHERE token_hash = ? AND expires_at > ?', [token_hash($token), time()]);
    return $row ? ['kind' => $row['kind'], 'username' => $row['email']] : null;
}

/** Use an invitation (creates the account) or reset link (sets a new password), then log in. */
function redeem_link(string $token, string $password): array
{
    return tx(function () use ($token, $password) {
        $row = db_row('SELECT * FROM tokens WHERE token_hash = ? AND expires_at > ?', [token_hash($token), time()]);
        if (!$row) {
            throw new UserError('Der Link ist ungültig oder abgelaufen. Bitte einen neuen Link anfordern.');
        }
        $restriction = access_restriction();
        if ($restriction !== null) {
            $account = db_row('SELECT is_admin FROM users WHERE email = ?', [$row['email']]);
            $isAdmin = $row['kind'] === 'invite' ? (bool) $row['is_admin'] : ($account && $account['is_admin']);
            if (!$isAdmin) {
                throw new UserError($restriction, 403); // the link stays valid for the phone
            }
        }
        check_password_policy($password);
        if ($row['kind'] === 'invite') {
            $userId = create_user($row['email'], $password, (bool) $row['is_admin'], (bool) $row['is_viewer']);
        } else {
            $user = db_row('SELECT id, locked_at FROM users WHERE email = ?', [$row['email']]);
            if (!$user) {
                throw new UserError('Dieses Konto gibt es nicht mehr.');
            }
            if ($user['locked_at'] !== null) {
                throw new UserError(LOCKED_MESSAGE, 403);
            }
            $userId = (int) $user['id'];
            db_exec('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $userId]);
            db_exec('DELETE FROM sessions WHERE user_id = ?', [$userId]);
        }
        db_exec('DELETE FROM tokens WHERE id = ?', [$row['id']]);
        start_session($userId);
        return user_from_row(db_row('SELECT * FROM users WHERE id = ?', [$userId]));
    });
}

/** For the `me` request: when the account was created and whom to ask for admin-only things. */
function account_info(int $userId): array
{
    $row = db_row('SELECT created_at FROM users WHERE id = ?', [$userId]);
    $admins = array_column(db_rows('SELECT email FROM users WHERE is_admin = 1 AND locked_at IS NULL ORDER BY email'), 'email');
    return ['createdAt' => date('Y-m-d', (int) ($row['created_at'] ?? 0)), 'admins' => $admins];
}

// ---- read-only accounts -------------------------------------------------------------------------

/** Accounts a read-only account may see, as [{id, username}]. */
function viewable_accounts(int $viewerId): array
{
    return array_map(function ($r) {
        return ['id' => (int) $r['id'], 'username' => $r['email']];
    }, db_rows('SELECT u.id, u.email FROM viewer_access a JOIN users u ON u.id = a.owner_id
                WHERE a.viewer_id = ? ORDER BY u.email', [$viewerId]));
}

function can_view(int $viewerId, int $ownerId): bool
{
    return db_row('SELECT 1 AS ok FROM viewer_access WHERE viewer_id = ? AND owner_id = ?', [$viewerId, $ownerId]) !== null;
}

/** Usernames of the read-only accounts that may see this account (shown to its owner). */
function viewers_of(int $ownerId): array
{
    return array_column(db_rows('SELECT u.email FROM viewer_access a JOIN users u ON u.id = a.viewer_id
                                 WHERE a.owner_id = ? ORDER BY u.email', [$ownerId]), 'email');
}
