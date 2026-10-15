# Changelog

Alle Änderungen am Homeoffice-Rechner, neueste zuerst – technisch, für Betreiber und Entwicklung (mit
Datenbankänderungen). Für alle Nutzer verständlich steht dasselbe in `webapp/assets/changelog.js` (das
„Neuigkeiten“-Fenster in der App) – beide Dateien zusammen pflegen.

Hinweis: Die Einträge vor dem 05.10.2026 sind aus den Dateidaten rekonstruiert, die vom 05.10.2026 aus dem
Sitzungsverlauf.

## 2026-10-13 – Antworten auf Rückmeldungen, Benachrichtigung in den Neuigkeiten

- Tabelle `feedback`: neue Spalten `reply`, `replied_at`, `done_at`, `notify` (`SCHEMA_VERSION` 4; die Spalten kommen beim
  ersten Aufruf per `ALTER TABLE`, bestehende Rückmeldungen bleiben). `notify = 1` heißt: der Absender hat die letzte
  Antwort bzw. das „Erledigt“ noch nicht gesehen.
- `lib/feedback.php`: `update_feedback()` ersetzt `set_feedback_status()`; `admin-feedback-status` nimmt `status` und/oder
  `reply` (leer = Antwort zurücknehmen). Antwort oder „Erledigt“ setzt `notify`, eine Antwort auf eine neue Rückmeldung
  setzt sie auf „gelesen“, „Wieder öffnen“ löscht `done_at`. Neu: `POST feedback-seen` (`ids`, nur eigene Zeilen);
  `GET my-feedback` liefert zusätzlich `id`, `reply`, `updatedAt`, `notify`.
- Verwaltung: jede Rückmeldung hat ein Antwortfeld mit „Antworten“/„Antwort ändern“; „Erledigt“ und „Gelesen“ schicken eine
  geänderte Antwort mit. „Offene als Text kopieren“ enthält die Antwort.
- App: das Fenster „Neuigkeiten“ (`showNews()`) zeigt oben die Einträge zu eigenen Rückmeldungen mit Antwort oder Status
  „erledigt“ (`ticketNews()`, höchstens 10), neue mit „Neu“. Es öffnet sich beim Start auch dann, wenn nur so etwas neu ist
  (`maybeShowNews()`); beim Schließen geht `feedback-seen` raus. Die Liste in den Einstellungen zeigt die Antwort ebenfalls.
- Tests: `test_feedback_reply_and_notification`, `test_older_feedback_table_gets_reply_columns`, `test_feedback` erweitert.

## 2026-10-13 – Tabs übersichtlicher: Verwaltung, einklappbare Abschnitte, Feedback-Knopf

- Tab „Benutzer“ heißt jetzt „Verwaltung“ (intern weiter `data-tab="benutzer"`), der Zähler „Verwaltung (n)“.
- Einstellungen: „Hilfe & Kontakt“ und „Vorschlag oder Fehler melden“ sind ein Abschnitt „Hilfe & Rückmeldung“.
  Als einklappbare Abschnitte (`<details class="fold">`, bei jedem Besuch zu): Passwort ändern, Daten, Hilfe & Rückmeldung;
  in der Verwaltung: Offene Links, Protokoll, Sicherung. Chevron und Abstände in allen drei Designs.
- Neuer Knopf „Feedback“ oben rechts (`#feedback-btn`, `openFeedback()` in `app.js`): wechselt zu Einstellungen, klappt den
  Abschnitt auf und setzt den Cursor ins Nachrichtenfeld.

## 2026-10-13 – Vorschläge und Fehler melden

- Neue Tabelle `feedback` (`SCHEMA_VERSION` 3, wird beim ersten Aufruf angelegt; ohne Fremdschlüssel, die Texte
  bleiben beim Löschen eines Kontos). Neu `lib/feedback.php`: `save_feedback()` (Art `idea`/`bug`, 5–2000 Zeichen,
  höchstens 5 pro Stunde und Konto, speichert Benutzername, Tab und User-Agent), `new_feedback_count()`,
  `feedback_list()` (neueste 200), Status `new`/`read`/`done`.
- `api.php`: `POST feedback` (jedes angemeldete Konto, auch Lese-Konten), `POST admin-feedback-status` und
  `admin-feedback-delete`; `GET me` liefert Admins `newFeedback`, `admin-overview` zusätzlich `feedback` und `newFeedback`.
