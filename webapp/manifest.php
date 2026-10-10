<?php
declare(strict_types=1);

// Web app manifest of the installable app. It is generated because Android takes the splash
// screen and the system bars (status/navigation bar) of the installed app from the manifest
// colours; design.js stores the chosen design and colour scheme in the cookie `look`
// ("<design>-<light|dark>"), and the colours here follow it. Android applies a changed manifest
// only when it updates the installed app (about once a day, or after reinstalling it).
// The colours are the page backgrounds in design.js (PAGE_COLORS): keep them in sync.

const LOOK_COLORS = [
    'modern' => ['light' => '#ffffff', 'dark' => '#16181d'],
    'klassisch' => ['light' => '#e2ddd2', 'dark' => '#0c0f13'],
    'warm' => ['light' => '#f5f3ec', 'dark' => '#1c1b1a'],
];

$design = 'modern';
$scheme = 'light';
if (preg_match('/^([a-z]+)-(light|dark)$/', (string) ($_COOKIE['look'] ?? ''), $m) && isset(LOOK_COLORS[$m[1]])) {
    [, $design, $scheme] = $m;
}
$color = LOOK_COLORS[$design][$scheme];

header('Content-Type: application/manifest+json; charset=utf-8');
header('Cache-Control: no-cache');
header('Vary: Cookie');
header('X-Content-Type-Options: nosniff');
echo json_encode([
    'name' => 'Homeoffice-Rechner',
    'short_name' => 'Homeoffice',
    'description' => 'Homeoffice- und Bürotage planen und erfassen',
    'lang' => 'de',
    'id' => './',
    'start_url' => './',
    'scope' => './',
    'display' => 'standalone',
    'background_color' => $color,
    'theme_color' => $color,
    'icons' => [
        ['src' => 'assets/icons/icon-192.png', 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any'],
        ['src' => 'assets/icons/icon-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any'],
        ['src' => 'assets/icons/icon-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable'],
    ],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n";
