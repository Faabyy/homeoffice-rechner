<?php
declare(strict_types=1);

// JSON API for the frontend: api.php?action=<name>. Reads are GET, every change is POST
// with a JSON body (a cross-site form cannot send that, which together with the SameSite
// cookie protects against CSRF).

require __DIR__ . '/lib/bootstrap.php';

security_headers();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
if (extension_loaded('zlib') && !ini_get('zlib.output_compression')) {
    ob_start('ob_gzhandler'); // the whole data set is sent at once; JSON compresses well
}

try {
    if (!https_ok()) {
        throw new UserError('Bitte die App über https:// aufrufen.', 403);
    }
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $body = [];
    if ($method === 'POST') {
        check_request_origin();
        $body = read_json_body();
    } elseif ($method !== 'GET') {
        throw new UserError('Methode nicht erlaubt.', 405);
    }
    $result = handle_api($method, (string) ($_GET['action'] ?? ''), $body);
    echo json_encode($result, JSON_UNESCAPED_UNICODE);
} catch (UserError $e) {
    http_response_code($e->status);
    echo json_encode(['error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    error_log('homeoffice-rechner: ' . $e);
    http_response_code(500);
    echo json_encode(['error' => 'Interner Fehler. Bitte später erneut versuchen.'], JSON_UNESCAPED_UNICODE);
}

function check_request_origin(): void
{
    $type = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
    if ($type !== 'application/json') {
        throw new UserError('JSON erwartet.', 415);
    }
    $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
    $expected = (is_https() ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? '');
    if ($origin !== '' && $origin !== $expected) {
        throw new UserError('Anfrage von fremder Seite abgelehnt.', 403);
    }
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) {
        return [];
    }
    if (strlen($raw) > 5 * 1024 * 1024) {
        throw new UserError('Die Anfrage ist zu groß.', 413);
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        throw new UserError('Ungültiges JSON.');
    }
    return $data;
}

function str_field(array $body, string $key): string
{
    $value = $body[$key] ?? '';
    return is_string($value) ? $value : '';
}

/** @return mixed */
function handle_api(string $method, string $action, array $body)
{
    // ---- without login ----
    if ($method === 'POST' && $action === 'login') {
        return ['user' => login(str_field($body, 'username'), str_field($body, 'password'))];
    }
    if ($method === 'GET' && $action === 'link') {
        $info = link_info((string) ($_GET['token'] ?? ''));
        if (!$info) {
            throw new UserError('Der Link ist ungültig oder abgelaufen. Bitte einen neuen Link anfordern.', 404);
        }
        return $info;
    }
    if ($method === 'POST' && $action === 'redeem') {
        return ['user' => redeem_link(str_field($body, 'token'), str_field($body, 'password'))];
    }
    if ($method === 'POST' && $action === 'logout') {
        end_session();
        return ['ok' => true];
    }

    // ---- logged in ----
    $user = current_user();
    if (!$user) {
        throw new UserError('Bitte melde dich an.', 401);
    }
    $uid = $user['id'];
    switch ("$method $action") {
        case 'GET me':
            maybe_backup(); // once per app start is plenty for a backup every few days
            return ['user' => $user] + account_info($uid)
                + ($user['isAdmin'] ? ['newFeedback' => new_feedback_count()] : []);
        case 'POST feedback':
            save_feedback($user, $body);
            return ['feedback' => my_feedback($uid)];
        case 'POST feedback-seen':
            mark_feedback_seen($uid, $body['ids'] ?? null);
            return ['ok' => true];
        case 'GET my-feedback':
            return ['feedback' => my_feedback($uid)];
        case 'POST password':
            change_password($user, str_field($body, 'current'), str_field($body, 'new'));
            return ['ok' => true];
    }

    // ---- read-only accounts: only see the data of the accounts assigned to them ----
    if ($user['isViewer']) {
        switch ("$method $action") {
            case 'GET shared':
                return ['accounts' => viewable_accounts($uid)];
            case 'GET shared-data':
                $owner = (int) ($_GET['owner'] ?? 0);
                if (!can_view($uid, $owner)) {
                    throw new UserError('Du hast keinen Zugriff auf dieses Konto.', 403);
                }
                return load_user_data($owner);
        }
        throw new UserError('Dieses Konto kann nur freigegebene Daten ansehen.', 403);
    }

    switch ("$method $action") {
        case 'GET data':
            return load_user_data($uid) + ['viewers' => viewers_of($uid)];
        case 'POST entry':
            return ['entry' => save_entry($uid, $body)];
        case 'POST delete-entry':
            delete_entry($uid, $body['id'] ?? null);
            return ['ok' => true];
        case 'POST flex':
            return ['flex' => add_flex($uid, $body)];
        case 'POST delete-flex':
            delete_flex($uid, $body['id'] ?? null);
            return ['ok' => true];
        case 'POST plan':
            set_plan($uid, $body['day'] ?? null, $body['status'] ?? null);
            return ['ok' => true];
        case 'POST settings':
            return ['settings' => save_settings($uid, $body)];
        case 'POST import':
            import_data($uid, $body);
            return load_user_data($uid) + ['viewers' => viewers_of($uid)];
    }

    // ---- administrators ----
    if (strpos($action, 'admin-') === 0) {
        if (!$user['isAdmin']) {
            throw new UserError('Nur für Administratoren.', 403);
        }
        $id = (int) ($method === 'GET' ? ($_GET['id'] ?? 0) : ($body['id'] ?? 0));
        switch ("$method $action") {
            case 'GET admin-overview':
                return admin_overview();
            case 'GET admin-export':
                return admin_export($user, $id);
            case 'POST admin-invite':
                return ['link' => admin_invite($user, str_field($body, 'username'), ($body['isAdmin'] ?? false) === true,
                    ($body['isViewer'] ?? false) === true)];
            case 'POST admin-reset':
                return ['link' => admin_reset_link($user, str_field($body, 'username'))];
            case 'POST admin-revoke':
                admin_revoke_link($user, $id);
                return ['ok' => true];
            case 'POST admin-role':
                admin_set_role($user, $id, $body['role'] ?? null);
                return ['ok' => true];
            case 'POST admin-username':
                admin_set_username($user, $id, str_field($body, 'username'));
                return ['ok' => true];
            case 'POST admin-lock':
                admin_set_locked($user, $id, $body['locked'] ?? null);
                return ['ok' => true];
            case 'POST admin-logout':
                return ['count' => admin_logout_everywhere($user, $id)];
            case 'POST admin-viewer-access':
                set_viewer_access($user, $id, $body['canView'] ?? null);
                return ['ok' => true];
            case 'POST admin-owner-access':
                set_owner_access($user, $id, $body['viewers'] ?? null);
                return ['ok' => true];
            case 'POST admin-feedback-status':
                update_feedback($id, $body['status'] ?? null, $body['reply'] ?? null);
                return ['newFeedback' => new_feedback_count()];
            case 'POST admin-feedback-delete':
                delete_feedback($id);
                return ['newFeedback' => new_feedback_count()];
            case 'POST admin-delete-user':
                admin_delete_user($user, $id);
                return ['ok' => true];
        }
    }
    throw new UserError('Unbekannte Aktion.', 404);
}