- App: Formular unter Einstellungen → „Vorschlag oder Fehler melden“; im Tab Benutzer der Abschnitt „Rückmeldungen“
  (Filter, gelesen/erledigt/löschen, „Offene als Text kopieren“). Hinter dem Tab steht „Benutzer (n)“ für neue
  Rückmeldungen, die Zahl kommt schon mit `GET me`, `admin.js` wird dafür nicht geladen. Textfeld und Liste in allen drei Designs.
- Absender sehen den Stand: `GET my-feedback` (und `POST feedback` liefert die Liste zurück) gibt dem Konto nur die eigenen
  Rückmeldungen mit Status zurück (`my_feedback()`); Liste „Deine Rückmeldungen“ unter dem Formular (Eingegangen / Gelesen /
  Erledigt), `renderMyFeedback()` in `app.js`.
- Tests: `test_feedback_reaches_admins`, `test_feedback_limit_per_hour`, `test_feedback` (Oberfläche);
  `test_full_flow` auf die geschenkten 5 Minuten angepasst (war seit dem Update davor rot).

## 2026-10-13 – Hinweistexte bei gesperrtem Netz und am PC

- `auth.php`: `BLOCKED_NETWORK_MESSAGE` ist jetzt der einzige Hinweistext, auch für `mobile_only`: „Entweder wird kein Handy
  oder Tablet verwendet, oder die Verbindung über dieses Netzwerk ist nicht möglich …“. Betreiber-Beispiele aus `ANLEITUNG.md` und den
  Config-Kommentaren entfernt.

## 2026-10-12 – Gesperrtes Netz: keine Anmeldeseite

- `auth.php`: neue Funktion `in_blocked_network()` und Konstante `BLOCKED_NETWORK_MESSAGE` (aus `access_restriction()`
  herausgelöst). `login.php` antwortet aus einem Netz in `blocked_networks` mit 403 und nur dem Hinweistext, auch bei
  `?token=`. `mobile_only` ändert nichts: PCs sehen die Anmeldeseite weiterhin. Test in `test_access.py`.

## 2026-10-12 – 5 Minuten pro Tag geschenkt

- `logic.js`: `GIFT_MINUTES = 5` wird in `flexByDay` zur gearbeiteten Zeit jedes Tages mit Einträgen addiert
  (nur Gleitzeit; Homeoffice-Quote und Prognose bleiben unverändert). `app.js`: Tagesvorschau im Formular rechnet
  mit. Test `test_flextime` angepasst.

## 2026-10-10 – Screenshots als Schaufenster, Fehler „null“ im Konto-Dialog

- README: neun Screenshots (`docs/screenshots/`): alle drei Designs hell und dunkel, dabei Planung,
  Zeiterfassung, Einstellungen, Benutzerverwaltung, Tagesmenü, Neuigkeiten und drei Handy-Ansichten.
- `demo/seed.py`: legt `anna` (Nutzer) und `chefin` (Nur Lesen, sieht das Demo-Konto) wirklich an
  (Einladung wird eingelöst), dazu eine offene Einladung `max`.
- Fehler gefunden und behoben: Im Konto-Dialog eines Lese-Kontos stand zwischen den Abschnitten der Text „null“,
  weil `replaceChildren(null)` ihn als Text einfügt (`assets/admin.js`). Test ergänzt.

## 2026-10-10 – Startbildschirm und untere Leiste der Android-App folgen dem Design

Hinweis: `manifest.webmanifest` auf dem Server löschen.

- Ursache des weißen Startbildschirms und der weißen unteren Leiste: `manifest.webmanifest` hatte feste Farben
  `#ffffff`; Android nimmt Splash-Screen und Systemleisten der installierten App daraus.
- Neu: `manifest.php` erzeugt das Manifest; `theme_color`/`background_color` richten sich nach dem Cookie `look`
  (`<design>-<light|dark>`), das `design.js` bei jeder Design-/Farbmodus-Wahl und beim Systemwechsel setzt.
  Die Link-Tags in `lib/app.html`/`lib/login.html` zeigen darauf (`crossorigin="use-credentials"`, damit das
  Cookie mitgeschickt wird). Die Farbtabelle muss zu `PAGE_COLORS` in `design.js` passen.
- Android übernimmt ein geändertes Manifest erst beim Aktualisieren der installierten App (etwa einmal am Tag);
  sofort sieht man es nach Deinstallieren und erneutem „Zum Startbildschirm hinzufügen“. „Automatisch“ hält die
  Farbe des Systemmodus zum Zeitpunkt des letzten Öffnens. Nicht auf einem Android-Gerät geprüft.

