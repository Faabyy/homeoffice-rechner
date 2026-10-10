<?php
declare(strict_types=1);

// Per-user data: settings, time entries and the day plan.
// All calculation (forecast, holidays, prefill) happens in assets/logic.js; the server
// only validates and stores, so stored data stays consistent no matter what a client sends.

const LOCATIONS = ['homeoffice', 'buero'];
// 'frei', 'schule' (Berufsschule/Studium), 'krank' and 'urlaub' all mean a day off; they only look different.
const PLAN_STATUSES = ['homeoffice', 'buero', 'frei', 'schule', 'krank', 'urlaub'];
const STATES = ['BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH'];

function default_settings(): array
{
    return ['workdays' => [0, 1, 2, 3, 4], 'schoolDays' => [], 'homeOfficeDays' => [], 'officeDays' => [],
        'dailyMinutes' => 480, 'limitPercent' => 30,
        'state' => null, 'defaultStart' => '08:00', 'defaultBreak' => 30];
}

function valid_day($value): string
{
    if (!is_string($value) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m)
        || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
        throw new UserError('Ungültiges Datum.');
    }
    return $value;
}

function valid_time($value, string $label): string
{
    if (!is_string($value) || !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $value)) {
        throw new UserError("$label ist keine gültige Uhrzeit.");
    }
    return $value;
}

function minutes_of(string $time): int
{
    return (int) substr($time, 0, 2) * 60 + (int) substr($time, 3, 2);
}

function valid_int($value, int $min, int $max, string $message): int
{
    if (!is_int($value) && !(is_float($value) && floor($value) === $value)) {
        throw new UserError($message);
    }
    $value = (int) $value;
    if ($value < $min || $value > $max) {
        throw new UserError($message);
    }
    return $value;
}

function validate_settings($s): array
{
    if (!is_array($s)) {
        throw new UserError('Ungültige Einstellungen.');
    }
    $workdays = $s['workdays'] ?? null;
    if (!is_array($workdays) || count($workdays) === 0) {
        throw new UserError('Mindestens ein Wochentag muss Arbeitstag sein.');
    }
    $days = [];
    foreach ($workdays as $d) {
        $days[] = valid_int($d, 0, 6, 'Ungültige Arbeitstage.');
    }
    $days = array_values(array_unique($days));
    sort($days);
    // optional: settings saved before Berufsschultage existed don't have it
    $school = optional_weekdays($s, 'schoolDays', 'Ungültige Berufsschultage.');
    if (array_intersect($days, $school)) {
        throw new UserError('Ein Wochentag kann nicht zugleich Arbeitstag und Berufsschultag sein.');
    }
    // optional as well: workdays planned as Homeoffice/Büro by default
    $homeOffice = optional_weekdays($s, 'homeOfficeDays', 'Ungültige Homeoffice-Tage.');
    $office = optional_weekdays($s, 'officeDays', 'Ungültige Bürotage.');
    if (array_intersect($homeOffice, $office) || array_diff(array_merge($homeOffice, $office), $days)) {
        throw new UserError('Homeoffice- und Bürotage müssen Arbeitstage sein und dürfen sich nicht überschneiden.');
    }
    $limit = $s['limitPercent'] ?? null;
    if (!is_int($limit) && !is_float($limit) || $limit < 0 || $limit > 100) {
        throw new UserError('Das Limit muss zwischen 0 und 100 % liegen.');
    }
    $state = $s['state'] ?? null;
    if ($state !== null && !in_array($state, STATES, true)) {
        throw new UserError('Unbekanntes Bundesland.');
    }
    return [
        'workdays' => $days,
        'schoolDays' => $school,
        'homeOfficeDays' => $homeOffice,
        'officeDays' => $office,
        'dailyMinutes' => valid_int($s['dailyMinutes'] ?? null, 1, 1440,
            'Die Sollstunden pro Tag müssen zwischen 0:01 und 24:00 liegen.'),
        'limitPercent' => $limit + 0,
        'state' => $state,
        'defaultStart' => valid_time($s['defaultStart'] ?? null, 'Der Standard-Beginn'),
        'defaultBreak' => valid_int($s['defaultBreak'] ?? null, 0, 1440, 'Ungültige Standard-Pause.'),
    ];
}

/** Sorted, distinct weekday numbers of an optional settings field (missing = none). */
function optional_weekdays(array $s, string $key, string $message): array
{
    $days = [];
    foreach (is_array($s[$key] ?? null) ? $s[$key] : [] as $d) {
        $days[] = valid_int($d, 0, 6, $message);
    }
    $days = array_values(array_unique($days));
    sort($days);
    return $days;
}

