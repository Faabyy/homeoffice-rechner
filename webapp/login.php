<?php
declare(strict_types=1);

// Login, plus setting a password from an invitation or reset link (login.php?token=...).
require __DIR__ . '/lib/bootstrap.php';

if (!https_ok()) {
    header('Location: https://' . ($_SERVER['HTTP_HOST'] ?? '') . ($_SERVER['REQUEST_URI'] ?? '/'));
    exit;
}
if (in_blocked_network()) {
    // Blocked networks don't even get the login page (mobile_only, by contrast, still shows it).
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo BLOCKED_NETWORK_MESSAGE;
    exit;
}
if (!isset($_GET['token']) && current_user()) {
    header('Location: ' . base_path());
    exit;
}
security_headers();
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
send_page('login.html');