## 2026-10-10 – Leistenfarbe nach Rückkehr in die App

- `design.js`: Beim Zurückkehren in die App (`visibilitychange`, `pageshow`) wird der `<meta name="theme-color">`
  ersetzt und die Farbe neu gesetzt. Android fällt dabei sonst auf die Manifest-Farbe (Weiß) zurück. Nicht
  auf einem Android-Gerät geprüft, nur der Testlauf im Desktop-Browser.

## 2026-10-10 – Wochentag-Auswahl nicht mehr abgeschnitten

- `.weekday-select select` hat in `app.css`, `klassisch.css` und `warm.css` `min-width: 15em` statt fester
  Breite, damit „Arbeitstag (nicht vorbelegt)“ in „Klassisch“ vollständig lesbar ist.

## 2026-10-10 – Screenshots in der README

Kein Upload nötig (nur Repository).

- `docs/screenshots/*.png` (Demo-Daten, erzeugt mit headless Chromium) und Abschnitt „Screenshots“ in `README.md`.
- `demo/seed.py`: Benutzername `demo` statt E-Mail-Adresse, mehr erfasste Tage, Freitag nicht mehr als
  Homeoffice vorbelegt, damit die Prognose im Rahmen bleibt.

## 2026-10-10 – Benutzername statt E-Mail-Adresse

- Anmeldung, Einladung, Passwort-Link und Kontoverwaltung nutzen einen Benutzernamen: kleingeschrieben, 2–64
  Zeichen aus `a-z 0-9 . _ - @ +` (`normalize_username()` in `lib/auth.php`). Bestehende E-Mail-Adressen
  bleiben gültig, es ist keine Datenmigration nötig.
- API/JSON: Feld `email` → `username` (auch in `me`, `shared`, `admin-overview`, `admin-export`), Aktion
  `admin-email` → `admin-username`. Der Admin-Log kennt die Aktion `username`; alte Einträge `email` bleiben lesbar.
- Datenbankspalten (`users.email`, `tokens.email`, `admin_log.*_email`) heißen bewusst weiter so, um keine
  Migration auf dem Webspace zu riskieren.
- Hilfe: die Admin-Kontakte sind keine `mailto:`-Links mehr.

## 2026-10-10 – Performance und Aufräumen (Code-Review)

Hinweis: Lässt sich die geänderte `.htaccess` nicht speichern oder gibt es danach einen 500-Fehler, den Block
`Cache-Control` darin wieder entfernen.

- Datenbank: Schema-Version in neuer Tabelle `schema_meta` (`SCHEMA_VERSION` in `lib/db.php`) statt
  Prüfung der „neuesten Tabelle“; spätere neue Spalten werden so nicht mehr übersehen. Die vorhandene
  Datenbank wird beim ersten Aufruf automatisch migriert (neue Tabelle + Indizes `sessions_expires`,
  `sessions_user`, `login_failures_at`), Daten bleiben unberührt.
- Automatische Sicherung wird nur noch beim App-Start (`GET me`) geprüft, nicht bei jeder Anfrage.
- `.htaccess`: `.js`/`.css` ein Jahr cachen (die URLs tragen `?v=<Änderungszeit>`); `setup.php` versioniert
  `app.css` jetzt ebenfalls.
- `api.php`: JSON-Antworten per gzip, wenn der Browser es anfragt und PHP zlib hat.
- Import (`import_data`): Mehrzeilen-`INSERT` in Blöcken (`db_insert_many`) statt eines Statements je Zeile.
- `app.js`: Verwaltungsbereich nach `assets/admin.js` ausgelagert und erst beim ersten Öffnen des Tabs
  „Benutzer“ geladen; Klick/Kontextmenü im Kalender einmal am Container statt je Tag; `render()`
  (lädt Schulferien nach) von `draw()` (zeichnet nur) getrennt, sodass der Lader nicht mehr `render()`
  erneut aufruft. Kein sichtbarer Unterschied für Nutzer, daher kein Eintrag in `changelog.js`.

## 2026-10-10 – Navigationsleiste beim Start nicht mehr weiß

- `<meta name="theme-color">` steht jetzt vor `design.js` im `<head>` von `lib/app.html` und
  `lib/login.html`. Vorher fand `design.js` den Tag beim Laden noch nicht, sodass bis zum Ende des
  Ladens das fest eingetragene Weiß galt (in „Warm“/„Klassisch“ dunkel sichtbar als weiße Leiste).