function validate_entry($e): array
{
    if (!is_array($e)) {
        throw new UserError('Ungültiger Eintrag.');
    }
    $entry = [
        'day' => valid_day($e['day'] ?? null),
        'start' => valid_time($e['start'] ?? null, 'Der Beginn'),
        'end' => valid_time($e['end'] ?? null, 'Das Ende'),
        'break' => valid_int($e['break'] ?? null, 0, 1440, 'Ungültige Pause.'),
        'location' => $e['location'] ?? null,
    ];
    if (!in_array($entry['location'], LOCATIONS, true)) {
        throw new UserError('Bitte Homeoffice oder Büro wählen.');
    }
    $span = minutes_of($entry['end']) - minutes_of($entry['start']);
    if ($span <= 0) {
        throw new UserError('Das Ende muss nach dem Beginn liegen.');
    }
    if ($span - $entry['break'] <= 0) {
        throw new UserError('Die Pause ist länger als die Arbeitszeit.');
    }
    return $entry;
}

function entry_from_row(array $r): array
{
    return ['id' => $r['id'], 'day' => $r['day'], 'start' => $r['start_time'], 'end' => $r['end_time'],
        'break' => (int) $r['break_minutes'], 'location' => $r['location']];
}

function load_user_data(int $userId): array
{
    $row = db_row('SELECT settings FROM users WHERE id = ?', [$userId]);
    // Merge with the defaults so settings saved by an older version get newer fields.
    $settings = array_merge(default_settings(), $row && $row['settings'] ? json_decode($row['settings'], true) : []);
    $entries = array_map('entry_from_row',
        db_rows('SELECT * FROM entries WHERE user_id = ? ORDER BY day, start_time', [$userId]));
    $plan = [];
    foreach (db_rows('SELECT day, status FROM plan WHERE user_id = ?', [$userId]) as $r) {
        $plan[$r['day']] = $r['status'];
    }
    $flex = array_map('flex_from_row',
        db_rows('SELECT * FROM flex_adjustments WHERE user_id = ? ORDER BY day, id', [$userId]));
    return ['settings' => $settings, 'entries' => $entries, 'plan' => (object) $plan, 'flex' => $flex];
}

// ---- flextime corrections ---------------------------------------------------------------

function flex_from_row(array $r): array
{
    return ['id' => $r['id'], 'day' => $r['day'], 'minutes' => (int) $r['minutes'], 'note' => $r['note']];
}

function validate_flex($f): array
{
    if (!is_array($f)) {
        throw new UserError('Ungültige Korrektur.');
    }
    $minutes = valid_int($f['minutes'] ?? null, -100000, 100000, 'Ungültige Korrektur.');
    if ($minutes === 0) {
        throw new UserError('Die Korrektur darf nicht 0:00 sein.');
    }
    $note = $f['note'] ?? '';
    if (!is_string($note) || preg_match_all('/./us', $note) > 200) {
        throw new UserError('Die Notiz darf höchstens 200 Zeichen lang sein.');
    }
    return ['day' => valid_day($f['day'] ?? null), 'minutes' => $minutes, 'note' => trim($note)];
}

function insert_flex(int $userId, string $id, array $flex): void
{
    db_exec('INSERT INTO flex_adjustments (id, user_id, day, minutes, note) VALUES (?, ?, ?, ?, ?)',
        [$id, $userId, $flex['day'], $flex['minutes'], $flex['note']]);
}

function add_flex(int $userId, $input): array
{
    $flex = validate_flex($input);
    $id = bin2hex(random_bytes(16));
    insert_flex($userId, $id, $flex);
    return ['id' => $id] + $flex;
}

function delete_flex(int $userId, $id): void
{
    if (!is_string($id)) {
        throw new UserError('Ungültige Korrektur.');
    }
    db_exec('DELETE FROM flex_adjustments WHERE id = ? AND user_id = ?', [$id, $userId]);
}

function check_overlap(int $userId, array $entry, string $ignoreId): void
{
    // HH:MM strings compare like times.
    $clash = db_row(
        'SELECT start_time, end_time FROM entries
         WHERE user_id = ? AND day = ? AND id <> ? AND start_time < ? AND end_time > ?',
        [$userId, $entry['day'], $ignoreId, $entry['end'], $entry['start']]
    );
    if ($clash) {
        [$y, $m, $d] = explode('-', $entry['day']);
        throw new UserError("Der Eintrag überschneidet sich mit {$clash['start_time']}–{$clash['end_time']} am $d.$m.$y.");
    }
}

