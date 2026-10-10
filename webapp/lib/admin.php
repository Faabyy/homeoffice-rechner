<?php
declare(strict_types=1);

// Account management for admins: overview, roles, usernames, locking, sessions, read access
// between accounts, export of an account's data, and the log of everything admins do.
// Admins cannot change their own role, lock or delete themselves, so at least one
// working admin always remains.

const ROLES = ['user' => 'Nutzer', 'admin' => 'Admin', 'viewer' => 'Nur Lesen'];
const ADMIN_LOG_LIMIT = 300;

/** Write an entry to the admin log. $target: user row (id, email) or null. */
function admin_log(array $admin, string $action, ?array $target, string $details = ''): void
{
    db_exec('INSERT INTO admin_log (at, admin_id, admin_email, action, target_id, target_email, details)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
        [time(), $admin['id'], $admin['username'], $action, $target ? (int) $target['id'] : null,
            $target ? $target['email'] : null, preg_replace('/^(.{500}).+$/us', '$1', $details)]);
}

/** The user row an admin action is about. */
function admin_target(int $id): array
{
    $row = db_row('SELECT * FROM users WHERE id = ?', [$id]);
    if (!$row) {
        throw new UserError('Dieses Konto gibt es nicht (mehr).', 404);
    }
    return $row;
}

function not_self(array $admin, array $target, string $message): void
{
    if ((int) $target['id'] === $admin['id']) {
        throw new UserError($message);
    }
}

function role_of(array $row): string
{
    if ((int) $row['is_viewer']) {
        return 'viewer';
    }
    return (int) $row['is_admin'] ? 'admin' : 'user';
}

function admin_overview(): array
{
    $canView = [];
    $viewedBy = [];
    foreach (db_rows('SELECT viewer_id, owner_id FROM viewer_access') as $r) {
        $canView[(int) $r['viewer_id']][] = (int) $r['owner_id'];
        $viewedBy[(int) $r['owner_id']][] = (int) $r['viewer_id'];
    }
    $sessions = [];
    foreach (db_rows('SELECT user_id, COUNT(*) AS n FROM sessions WHERE expires_at > ? GROUP BY user_id', [time()]) as $r) {
        $sessions[(int) $r['user_id']] = (int) $r['n'];
    }
    $users = array_map(function ($r) use ($canView, $viewedBy, $sessions) {
        $id = (int) $r['id'];
        $user = user_from_row($r) + [
            'role' => role_of($r),
            'createdAt' => date('Y-m-d', (int) $r['created_at']),
            'lockedAt' => $r['locked_at'] === null ? null : date('Y-m-d H:i', (int) $r['locked_at']),
            'sessions' => $sessions[$id] ?? 0,
        ];
        // read-only accounts: whom they see; others: which read-only accounts see them
        if ($user['isViewer']) {
            $user['canView'] = $canView[$id] ?? [];
        } else {
            $user['viewedBy'] = $viewedBy[$id] ?? [];
        }
        return $user;
    }, db_rows('SELECT * FROM users ORDER BY email'));
    $links = array_map(function ($r) {
        return ['id' => (int) $r['id'], 'kind' => $r['kind'], 'username' => $r['email'],
            'isAdmin' => (bool) $r['is_admin'], 'isViewer' => (bool) $r['is_viewer'],
            'expiresAt' => date('Y-m-d H:i', (int) $r['expires_at'])];
    }, db_rows('SELECT * FROM tokens WHERE expires_at > ? ORDER BY email', [time()]));
    $log = array_map(function ($r) {
        return ['at' => date('Y-m-d H:i', (int) $r['at']), 'admin' => $r['admin_email'], 'action' => $r['action'],
            'targetId' => $r['target_id'] === null ? null : (int) $r['target_id'], 'target' => $r['target_email'],
            'details' => $r['details']];
    }, db_rows('SELECT * FROM admin_log ORDER BY id DESC LIMIT ' . ADMIN_LOG_LIMIT));
    return ['users' => $users, 'links' => $links, 'log' => $log, 'backup' => backup_status()];
}

// ---- links ------------------------------------------------------------------------------------

function admin_invite(array $admin, string $username, bool $isAdmin, bool $isViewer): string
{
    $link = create_link('invite', $username, $isAdmin, $isViewer);
    $role = $isViewer ? 'viewer' : ($isAdmin ? 'admin' : 'user');
    admin_log($admin, 'invite', null, normalize_username($username) . ' als ' . ROLES[$role]);
    return $link;
}