- `design.js` setzt die Farbe sofort aus einer Tabelle der Seitenhintergründe je Design und Farbmodus
  (`PAGE_COLORS`, muss zu den Stylesheets passen) und verfeinert sie nach dem Laden wie bisher.

## 2026-10-10 – Handy-Ansicht überarbeitet

- Systemleisten der installierten App: `design.js` setzt `<meta name="theme-color">` auf die Farbe oben
  auf der Seite (Kopfleiste in „Klassisch“, sonst der Seitenhintergrund), auch bei Design-, Farbmodus- und
  Systemwechsel. `viewport-fit=cover` mit `env(safe-area-inset-*)`-Abständen, damit die Seite unter der
  Navigationsleiste weiterläuft. Manifest: `theme_color` weiß statt blau.
- Neue `assets/mobile.css` für alle drei Designs (nach den Design-Stylesheets geladen, nie abgeschaltet):
  kompakte Kopfzeile (Titel und Links in einer Zeile, Monat darunter), Tagesmenü als Blatt am unteren
  Rand, 16-px-Felder (kein Zoom auf dem iPhone) und größere Tippflächen, Einträge als zweizeilige Zeilen
  statt breiter Tabelle, Übersicht nur in Planung und Zeiterfassung.
- Kalender auf Handys: kurze Beschriftungen („HO“, „Schule“, „Büro 8:00“) und gekürzte Feiertagsnamen
  mit weichen Trennstellen (`SHORT_LABELS`, `SHORT_HOLIDAYS` in `app.js`).
- Langes Drücken auf einen Tag öffnet das Tagesmenü (`setupLongPress()`; iOS kennt kein `contextmenu`
  bei langem Tippen), der Hinweis unter dem Kalender nennt auf Touch-Geräten Tippen/lange drücken.
- Einträge werden auf Handys durch Antippen der Zeile bearbeitet (der Knopf „Bearbeiten“ ist dort
  ausgeblendet).
- Reiter in allen Designs ohne abgeschnittene Wörter.
- Tests: `test_phone_view` in `tests/test_ui.py`; `test_design_switch` zählt nur die Design-Stylesheets.

## 2026-10-10 – Handy-App, Zugriffssperre, Vorbereitung für GitHub

Enthält auch alle Dateien der Einträge vom 05.10. darunter (waren noch nicht hochgeladen) und repariert den Server
nach dem Upload vom 09.10.

Eingebaut aus den Änderungen vom 09.10., die auf dem alten Stand vom 02.10. entstanden waren:

- Reparatur: Am 09.10. wurden `lib/auth.php`, `lib/app.html`, `lib/login.html`, `lib/config.php` und
  `.htaccess` durch Fassungen vom 02.10. ersetzt. Die alte `auth.php` deklariert `admin_overview()` ein
  zweites Mal (heute in `lib/admin.php`) → HTTP 500.
  `diagnose.php` vom Server löschen.
- Installierbare Web-App: `manifest.webmanifest`, Symbole in `assets/icons/` (weißes Haus auf `#2563eb`),
  Manifest-, Icon- und Apple-Tags im `<head>` von `lib/app.html` und `lib/login.html`. Kein Service Worker.
  Kein `AddType` für `.webmanifest` in der `.htaccess` (stand im Verdacht, den 500er auszulösen).
- Zugriffssperre für Nicht-Admins (`config` `access`: `blocked_networks` als IP/CIDR, `mobile_only` per
  User-Agent): `access_restriction()` in `lib/auth.php`; `current_user()` liefert für gesperrte Benutzer
  null (die Sitzung bleibt auf dem erlaubten Gerät gültig), `login()` und `redeem_link()` lehnen mit 403
  ab, der Einladungslink bleibt gültig. Admins sind ausgenommen. `config.sample.php`: Block mit Standard
  „aus“.
- Tests: `tests/test_access.py` (3 Tests), `PhpServer(extra_config)` in `tests/support.py`.
- GitHub-Vorbereitung: `.gitignore` (Konfiguration, Datenbanken, `lokal/php/`, Exporte,
  IDE-Dateien, `CLAUDE.local.md`), `lokal/data/.gitkeep`, `README.md`; `ANLEITUNG.md` allgemein
  umgeschrieben (kein Hoster, kein Schlüssel, kein persönlicher Pfad; neu: Konfiguration anlegen, Handy-App,
  Zugriff einschränken, nginx, lokal unter Linux). `lokal/starten.bat` nimmt `php` aus dem `PATH`, wenn
  `lokal/php/php.exe` fehlt.

