<?php
declare(strict_types=1);

// Automatic backups of the SQLite database. There is no cron job on the shared webspace, so
// the first request of a logged-in user after the interval has passed makes the backup.
// Copies live in data/backups/ (denied to the web by data/.htaccess) and the oldest are
// deleted beyond the configured number. With MySQL nothing happens: the host backs that up.
// Config (lib/config.php, optional): 'backup_days' (default 7, 0 = off), 'backup_keep' (default 8).

const BACKUP_RETRY_SECONDS = 3600; // after a failed attempt, wait before trying again

function backup_days(): int
{
    $days = config('backup_days');
    return is_int($days) ? max($days, 0) : 7;
}

function backup_keep(): int
{
    $keep = config('backup_keep');
    return is_int($keep) && $keep >= 1 ? $keep : 8;
}

function backup_enabled(): bool
{
    return db_driver() === 'sqlite' && backup_days() > 0;
}

function backup_dir(): string
{
    return dirname((string) config('db')['path']) . '/backups';
}

/** Backup files, newest first (the file names start with the date). @return string[] */
function backup_files(string $dir): array
{
    $files = glob($dir . '/sicherung-*.sqlite') ?: [];
    rsort($files);
    return $files;
}

/** Make a backup if the newest one is older than the interval. Never throws. */
function maybe_backup(): void
{
    try {
        if (!backup_enabled()) {
            return;
        }
        $dir = backup_dir();
        if (!backup_due($dir)) {
            return;
        }
        if (!is_dir($dir) && !@mkdir($dir, 0755)) {
            throw new RuntimeException("Ordner $dir kann nicht angelegt werden");
        }
        $lock = fopen($dir . '/.lock', 'c+');
        if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
            return; // another request is making the backup right now
        }
        try {
            $lastAttempt = (int) stream_get_contents($lock);
            if (!backup_due($dir) || time() - $lastAttempt < BACKUP_RETRY_SECONDS) {
                return;
            }
            ftruncate($lock, 0);
            rewind($lock);
            fwrite($lock, (string) time());
            fflush($lock);
            write_backup($dir);
            foreach (array_slice(backup_files($dir), backup_keep()) as $old) {
                @unlink($old);
            }
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    } catch (Throwable $e) {
        error_log('homeoffice-rechner backup: ' . $e->getMessage());
    }
}

function backup_due(string $dir): bool
{
    $files = backup_files($dir);
    return !$files || time() - (int) filemtime($files[0]) >= backup_days() * 86400;
}

function write_backup(string $dir): void
{
    if (!is_file($dir . '/.htaccess')) {
        // same protection as data/.htaccess, in case that one does not cover subfolders
        @file_put_contents($dir . '/.htaccess', "<IfModule mod_authz_core.c>\n    Require all denied\n</IfModule>\n"
            . "<IfModule !mod_authz_core.c>\n    Order allow,deny\n    Deny from all\n</IfModule>\n");
    }
    $target = $dir . '/sicherung-' . date('Y-m-d-His') . '-' . bin2hex(random_bytes(4)) . '.sqlite';
    $temp = $target . '.tmp';
    $pdo = db();
    try {
        // A consistent, compact copy (SQLite 3.27 or newer) ...
        $pdo->exec('VACUUM INTO ' . $pdo->quote($temp));
    } catch (PDOException $e) {
        // ... or, on older SQLite, a plain file copy while writers are locked out.
        @unlink($temp);
        $pdo->exec('BEGIN IMMEDIATE');
        try {
            $copied = copy((string) config('db')['path'], $temp);
        } finally {
            $pdo->exec('ROLLBACK');
        }
        if (!$copied) {
            throw new RuntimeException('Die Datenbank konnte nicht kopiert werden');
        }
    }
    if (!is_file($temp) || filesize($temp) === 0 || !rename($temp, $target)) {
        @unlink($temp);
        throw new RuntimeException('Die Sicherung wurde nicht geschrieben');
    }
}

/** For the admin overview. */
function backup_status(): array
{
    if (!backup_enabled()) {
        return ['enabled' => false];
    }
    $files = backup_files(backup_dir());
    return ['enabled' => true, 'days' => backup_days(), 'keep' => backup_keep(), 'count' => count($files),
        'last' => $files ? date('Y-m-d H:i', (int) filemtime($files[0])) : null];
}