function admin_reset_link(array $admin, string $username): string
{
    $row = db_row('SELECT * FROM users WHERE email = ?', [strtolower(trim($username))]);
    if ($row && $row['locked_at'] !== null) {
        throw new UserError('Das Konto ist gesperrt. Entsperre es zuerst.');
    }
    $link = create_link('reset', $username);
    admin_log($admin, 'reset', $row);
    return $link;
}

function admin_revoke_link(array $admin, int $id): void
{
    $row = db_row('SELECT * FROM tokens WHERE id = ?', [$id]);
    if ($row) {
        db_exec('DELETE FROM tokens WHERE id = ?', [$id]);
        admin_log($admin, 'revoke', null,
            ($row['kind'] === 'invite' ? 'Einladung für ' : 'Passwort-Link für ') . $row['email']);
    }
}

// ---- account changes ------------------------------------------------------------------------

function admin_set_role(array $admin, int $id, $role): void
{
    $target = admin_target($id);
    not_self($admin, $target, 'Deine eigene Rolle kann nur ein anderer Admin ändern.');
    if (!is_string($role) || !isset(ROLES[$role])) {
        throw new UserError('Unbekannte Rolle.');
    }
    $old = role_of($target);
    if ($old === $role) {
        return;
    }
    tx(function () use ($id, $role, $old) {
        if ($role === 'viewer') {
            // a read-only account has no own data
            $counts = [];
            foreach (['entries' => 'Einträge', 'plan' => 'Planungen', 'flex_adjustments' => 'Gleitzeit-Korrekturen'] as $table => $label) {
                $n = (int) db_row("SELECT COUNT(*) AS n FROM $table WHERE user_id = ?", [$id])['n'];
                if ($n) {
                    $counts[] = "$n $label";
                }
            }
            if ($counts) {
                throw new UserError('Das Konto hat eigene Daten (' . implode(', ', $counts) . '). Ein Lese-Konto hat '
                    . 'keine eigenen Daten – lege dafür besser ein neues Konto mit der Rolle „Nur Lesen“ an.');
            }
            db_exec('DELETE FROM viewer_access WHERE owner_id = ?', [$id]);
        }
        if ($old === 'viewer') {
            db_exec('DELETE FROM viewer_access WHERE viewer_id = ?', [$id]);
        }
        db_exec('UPDATE users SET is_admin = ?, is_viewer = ? WHERE id = ?',
            [$role === 'admin' ? 1 : 0, $role === 'viewer' ? 1 : 0, $id]);
    });
    admin_log($admin, 'role', $target, ROLES[$old] . ' → ' . ROLES[$role]);
}

function admin_set_username(array $admin, int $id, string $username): void
{
    $target = admin_target($id);
    $username = normalize_username($username);
    if ($username === $target['email']) {
        return;
    }
    if (db_row('SELECT id FROM users WHERE email = ?', [$username])) {
        throw new UserError('Diesen Benutzernamen gibt es schon.');
    }
    tx(function () use ($id, $username, $target) {
        db_exec('UPDATE users SET email = ? WHERE id = ?', [$username, $id]);
        // an open password link keeps working for the renamed account
        db_exec("UPDATE tokens SET email = ? WHERE email = ? AND kind = 'reset'", [$username, $target['email']]);
    });
    admin_log($admin, 'username', ['id' => $id, 'email' => $username], $target['email'] . ' → ' . $username);
}

function admin_set_locked(array $admin, int $id, $locked): void
{
    $target = admin_target($id);
    not_self($admin, $target, 'Du kannst dein eigenes Konto nicht sperren.');
    if (!is_bool($locked)) {
        throw new UserError('Ungültige Anfrage.');
    }
    if ($locked === ($target['locked_at'] !== null)) {
        return;
    }
    tx(function () use ($id, $locked, $target) {
        db_exec('UPDATE users SET locked_at = ? WHERE id = ?', [$locked ? time() : null, $id]);
        if ($locked) {
            db_exec('DELETE FROM sessions WHERE user_id = ?', [$id]);
            db_exec("DELETE FROM tokens WHERE email = ? AND kind = 'reset'", [$target['email']]);
        }
    });
    admin_log($admin, $locked ? 'lock' : 'unlock', $target);
}