## 2026-10-05 – Farbmodus-Schalter, Rahmenkontraste, Wochentag-Beschriftung

- *Einstellungen → Darstellung → Farbmodus*: Automatisch (System), Hell oder Dunkel, pro Browser (localStorage
  `farbmodus`), auch auf der Anmeldeseite. `design.js` setzt `<html data-scheme>`; jedes Stylesheet hat die dunklen
  Farben zweimal: im `prefers-color-scheme`-Block (außer bei `data-scheme="light"`) und für `data-scheme="dark"`.
- Rahmen von Eingabefeldern, Auswahllisten, Knöpfen und Ort-Schalter erreichen jetzt mindestens 3:1 zum Hintergrund
  (WCAG 1.4.11): neue Farbe `--field` in „Modern“ und „Warm“ (vorher 1,2–1,5:1), „Klassisch“ dunkel 3,05 → 3,87.
  Kartenrahmen in „Warm“ deutlicher (1,35 → 1,56 hell, 2,21 dunkel).
- Wochentage: „Arbeitstag“ heißt jetzt „Arbeitstag (nicht vorbelegt)“; die Wochentage stehen in einer eigenen,
  vollen Zeile (vorher ragten die zwei Spalten bei ca. 1024 px Fensterbreite aus der Karte), unter 700 px einspaltig.

## 2026-10-05 – Drittes Design („Warm“)

- Neues Design „Warm“ (`assets/warm.css`, baut auf `app.css` auf; Unterschiede im Block „Warm: components“ am
  Ende): Elfenbein-/Sandtöne, gedämpfter Tonrot-Akzent, abgerundete Karten, Reiter als Segment-Schalter,
  Serifen-Überschriften. Kontrast geprüft wie bei den anderen (Text ≥ 4,5:1, Hover ≥ 3:1, hell und dunkel).
- Behoben in allen Designs: „max. 30,0 %“ unter dem Balken stieß an „Noch … möglich“ (zu wenig Abstand); große Zahlen
  der Auswertung dichter an ihren Überschriften (Klassisch, Warm); Tageszahl und Beschriftung im Kalender zu eng;
  Schulferien-Name in schmalen Kalenderkacheln mitten im Wort abgeschnitten (jetzt „Herbstf…“).
- Geprüft per Skript in 3 Designs × hell/dunkel × Desktop/Handy × 7 Ansichten (Tabs, Neuigkeiten, Kontodetails,
  Menü): Textkontrast, Hover-Kontrast, Überlappungen, Abstände unter 6 px, abgeschnittene Texte, Seitenbreite.

## 2026-10-05 – Zweites Design („Klassisch“) und Darstellungsfehler

- Unter *Einstellungen → Darstellung* lässt sich zwischen „Modern“ (bisher, Standard) und „Klassisch“ wählen
  (eckig, Serifen-Überschriften, dunkelblaue Kopfleiste, Kalender als Raster). Neue Dateien `assets/klassisch.css`
  und `assets/design.js`; die Wahl gilt pro Browser (localStorage) und auch auf der Anmeldeseite. Beim Umschalten
  bleibt das alte Stylesheet aktiv, bis das neue geladen ist (sonst kurz ungestylte Seite).
- Behoben: Primärknöpfe (z. B. „Verstanden“) im klassischen Dunkelmodus beim Hovern unsichtbar; deaktivierte Knöpfe
  im modernen Design nicht erkennbar; Bildlaufleiste über dem Text in der Neuigkeiten-Liste und im Protokoll.
- Geprüft: Textkontrast aller Bedienelemente in beiden Designs, hell und dunkel, normal und beim Hovern; jeder Text
  erreicht mindestens 4,5:1 (WCAG AA). „Klassisch“ hat dafür kräftigere Farben, Linien und Neben-Texte bekommen.
- Übersichtlichkeit: Hinweistexte gekürzt oder entfernt (Einstellungen, Daten, Hilfe & Kontakt, Benutzer,
  Kontodetails, Anmeldeseite); Wochentage als zweispaltiges Raster; Eingabefelder, Auswahlfelder und Knöpfe einer
  Zeile gleich hoch; der gewählte Ort in der Zeiterfassung (Klassisch) sieht nicht mehr wie ein Hauptknopf aus.
- Lokale Demo mit Beispieldaten in `demo/` (wird nicht hochgeladen).

## 2026-10-05 – Kontoverwaltung für Admins