/** Insert (no id) or update (id of an own entry) a time entry. */
function save_entry(int $userId, $input): array
{
    return tx(function () use ($userId, $input) {
        $entry = validate_entry($input);
        $id = is_array($input) ? ($input['id'] ?? null) : null;
        if ($id !== null) {
            if (!is_string($id) || !db_row('SELECT id FROM entries WHERE id = ? AND user_id = ?', [$id, $userId])) {
                throw new UserError('Der Eintrag existiert nicht mehr.');
            }
            check_overlap($userId, $entry, $id);
            db_exec('UPDATE entries SET day = ?, start_time = ?, end_time = ?, break_minutes = ?, location = ?
                     WHERE id = ? AND user_id = ?',
                [$entry['day'], $entry['start'], $entry['end'], $entry['break'], $entry['location'], $id, $userId]);
        } else {
            $id = bin2hex(random_bytes(16));
            check_overlap($userId, $entry, $id);
            insert_entry($userId, $id, $entry);
        }
        return ['id' => $id] + $entry;
    });
}

function insert_entry(int $userId, string $id, array $entry): void
{
    db_exec('INSERT INTO entries (id, user_id, day, start_time, end_time, break_minutes, location)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$id, $userId, $entry['day'], $entry['start'], $entry['end'], $entry['break'], $entry['location']]);
}

function delete_entry(int $userId, $id): void
{
    if (!is_string($id)) {
        throw new UserError('Ungültiger Eintrag.');
    }
    db_exec('DELETE FROM entries WHERE id = ? AND user_id = ?', [$id, $userId]);
}

function set_plan(int $userId, $day, $status): void
{
    $day = valid_day($day);
    if ($status !== null && !in_array($status, PLAN_STATUSES, true)) {
        throw new UserError('Unbekannter Planungsstatus.');
    }
    tx(function () use ($userId, $day, $status) {
        db_exec('DELETE FROM plan WHERE user_id = ? AND day = ?', [$userId, $day]);
        if ($status !== null) {
            db_exec('INSERT INTO plan (user_id, day, status) VALUES (?, ?, ?)', [$userId, $day, $status]);
        }
    });
}

function save_settings(int $userId, $settings): array
{
    $settings = validate_settings($settings);
    db_exec('UPDATE users SET settings = ? WHERE id = ?', [json_encode($settings), $userId]);
    return $settings;
}

/** Replace all of a user's data (import of an export file). Validates everything first. */
function import_data(int $userId, $payload): void
{
    if (!is_array($payload) || !is_array($payload['entries'] ?? null) || !is_array($payload['plan'] ?? null)) {
        throw new UserError('Die Datei enthält keine gültigen Daten.');
    }
    $settings = validate_settings($payload['settings'] ?? null);
    $entries = array_map('validate_entry', $payload['entries']);
    usort($entries, function ($a, $b) {
        return [$a['day'], $a['start']] <=> [$b['day'], $b['start']];
    });
    for ($i = 1; $i < count($entries); $i++) {
        $prev = $entries[$i - 1];
        if ($prev['day'] === $entries[$i]['day'] && $entries[$i]['start'] < $prev['end']) {
            throw new UserError("Die Datei enthält sich überschneidende Einträge am {$prev['day']}.");
        }
    }
    $plan = [];
    foreach ($payload['plan'] as $day => $status) {
        $plan[valid_day((string) $day)] = $status;
        if (!in_array($status, PLAN_STATUSES, true)) {
            throw new UserError('Die Datei enthält einen unbekannten Planungsstatus.');
        }
    }
    $flex = array_map('validate_flex', is_array($payload['flex'] ?? null) ? $payload['flex'] : []);
    tx(function () use ($userId, $settings, $entries, $plan, $flex) {
        db_exec('DELETE FROM entries WHERE user_id = ?', [$userId]);
        db_exec('DELETE FROM plan WHERE user_id = ?', [$userId]);
        db_exec('DELETE FROM flex_adjustments WHERE user_id = ?', [$userId]);
        db_exec('UPDATE users SET settings = ? WHERE id = ?', [json_encode($settings), $userId]);
        db_insert_many('flex_adjustments', ['id', 'user_id', 'day', 'minutes', 'note'],
            array_map(function ($f) use ($userId) {
                return [bin2hex(random_bytes(16)), $userId, $f['day'], $f['minutes'], $f['note']];
            }, $flex));
        db_insert_many('entries', ['id', 'user_id', 'day', 'start_time', 'end_time', 'break_minutes', 'location'],
            array_map(function ($e) use ($userId) {
                return [bin2hex(random_bytes(16)), $userId, $e['day'], $e['start'], $e['end'], $e['break'], $e['location']];
            }, $entries));
        $planRows = [];
        foreach ($plan as $day => $status) {
            $planRows[] = [$userId, $day, $status];
        }
        db_insert_many('plan', ['user_id', 'day', 'status'], $planRows);
    });
}
