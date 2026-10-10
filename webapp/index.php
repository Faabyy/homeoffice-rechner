<?php
declare(strict_types=1);

// The app itself; only for logged-in users.
require __DIR__ . '/lib/bootstrap.php';

if (!https_ok()) {
    header('Location: https://' . ($_SERVER['HTTP_HOST'] ?? '') . ($_SERVER['REQUEST_URI'] ?? '/'));
    exit;
}
if (!current_user()) {
    header('Location: ' . base_path() . 'login.php');
    exit;
}
security_headers();
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
send_page('app.html');
