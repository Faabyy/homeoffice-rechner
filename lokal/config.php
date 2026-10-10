<?php
// Konfiguration nur fuer den lokalen Test auf diesem PC (wird nicht hochgeladen).
return [
    'db' => ['driver' => 'sqlite', 'path' => __DIR__ . '/data/lokal.sqlite'],
    'require_https' => false,   // lokal gibt es kein HTTPS
    'setup_key' => 'lokal-einrichtung-123456',
];