- Nur für Admins: Kontenliste mit Suche/Filter und Detailansicht je Konto (Rolle, E-Mail, Sperren, Abmelden,
  Freigaben, Export, Löschen) sowie ein Protokoll aller Admin-Aktionen. Code in `lib/admin.php` (neu).
- Datenbank: neue Tabelle `admin_log`, neue Spalte `users.locked_at` (werden automatisch angelegt).

## 2026-10-05 – Heutiger Tag im Kalender

- Der heutige Tag hat einen Rahmen in der Akzentfarbe, die Tageszahl steht in einem kleinen farbigen Kreis.

## 2026-10-05 – Wochentage als Homeoffice/Büro, Neuigkeiten, Hilfe & Kontakt

- **Wochentage:** Unter *Einstellungen → Wochentage* gibt es zusätzlich „Homeoffice“ und „Büro“. Solche
  Wochentage sind Arbeitstage und gelten ohne eigenen Planungseintrag als so geplant (Kalender, Prognose,
  Vorbelegung der Zeiterfassung). Ein Klick im Kalender wechselt Standard → anderer Ort → Frei → Standard;
  im Rechtsklick-Menü ist der Standard mit „(Standard)“ markiert (auch bei Frei/Berufsschule).
  Neue optionale Einstellungsfelder `homeOfficeDays`, `officeDays` (Teilmengen von `workdays`); ältere
  gespeicherte Einstellungen bekommen sie beim Laden als leere Listen. Keine Datenbankänderung.
- **Neuigkeiten:** Nach einem Update öffnet sich einmal ein Fenster mit den Änderungen (Inhalt aus
  `assets/changelog.js`); jederzeit über „Neuigkeiten“ oben rechts. Was gesehen wurde, merkt sich der
  Browser (localStorage, pro Konto) – auf einem neuen Gerät erscheinen die Einträge seit Kontoerstellung noch einmal.
- **Hilfe & Kontakt:** Neuer Abschnitt unter *Einstellungen*, der erklärt, wofür man einen Admin braucht
  (Lese-Konten und Freigaben, Einladungen, Passwort-Links, Konto löschen), mit den E-Mail-Adressen der Admins
  (`GET me` liefert jetzt `createdAt` und `admins`). Hinweise auch unter *Daten* (Lesezugriff), im Hinweis für
  Lese-Konten ohne Freigabe und auf der Anmeldeseite (Passwort vergessen).

## 2026-10-05 – Automatische Datensicherung

- Alle 7 Tage (beim ersten Aufruf danach) Kopie der SQLite-Datenbank nach `data/backups/`, die letzten 8
  bleiben. Einstellbar mit `backup_days` / `backup_keep` in `lib/config.php`. Anzeige im Tab *Benutzer → Sicherung*.

## 2026-10-05 – Lese-Konten und Cache-Fix

- Neue Rolle **„Nur Lesen“**: kein eigenes Erfassen, sieht Planung, Einträge und Auswertung der Konten, die ein
  Admin unter „Darf sehen“ freigibt. Besitzer sehen unter *Einstellungen → Daten*, wer ihre Daten lesen darf.
  Datenbank: neue Tabelle `viewer_access`, neue Spalten `users.is_viewer`, `tokens.is_viewer` (automatisch ergänzt).
- JS/CSS werden mit Versionsnummer (`?v=<Änderungszeit>`) ausgeliefert, damit nach Updates keine alten Dateien
  aus dem Browser-Cache geladen werden (Fehler „Cannot read properties of null (reading 'checked')“).
- Tests laufen auch unter Linux (System-PHP, Chromium).

## 2026-10-02 – Web-Version

- Umstieg von der früheren Desktop-Version auf eine PHP-Web-App für einen Shared-Webspace (SQLite, optional MySQL).
- Anmeldung mit E-Mail und Passwort, Konten nur per Einladungslink, Passwort-Links, Admin-Verwaltung, `setup.php`.
- Planung im Kalender (Klick: Homeoffice → Büro → Frei; Rechtsklick: Urlaub, Krank, Berufsschule/Studium,
  Zeit erfassen), Feiertage nach Bundesland, Schulferien (nur Anzeige, openholidaysapi.org).
- Wochentage als Arbeitstag, Berufsschule/Studium oder Frei.
- Zeiterfassung mit Prognose des Homeoffice-Anteils, Gleitzeitkonto mit Korrekturen.
- Export/Import, auch der Datei der Desktop-Version (`eintraege.json`).
