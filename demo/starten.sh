#!/bin/sh
# Startet die App mit Demo-Daten: http://127.0.0.1:8090/ (Beenden: Strg+C)
cd "$(dirname "$0")"
HOR_CONFIG="$PWD/config.php" exec php -S 127.0.0.1:8090 -t ../webapp
