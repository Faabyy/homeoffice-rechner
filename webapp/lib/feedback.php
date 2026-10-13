<?php
declare(strict_types=1);

// Suggestions and bug reports that users write in the app (Einstellungen → Rückmeldung).
// Admins read them in the Verwaltung tab; the number of new ones is shown at that tab.

const FEEDBACK_KINDS = ['idea', 'bug'];
const FEEDBACK_STATUSES = ['new', 'read', 'done'];
const FEEDBACK_MAX_CHARS = 2000;
const FEEDBACK_PER_HOUR = 5;
const FEEDBACK_LIST_LIMIT = 200;
// tabs of the app a report can come from (app.js TABS)
const FEEDBACK_PAGES = ['planung', 'zeiterfassung', 'einstellungen', 'benutzer'];

function char_count(string $text): int
{
    return (int) preg_match_all('/./su', $text);
}

/** Store a report from the logged-in user. */
function save_feedback(array $user, array $body): void
{
    $kind = $body['kind'] ?? null;
    if (!is_string($kind) || !in_array($kind, FEEDBACK_KINDS, true)) {
        throw new UserError('Bitte wähle Vorschlag oder Fehler.');
    }
    $message = trim(str_field($body, 'message'));
    if (!preg_match('//u', $message) || char_count($message) < 5) {
        throw new UserError('Bitte beschreibe kurz, worum es geht.');
    }
    if (char_count($message) > FEEDBACK_MAX_CHARS) {
        throw new UserError('Der Text ist zu lang (höchstens ' . FEEDBACK_MAX_CHARS . ' Zeichen).');
    }
    $recent = db_row('SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND created_at > ?', [$user['id'], time() - 3600]);
    if ((int) $recent['n'] >= FEEDBACK_PER_HOUR) {
        throw new UserError('Du hast gerade mehrere Rückmeldungen geschickt. Bitte versuche es in einer Stunde erneut.', 429);
    }
    $page = $body['page'] ?? '';
    $page = is_string($page) && in_array($page, FEEDBACK_PAGES, true) ? $page : '';
    $agent = substr(preg_replace('/[^\x20-\x7e]/', '', (string) ($_SERVER['HTTP_USER_AGENT'] ?? '')), 0, 250);
    db_exec('INSERT INTO feedback (user_id, username, created_at, kind, message, page, agent, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [$user['id'], $user['username'], time(), $kind, $message, $page, $agent, 'new']);
}

/** The user's own reports with status, reply and whether the latest news about them is still unseen. */
function my_feedback(int $userId): array
{
    return array_map(function ($r) {
        return ['id' => (int) $r['id'], 'at' => date('Y-m-d H:i', (int) $r['created_at']), 'kind' => $r['kind'],
            'message' => $r['message'], 'status' => $r['status'], 'reply' => $r['reply'],
            'updatedAt' => feedback_update_time($r), 'notify' => (int) $r['notify'] === 1];
    }, db_rows('SELECT * FROM feedback WHERE user_id = ? ORDER BY id DESC LIMIT ' . FEEDBACK_LIST_LIMIT, [$userId]));
}

/** When the sender last got news (reply or done), formatted, or null. */
function feedback_update_time(array $row): ?string
{
    $time = max((int) ($row['replied_at'] ?? 0), (int) ($row['done_at'] ?? 0));
    return $time > 0 ? date('Y-m-d H:i', $time) : null;
}

/** The sender has seen the news about these reports (the "Neuigkeiten" dialog was closed). */
function mark_feedback_seen(int $userId, $ids): void
{
    if (!is_array($ids) || count($ids) === 0 || count($ids) > FEEDBACK_LIST_LIMIT) {
        return;
    }
    $ids = array_values(array_filter($ids, 'is_int'));
    if (!$ids) {
        return;
    }
    $marks = implode(', ', array_fill(0, count($ids), '?'));
    db_exec("UPDATE feedback SET notify = 0 WHERE user_id = ? AND id IN ($marks)", array_merge([$userId], $ids));
}

/** Number of reports nobody has opened yet. */
function new_feedback_count(): int
{
    return (int) db_row("SELECT COUNT(*) AS n FROM feedback WHERE status = 'new'")['n'];
}

/** The newest reports for the Verwaltung tab. */
function feedback_list(): array
{
    return array_map(function ($r) {
        return ['id' => (int) $r['id'], 'at' => date('Y-m-d H:i', (int) $r['created_at']), 'username' => $r['username'],
            'kind' => $r['kind'], 'message' => $r['message'], 'page' => $r['page'], 'agent' => $r['agent'], 'status' => $r['status'],
            'reply' => $r['reply'], 'repliedAt' => $r['replied_at'] === null ? null : date('Y-m-d H:i', (int) $r['replied_at'])];
    }, db_rows('SELECT * FROM feedback ORDER BY id DESC LIMIT ' . FEEDBACK_LIST_LIMIT));
}

function feedback_target(int $id): void
{
    if (db_row('SELECT 1 AS ok FROM feedback WHERE id = ?', [$id]) === null) {
        throw new UserError('Diese Rückmeldung gibt es nicht mehr.', 404);
    }
}

/**
 * An admin changes the status of a report and/or answers it. A reply or "done" notifies the
 * sender (notify = 1) until the news dialog was shown. Both parameters are optional (null).
 * @param mixed $status
 * @param mixed $reply
 */
function update_feedback(int $id, $status, $reply): void
{
    if ($status === null && $reply === null) {
        throw new UserError('Nichts zu ändern.');
    }
    if ($status !== null && (!is_string($status) || !in_array($status, FEEDBACK_STATUSES, true))) {
        throw new UserError('Ungültiger Status.');
    }
    if ($reply !== null) {
        $reply = is_string($reply) ? trim($reply) : '';
        if (!preg_match('//u', $reply) || char_count($reply) > FEEDBACK_MAX_CHARS) {
            throw new UserError('Die Antwort ist zu lang (höchstens ' . FEEDBACK_MAX_CHARS . ' Zeichen).');
        }
    }
    $row = db_row('SELECT status FROM feedback WHERE id = ?', [$id]);
    if ($row === null) {
        throw new UserError('Diese Rückmeldung gibt es nicht mehr.', 404);
    }
    $now = time();
    $sets = [];
    $params = [];
    if ($reply !== null) {
        $sets[] = 'reply = ?, replied_at = ?';
        $params[] = $reply === '' ? null : $reply;
        $params[] = $reply === '' ? null : $now;
        if ($reply !== '') {
            $sets[] = 'notify = 1';
            if ($status === null && $row['status'] === 'new') {
                $status = 'read'; // answering it means somebody has read it
            }
        }
    }
    if ($status !== null) {
        $sets[] = $status === 'done' ? 'status = ?, done_at = ?, notify = 1' : 'status = ?, done_at = ?';
        $params[] = $status;
        $params[] = $status === 'done' ? $now : null;
    }
    $params[] = $id;
    db_exec('UPDATE feedback SET ' . implode(', ', $sets) . ' WHERE id = ?', $params);
}

function delete_feedback(int $id): void
{
    feedback_target($id);
    db_exec('DELETE FROM feedback WHERE id = ?', [$id]);
}