/** End all sessions of an account (logged out on every device). Returns how many. */
function admin_logout_everywhere(array $admin, int $id): int
{
    $target = admin_target($id);
    not_self($admin, $target, 'Um dich selbst abzumelden, nutze „Abmelden“ oben rechts.');
    $count = db_exec('DELETE FROM sessions WHERE user_id = ?', [$id]);
    admin_log($admin, 'logout', $target, $count === 1 ? '1 Sitzung' : "$count Sitzungen");
    return $count;
}

function admin_delete_user(array $admin, int $id): void
{
    $target = admin_target($id);
    not_self($admin, $target, 'Du kannst dein eigenes Konto nicht löschen.');
    tx(function () use ($id) {
        // Delete dependents explicitly: SQLite only cascades with foreign_keys on.
        foreach (['entries', 'plan', 'flex_adjustments', 'sessions'] as $table) {
            db_exec("DELETE FROM $table WHERE user_id = ?", [$id]);
        }
        db_exec('DELETE FROM viewer_access WHERE viewer_id = ? OR owner_id = ?', [$id, $id]);
        db_exec('DELETE FROM users WHERE id = ?', [$id]);
    });
    admin_log($admin, 'delete', $target, ROLES[role_of($target)]);
}

/** An account's data in the format of the user's own export. */
function admin_export(array $admin, int $id): array
{
    $target = admin_target($id);
    if ((int) $target['is_viewer']) {
        throw new UserError('Ein Lese-Konto hat keine eigenen Daten.');
    }
    admin_log($admin, 'export', $target);
    return ['username' => $target['email']] + load_user_data($id);
}

// ---- read access between accounts ------------------------------------------------------------

/** Validated, distinct ids of accounts that are (or are not) read-only. */
function account_ids($ids, bool $viewers, string $message): array
{
    if (!is_array($ids)) {
        throw new UserError('Ungültige Auswahl.');
    }
    $result = [];
    foreach ($ids as $id) {
        $result[] = valid_int($id, 1, PHP_INT_MAX, 'Ungültige Auswahl.');
    }
    $result = array_values(array_unique($result));
    foreach ($result as $id) {
        $row = db_row('SELECT is_viewer FROM users WHERE id = ?', [$id]);
        if (!$row || (bool) (int) $row['is_viewer'] !== $viewers) {
            throw new UserError($message);
        }
    }
    return $result;
}

/** Usernames of accounts by id, for the log. */
function usernames_of(array $ids): string
{
    if (!$ids) {
        return 'niemand';
    }
    $marks = implode(', ', array_fill(0, count($ids), '?'));
    return implode(', ', array_column(db_rows("SELECT email FROM users WHERE id IN ($marks) ORDER BY email", $ids), 'email'));
}

/** Replace the set of accounts a read-only account may see. */
function set_viewer_access(array $admin, int $viewerId, $ownerIds): void
{
    $viewer = admin_target($viewerId);
    if (!(int) $viewer['is_viewer']) {
        throw new UserError('Das ist kein Lese-Konto.');
    }
    $ids = account_ids($ownerIds, false, 'Lese-Konten können nur Konten mit eigenen Daten sehen.');
    tx(function () use ($viewerId, $ids) {
        db_exec('DELETE FROM viewer_access WHERE viewer_id = ?', [$viewerId]);
        foreach ($ids as $id) {
            db_exec('INSERT INTO viewer_access (viewer_id, owner_id) VALUES (?, ?)', [$viewerId, $id]);
        }
    });
    admin_log($admin, 'access', $viewer, 'darf sehen: ' . usernames_of($ids));
}

/** Replace the set of read-only accounts that may see an account. */
function set_owner_access(array $admin, int $ownerId, $viewerIds): void
{
    $owner = admin_target($ownerId);
    if ((int) $owner['is_viewer']) {
        throw new UserError('Ein Lese-Konto hat keine eigenen Daten, die jemand sehen könnte.');
    }
    $ids = account_ids($viewerIds, true, 'Nur Lese-Konten können Daten anderer sehen.');
    tx(function () use ($ownerId, $ids) {
        db_exec('DELETE FROM viewer_access WHERE owner_id = ?', [$ownerId]);
        foreach ($ids as $id) {
            db_exec('INSERT INTO viewer_access (viewer_id, owner_id) VALUES (?, ?)', [$id, $ownerId]);
        }
    });
    admin_log($admin, 'access', $owner, 'sichtbar für: ' . usernames_of($ids));
}
