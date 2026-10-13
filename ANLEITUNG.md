# Homeoffice-Rechner einrichten

Die App besteht nur aus den Dateien im Ordner `webapp/`. Auf dem Server wird nichts installiert –
kein Composer, kein Node, keine Kommandozeile nötig. Die Datenbank (SQLite) legt die App beim ersten
Aufruf selbst als Datei in `webapp/data/` an. Ein normaler Webspace mit FTP-Zugang reicht.

## Voraussetzungen

- Webserver mit **PHP 7.4 oder neuer** (empfohlen: aktuelle PHP-Version) und der Erweiterung
  **pdo_sqlite** (oder pdo_mysql, wenn MySQL/MariaDB verwendet werden soll)
- **Apache** mit erlaubten `.htaccess`-Dateien (bei fast allen Shared-Hostern Standard).
  Für nginx siehe [unten](#betrieb-mit-nginx).
- **HTTPS** (SSL-Zertifikat) für die Domain – die Anmeldung funktioniert nur über `https://`
- ein FTP-Programm, z. B. [FileZilla](https://filezilla-project.org/)

## 1. Konfiguration anlegen

1. Im Ordner `webapp/lib/` die Datei `config.sample.php` kopieren und die Kopie `config.php` nennen.
2. In `config.php` zwei Werte ändern:
   - **`setup_key`**: einen langen, zufälligen Schlüssel eintragen (mindestens 16 Zeichen, nur
     Buchstaben und Ziffern). Er schützt die Einrichtungsseite. Am einfachsten mit einem
     Passwort-Generator erzeugen.
   - **Datenbank-Dateiname**: `ZUFALL` in `homeoffice-ZUFALL.sqlite` durch eine zufällige Zeichenfolge
     ersetzen (z. B. `homeoffice-k3f9q2x7m1.sqlite`). Das schützt die Datenbank zusätzlich, falls die
     `.htaccess` einmal nicht greifen sollte.

   Einen zufälligen Wert erzeugt unter Windows z. B. dieser PowerShell-Befehl:

   ```powershell
   -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
   ```

   Unter Linux/macOS: `openssl rand -hex 16`

3. Optional MySQL/MariaDB statt SQLite: den `mysql`-Block in `config.php` aktivieren, den
   `sqlite`-Block entfernen und die Zugangsdaten aus dem Kundenmenü des Hosters eintragen.
   Die Tabellen legt die App selbst an.

`config.php` enthält den Setup-Schlüssel und ggf. Datenbank-Zugangsdaten – nicht weitergeben und nicht
in ein öffentliches Repository hochladen (sie steht deshalb in `.gitignore`).

## 2. Hochladen

1. Im Kundenmenü des Hosters prüfen: Für die Domain ist eine passende **PHP-Version** eingestellt und
   **SSL (HTTPS)** aktiv.
2. Mit dem FTP-Programm den **Inhalt** von `webapp/` hochladen – entweder direkt ins Verzeichnis der
   Domain oder in einen Unterordner wie `homeoffice/`.
3. Wichtig: Die Dateien namens `.htaccess` (in `webapp/`, `webapp/lib/` und `webapp/data/`) müssen mit
   hoch. Sie sperren den Zugriff auf Code, Konfiguration und Datenbank. Viele FTP-Programme blenden sie
   aus – in FileZilla: *Server → Anzeige versteckter Dateien erzwingen*.

## 3. Einrichten

Im Browser aufrufen (Domain bzw. Unterordner und Schlüssel anpassen):

```
https://DEINE-DOMAIN/setup.php?key=DEIN-SETUP-SCHLUESSEL
```

Die Seite prüft den Server. Alle Punkte sollten ein ✓ haben, besonders
**„Datenbank vor Abruf aus dem Web geschützt“**. Falls dort ✗ steht, fehlt die `.htaccess` in `data/`
oder der Server wertet `.htaccess`-Dateien nicht aus.
Falls **„Ordner data/ beschreibbar“** ✗ zeigt: im FTP-Programm beim Ordner `data` die Rechte auf 755
(oder 775) setzen.

Dann auf derselben Seite das **Admin-Konto** anlegen – danach bist du angemeldet.
`setup.php` kann anschließend vom Server gelöscht werden (ohne den Schlüssel ist sie aber ohnehin
nutzlos).

## 4. Andere einladen

Konten gibt es nur auf Einladung: Tab **Benutzer** → Benutzernamen eingeben (frei wählbar, 2–64 Zeichen: a–z, Ziffern, `. _ - @ +`; keine E-Mail-Adresse nötig) →
**Einladungslink erstellen** → Link kopieren und der Person schicken (z. B. per Mail oder Chat). Der
Link gilt 7 Tage und nur einmal; damit legt die Person ihr Passwort fest. Die App verschickt selbst
keine E-Mails und braucht auch keine Adressen.

**Konten verwalten:** In der Kontenliste (mit Suche und Filter) ein Konto anklicken. In der Detailansicht
lassen sich die Rolle und der Benutzername ändern, ein **Passwort-Link** erstellen (24 Stunden gültig,
z. B. bei vergessenem Passwort), das Konto **sperren** (sofort abgemeldet, Daten bleiben) oder **überall
abmelden**, Lese-Freigaben setzen, die Daten des Kontos exportieren und es löschen. Alle diese Aktionen
stehen im **Protokoll** unten im Tab. Wer Fragen hat, findet die Admins in der App unter
*Einstellungen → Hilfe & Kontakt*.

**Rückmeldungen:** Jedes Konto kann unter *Einstellungen → Hilfe & Rückmeldung* (oder mit dem Knopf **Feedback** oben rechts) einen Text schicken
(Art: Vorschlag oder Fehler, höchstens 2000 Zeichen, höchstens 5 pro Stunde). Die App verschickt dazu keine
E-Mail: Die Nachrichten stehen bei den Admins im Tab **Verwaltung** unter *Rückmeldungen*, mit Benutzername,
Zeit, Tab und Browser. Hinter dem Tab steht **Verwaltung (n)**, solange n Rückmeldungen neu sind. Jede lässt sich als
gelesen oder erledigt markieren oder löschen und mit einer **Antwort** versehen; *Offene als Text kopieren* kopiert alle offenen zum Weitergeben.
Antwortest du oder markierst du eine Rückmeldung als erledigt, erscheint beim Absender beim nächsten Start der App das
Fenster *Neuigkeiten* mit einem Eintrag „Dein Fehler/Vorschlag ist erledigt“ und deiner Antwort (einmal; danach steht der
Eintrag weiter ohne „Neu“ in den Neuigkeiten). Die Absender sehen ihre eigenen Rückmeldungen mit dem Stand (eingegangen, gelesen, erledigt) unter dem Formular;
löscht ein Admin eine Rückmeldung, verschwindet sie auch dort. Beim Löschen eines Kontos bleiben seine Rückmeldungen erhalten. Neue Tabelle `feedback` (wird beim ersten
Aufruf automatisch angelegt).

**Lese-Konten:** Bei der Einladung als Rolle **Nur Lesen** wählen. Ein solches Konto hat keine eigene
Zeiterfassung, sondern sieht nur Planung, Einträge und Auswertung anderer Konten. Welche das sind, wird
nach der Anmeldung der Person in ihrer Detailansicht unter **Freigaben** festgelegt (Häkchen setzen →
**Freigaben speichern**) – oder umgekehrt beim Konto mit den Daten, welche Lese-Konten es sehen dürfen.
Die betroffenen Personen sehen unter *Einstellungen → Daten*, wer ihre Daten lesen darf.

## Als App auf dem Handy

Die Seite lässt sich wie eine App auf dem Startbildschirm ablegen – mit eigenem Symbol und ohne
Browserleiste. Ein App-Store ist dafür nicht nötig.

- **iPhone/iPad:** die Adresse in **Safari** öffnen → Teilen-Symbol (Quadrat mit Pfeil) →
  **Zum Home-Bildschirm** → Hinzufügen.
- **Android:** die Adresse in **Chrome** öffnen → Menü (⋮) → **App installieren** bzw.
  **Zum Startbildschirm hinzufügen**.

Beim ersten Öffnen der App einmal anmelden; die Anmeldung bleibt 30 Tage erhalten.

## Zugriff einschränken (optional)

In `lib/config.php` lässt sich unter `access` festlegen, von wo normale Benutzer die App nutzen dürfen.
**Administratoren sind ausgenommen** und können sich immer anmelden, z. B. zum Einladen am PC.

```php
'access' => [
    'blocked_networks' => ['203.0.113.7', '198.51.100.0/24'],
    'mobile_only' => true,
],
```

- **`blocked_networks`**: IP-Adressen oder Netze (CIDR), aus denen die App gesperrt ist – z. B. ein
  Netz, in dem die App nicht laufen soll. Die eigene öffentliche IP zeigt z. B. <https://ifconfig.me>.
  Gesperrt ist dann jedes Gerät in diesem Netz, auch ein Handy, das in diesem Netz im WLAN hängt; schon die
  Anmeldeseite ist von dort nicht aufrufbar (nur eine Hinweis-Seite). Bei `mobile_only` bleibt die Anmeldeseite
  dagegen aufrufbar, nur die Anmeldung selbst wird abgelehnt.
- **`mobile_only`**: nur Handy-Browser zulassen; Windows-, Mac- und Linux-Browser werden abgelehnt.
  iPads melden sich in Safari als Mac und sind damit ebenfalls gesperrt.

Die Sperre gilt für alle Konten außer Admins, also auch für Lese-Konten. Gesperrte Benutzer bekommen
beim Anmelden eine Meldung; Einladungslinks bleiben dabei gültig und lassen sich danach auf dem Handy
öffnen. Beides ist eine Nutzungssperre, kein Schutz vor Fachleuten: Die Browser-Kennung lässt sich
fälschen. Und wer die Seite in einem überwachten Netz aufruft, hinterlässt dort Spuren (Domain im
Proxy-/DNS-Protokoll), auch wenn die App den Zugriff ablehnt.

## Daten übernehmen

Unter **Einstellungen → Daten → Exportieren** kann jede Person ihre eigenen Daten als JSON-Datei
speichern und über **Importieren …** wieder einlesen – z. B. beim Umzug auf einen anderen Server.

## Datensicherung

Bei SQLite liegen alle Daten in der Datei `data/homeoffice-….sqlite`. Die App sichert sie
**automatisch**: Beim ersten Aufruf nach 7 Tagen entsteht eine Kopie in `data/backups/`
(`sicherung-DATUM-….sqlite`); die letzten 8 bleiben erhalten. Im Tab **Verwaltung → Sicherung** steht,
wann die letzte Kopie entstanden ist. Intervall und Anzahl lassen sich in `lib/config.php` ändern
(`'backup_days'`, `'backup_keep'`, siehe `config.sample.php`; `'backup_days' => 0` schaltet es ab).

Die Kopien liegen auf demselben Server – fällt er aus oder wird der Webspace gelöscht, sind sie mit weg.
Lade deshalb ab und zu den Ordner `data/backups/` (oder die neueste Datei daraus) per FTP herunter.
Zur Wiederherstellung eine Sicherung nach `data/` kopieren und so benennen wie die bisherige Datenbank
(die alte vorher umbenennen).

Bei MySQL gibt es keine automatische Sicherung; dort helfen die Backup-Funktionen des Hosters.
Zusätzlich kann jede Person ihre Daten selbst exportieren (siehe oben).

## Updates einspielen

Neue Versionen einfach wieder hochladen – aber **`lib/config.php` und den Ordner `data/` nicht
überschreiben**, sonst sind Einstellungen bzw. Daten weg. Neue Tabellen legt die App beim nächsten
Aufruf selbst an; vorhandene Daten bleiben unverändert.

Was sich geändert hat, steht technisch in `CHANGELOG.md`. Die Benutzer sehen die Neuerungen in der App
unter **Neuigkeiten** (das Fenster öffnet sich nach einem Update einmal von selbst).

## Betrieb mit nginx

nginx wertet `.htaccess` nicht aus. Die Ordner `lib/` und `data/` müssen dann in der
Server-Konfiguration gesperrt werden, z. B. (Pfad bei Unterordner anpassen):

```nginx
location ~ ^/(lib|data)/ { deny all; return 404; }
```

Außerdem sollte nginx HTTP auf HTTPS umleiten. Danach mit `setup.php` prüfen, ob die Datenbank
geschützt ist.

## Lokal ausprobieren

Ohne Server lässt sich die App auf dem eigenen PC testen. Lokal wird `lokal/config.php` verwendet
(ohne HTTPS-Pflicht), die Datenbank liegt in `lokal/data/`. Beides ist nur für den Test gedacht und wird
nicht hochgeladen.

**Windows:**

1. PHP für Windows herunterladen (<https://windows.php.net/download/>, „VS16/VS17 x64 Thread Safe“, ZIP)
   und nach `lokal/php/` entpacken, sodass `lokal/php/php.exe` existiert. Alternativ reicht ein
   installiertes PHP im `PATH`.
2. In `lokal/php/` die Datei `php.ini-development` nach `php.ini` kopieren und darin die Zeilen
   `extension_dir = "ext"` und `extension=pdo_sqlite` aktivieren (das `;` am Zeilenanfang entfernen).
3. `lokal/starten.bat` doppelklicken. Beim ersten Start öffnet sich die Einrichtung
   (http://127.0.0.1:8080/), danach direkt die App.

**Linux/macOS:** PHP mit pdo_sqlite installieren (Debian/Ubuntu: `sudo apt install php-cli php-sqlite3`),
dann im Projektordner:

```
HOR_CONFIG=$PWD/lokal/config.php php -S 127.0.0.1:8080 -t webapp
```

Beim ersten Mal http://127.0.0.1:8080/setup.php?key=lokal-einrichtung-123456 öffnen und ein Admin-Konto
anlegen.
