<?php
declare(strict_types=1);

// Shared setup for every PHP entry point (api.php, index.php, login.php, setup.php).
// Must stay compatible with PHP 7.4: no match, no str_contains, no nullsafe operator.

ini_set('display_errors', '0');
error_reporting(E_ALL);
date_default_timezone_set('Europe/Berlin');

$configFile = getenv('HOR_CONFIG') ?: __DIR__ . '/config.php';
if (!is_file($configFile)) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Die Konfiguration fehlt: lib/config.php (Vorlage: lib/config.sample.php).\n";
    exit;
}
$GLOBALS['HOR_CONFIG'] = require $configFile;

require __DIR__ . '/db.php';
require __DIR__ . '/auth.php';
require __DIR__ . '/admin.php';
require __DIR__ . '/data.php';
require __DIR__ . '/backup.php';
require __DIR__ . '/feedback.php';

/** An error whose message is shown to the user as-is (so it is written in German). */
class UserError extends Exception
{
    /** @var int */
    public $status;

    public function __construct(string $message, int $status = 400)
    {
        parent::__construct($message);
        $this->status = $status;
    }
}

/** @return mixed */
function config(string $key)
{
    return $GLOBALS['HOR_CONFIG'][$key] ?? null;
}

function is_https(): bool
{
    if (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') {
        return true;
    }
    if (strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https') {
        return true;
    }
    return (string) ($_SERVER['SERVER_PORT'] ?? '') === '443';
}

/** URL path of the app directory with trailing slash, e.g. "/" or "/homeoffice/". */
function base_path(): string
{
    $dir = str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/')));
    return rtrim($dir, '/') . '/';
}

function base_url(): string
{
    $host = (string) ($_SERVER['HTTP_HOST'] ?? 'localhost');
    return (is_https() ? 'https://' : 'http://') . $host . base_path();
}

function security_headers(): void
{
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer'); // invitation links carry a token in the URL
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; "
        . "img-src 'self' data:; connect-src 'self' https://openholidaysapi.org; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (is_https()) {
        header('Strict-Transport-Security: max-age=31536000');
    }
}

/** Plain http is only acceptable for local development (config require_https = false). */
function https_ok(): bool
{
    return is_https() || config('require_https') === false;
}

/**
 * Output an HTML template from lib/. Asset URLs get the file's modification time as version
 * (assets/app.js?v=…), so browsers load new scripts and styles right after an update instead
 * of combining a new page with old cached files.
 */
function send_page(string $template): void
{
    $html = (string) file_get_contents(__DIR__ . '/' . $template);
    echo preg_replace_callback('#"assets/([\w.-]+\.(?:js|css))"#', function ($m) {
        $file = __DIR__ . '/../assets/' . $m[1];
        return '"assets/' . $m[1] . (is_file($file) ? '?v=' . filemtime($file) : '') . '"';
    }, $html);
}

function h(string $text): string
{
    return htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
}
