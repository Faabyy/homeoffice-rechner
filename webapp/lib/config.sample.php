<?php
// Vorlage für lib/config.php.

return [
    // SQLite: die Datenbank ist eine Datei im Ordner data/ (keine Einrichtung nötig).
    // Ein zufälliger Dateiname schützt zusätzlich, falls die .htaccess einmal nicht greift.
    'db' => [
        'driver' => 'sqlite',
        'path' => __DIR__ . '/../data/homeoffice-ZUFALL.sqlite',
    ],
    // Alternativ MySQL (Zugangsdaten aus dem Kundenmenü des Hosters):
    // 'db' => [
    //     'driver' => 'mysql',
    //     'host' => 'localhost',
    //     'name' => 'datenbankname',
    //     'user' => 'benutzer',
    //     'password' => 'passwort',
    // ],

    // Automatische Sicherung der SQLite-Datenbank nach data/backups/ (optional):
    // alle 'backup_days' Tage (Standard 7, 0 = aus), die neuesten 'backup_keep' bleiben (Standard 8).
    // 'backup_days' => 7,
    // 'backup_keep' => 8,

    // Nur für die lokale Entwicklung auf false setzen.
    'require_https' => true,

    // Schlüssel für setup.php (mindestens 16 Zeichen, zufällig).
    'setup_key' => 'HIER-EINEN-LANGEN-ZUFAELLIGEN-SCHLUESSEL-EINTRAGEN',

    // Zugriff für normale Benutzer einschränken (Administratoren sind ausgenommen):
    // blocked_networks: IP-Adressen oder Netze (CIDR, z. B. '203.0.113.0/24'), z. B. Firmennetz/VPN.
    // mobile_only: nur Handy-/Tablet-Browser zulassen (iPads im Desktop-Modus gelten nicht als mobil).
    'access' => [
        'blocked_networks' => [],
        'mobile_only' => false,
    ],
];
