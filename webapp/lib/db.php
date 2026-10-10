<?php
declare(strict_types=1);

// Database access via PDO. SQLite (one file, no setup) by default, MySQL optional.
// Keep SQL portable between both: no upserts, no driver-specific functions.

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    $cfg = config('db');
    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ];
    if (($cfg['driver'] ?? 'sqlite') === 'mysql') {
        $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $cfg['host'], $cfg['name']);
        $pdo = new PDO($dsn, $cfg['user'], $cfg['password'], $options);
    } else {
        $options[PDO::ATTR_TIMEOUT] = 10;
        $pdo = new PDO('sqlite:' . $cfg['path'], null, null, $options);
        $pdo->exec('PRAGMA foreign_keys = ON');
    }
    ensure_schema($pdo);
    return $pdo;
}

function db_driver(): string
{
    return (config('db')['driver'] ?? 'sqlite') === 'mysql' ? 'mysql' : 'sqlite';
}

function ensure_schema(PDO $pdo): void
{
    if (table_exists($pdo, 'admin_log')) {
        return; // newest table exists, so the schema is complete
    }
    // Create every missing table (with its indexes) and add missing columns. Existing data
    // stays untouched, so a database from an older version simply gets the new parts.
    $mysql = db_driver() === 'mysql';
    $autoId = $mysql ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY';
    $suffix = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
    $tables = [
        'users' => ["CREATE TABLE users (
            id $autoId,
            email VARCHAR(254) NOT NULL UNIQUE,         -- stored lowercase
            password_hash VARCHAR(255) NOT NULL,
            is_admin INT NOT NULL DEFAULT 0,
            is_viewer INT NOT NULL DEFAULT 0,           -- read-only account without own data
            settings TEXT NULL,                         -- JSON, NULL = defaults
            created_at INT NOT NULL,
            locked_at INT NULL                          -- set = locked by an admin, cannot log in
        )$suffix"],
        'sessions' => ["CREATE TABLE sessions (
            token_hash CHAR(64) NOT NULL PRIMARY KEY,
            user_id INT NOT NULL,
            expires_at INT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )$suffix"],
        // one-time links: invitations (create an account) and password resets
        'tokens' => ["CREATE TABLE tokens (
            id $autoId,
            token_hash CHAR(64) NOT NULL UNIQUE,
            kind VARCHAR(10) NOT NULL,                  -- 'invite' or 'reset'
            email VARCHAR(254) NOT NULL,
            is_admin INT NOT NULL DEFAULT 0,
            is_viewer INT NOT NULL DEFAULT 0,
            expires_at INT NOT NULL
        )$suffix"],
        'entries' => ["CREATE TABLE entries (
            id VARCHAR(32) NOT NULL PRIMARY KEY,
            user_id INT NOT NULL,
            day CHAR(10) NOT NULL,                      -- YYYY-MM-DD
            start_time CHAR(5) NOT NULL,                -- HH:MM
            end_time CHAR(5) NOT NULL,
            break_minutes INT NOT NULL,
            location VARCHAR(16) NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )$suffix", 'CREATE INDEX entries_user_day ON entries (user_id, day)'],
        // planned location ('homeoffice' / 'buero') or day off ('frei')
        'plan' => ["CREATE TABLE plan (
            user_id INT NOT NULL,
            day CHAR(10) NOT NULL,
            status VARCHAR(16) NOT NULL,
            PRIMARY KEY (user_id, day),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )$suffix"],
        'login_failures' => ["CREATE TABLE login_failures (
            fail_key VARCHAR(300) NOT NULL,
            at INT NOT NULL
        )$suffix", 'CREATE INDEX login_failures_key ON login_failures (fail_key, at)'],
        // manual corrections of the flextime balance (e.g. carry-over from before using the app)
        'flex_adjustments' => ["CREATE TABLE flex_adjustments (
            id VARCHAR(32) NOT NULL PRIMARY KEY,
            user_id INT NOT NULL,
            day CHAR(10) NOT NULL,                      -- YYYY-MM-DD
            minutes INT NOT NULL,                       -- positive or negative
            note VARCHAR(200) NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )$suffix"],
        // which accounts a read-only account (users.is_viewer) may see
        'viewer_access' => ["CREATE TABLE viewer_access (
            viewer_id INT NOT NULL,
            owner_id INT NOT NULL,
            PRIMARY KEY (viewer_id, owner_id),
            FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
        )$suffix"],
        // what admins did (no foreign keys: entries stay when accounts are deleted)
        'admin_log' => ["CREATE TABLE admin_log (
            id $autoId,
            at INT NOT NULL,
            admin_id INT NOT NULL,
            admin_email VARCHAR(254) NOT NULL,
            action VARCHAR(20) NOT NULL,                -- see ADMIN_ACTIONS in assets/app.js
            target_id INT NULL,
            target_email VARCHAR(254) NULL,
            details VARCHAR(500) NOT NULL
        )$suffix", 'CREATE INDEX admin_log_target ON admin_log (target_id)'],
    ];
    // columns added after the first release: [table, column, definition]
    $columns = [
        ['users', 'is_viewer', 'INT NOT NULL DEFAULT 0'],
        ['tokens', 'is_viewer', 'INT NOT NULL DEFAULT 0'],
        ['users', 'locked_at', 'INT NULL'],
    ];
    foreach ($tables as $table => $statements) {
        if (!table_exists($pdo, $table)) {
            foreach ($statements as $sql) {
                $pdo->exec($sql);
            }
        }
    }
    foreach ($columns as [$table, $column, $definition]) {
        if (!column_exists($pdo, $table, $column)) {
            $pdo->exec("ALTER TABLE $table ADD COLUMN $column $definition");
        }
    }
}

function table_exists(PDO $pdo, string $table): bool
{
    try {
        $pdo->query("SELECT 1 FROM $table LIMIT 1");
        return true;
    } catch (PDOException $e) {
        return false;
    }
}

function column_exists(PDO $pdo, string $table, string $column): bool
{
    try {
        $pdo->query("SELECT $column FROM $table LIMIT 1");
        return true;
    } catch (PDOException $e) {
        return false;
    }
}

/**
 * Run $fn inside a transaction.
 * @return mixed
 */
function tx(callable $fn)
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $result = $fn($pdo);
        $pdo->commit();
        return $result;
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

/** @return array<string,mixed>|null */
function db_row(string $sql, array $params = []): ?array
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    $row = $stmt->fetch();
    return $row === false ? null : $row;
}

/** @return array<int,array<string,mixed>> */
function db_rows(string $sql, array $params = []): array
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchAll();
}

function db_exec(string $sql, array $params = []): int
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt->rowCount();
}
