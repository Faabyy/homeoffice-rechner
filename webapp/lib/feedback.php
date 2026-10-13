<?php
declare(strict_types=1);

// Suggestions and bug reports that users write in the app (Einstellungen → Rückmeldung).
// Admins read them in the Benutzer tab; the number of new ones is shown at that tab.

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

/** Number of reports nobody has opened yet. */
function new_feedback_count(): int
{
    return (int) db_row("SELECT COUNT(*) AS n FROM feedback WHERE status = 'new'")['n'];
}

/** The newest reports for the Benutzer tab. */
function feedback_list(): array
{
    return array_map(function ($r) {
        return ['id' => (int) $r['id'], 'at' => date('Y-m-d H:i', (int) $r['created_at']), 'username' => $r['username'],
            'kind' => $r['kind'], 'message' => $r['message'], 'page' => $r['page'], 'agent' => $r['agent'], 'status' => $r['status']];
    }, db_rows('SELECT * FROM feedback ORDER BY id DESC LIMIT ' . FEEDBACK_LIST_LIMIT));
}

function feedback_target(int $id): void
{
    if (db_row('SELECT 1 AS ok FROM feedback WHERE id = ?', [$id]) === null) {
        throw new UserError('Diese Rückmeldung gibt es nicht mehr.', 404);
    }
}

/** Mark a report as new, read or done. */
function set_feedback_status(int $id, $status): void
{
    if (!is_string($status) || !in_array($status, FEEDBACK_STATUSES, true)) {
        throw new UserError('Ungültiger Status.');
    }
    feedback_target($id);
    db_exec('UPDATE feedback SET status = ? WHERE id = ?', [$status, $id]);
}

function delete_feedback(int $id): void
{
    feedback_target($id);
    db_exec('DELETE FROM feedback WHERE id = ?', [$id]);
}
