"use strict";

// What's new, for the "Neuigkeiten" dialog (shown once after an update, see app.js showNews).
// Every account sees every entry, so write for all users: what changed for them, in plain
// German, without technical or admin-only instructions (those belong in CHANGELOG.md or
// ANLEITUNG.md). Newest first; every entry needs a unique, never changing id, because the
// dialog remembers the newest id a user has seen. Optional `ask`: what only an admin can do
// for the user (not shown to admins).

const CHANGELOG = [
  {
    id: "2026-10-10-handy",
    date: "2026-10-10",
    title: "Als App auf dem Handy",
    items: [
      "Du kannst den Homeoffice-Rechner jetzt wie eine App auf dem Startbildschirm ablegen, mit eigenem Symbol und "
        + "ohne Browserleiste. iPhone: in Safari auf das Teilen-Symbol tippen → „Zum Home-Bildschirm“. "
        + "Android: in Chrome im Menü (⋮) „App installieren“ wählen.",
      "Die Anmeldung bleibt 30 Tage erhalten, du musst dich also nicht jedes Mal neu anmelden.",
      "Je nach Einstellung lässt sich der Homeoffice-Rechner nur auf bestimmten Geräten oder nicht aus bestimmten "
        + "Netzwerken nutzen. Beim Anmelden steht dann, woran es liegt.",
    ],
  },
  {
    id: "2026-10-05-design",
    date: "2026-10-05",
    title: "Neue Designs zur Auswahl",
    items: [
      "Unter Einstellungen → Darstellung kannst du zwischen drei Designs wählen: dem bisherigen („Modern“), "
        + "„Klassisch“ (eckig, mit dunkelblauer Kopfleiste und einem Kalender wie ein gedruckter Monatskalender) "
        + "und „Warm“ (helle Sandtöne, weiche Karten, viel Luft).",
      "Ebenfalls dort: Farbmodus „Automatisch“, „Hell“ oder „Dunkel“, falls dir die automatische Wahl nicht gefällt.",
      "Übersichtlicher: weniger Hinweistexte, Wochentage in den Einstellungen als ordentliche Tabelle, mehr Abstand "
        + "in der Auswertung und im Kalender. Ein normaler Arbeitstag heißt dort jetzt „Arbeitstag (nicht vorbelegt)“.",
      "Eingabefelder und Knöpfe haben deutlichere Ränder.",
      "Behoben: Knöpfe waren beim Darüberfahren teils schlecht lesbar, und die Bildlaufleiste lag in der Liste der "
        + "Neuigkeiten über dem Text.",
    ],
  },
  {
    id: "2026-10-05-kontoverwaltung",
    date: "2026-10-05",
    title: "Kontoverwaltung für Admins",
    items: [
      "Admins können Konten jetzt ausführlicher verwalten, z. B. vorübergehend sperren oder die E-Mail-Adresse "
        + "ändern. Was Admins an Konten ändern, wird protokolliert.",
    ],
  },
  {
    id: "2026-10-05-heute",
    date: "2026-10-05",
    title: "Heutiger Tag besser sichtbar",
    items: ["Im Kalender ist der heutige Tag jetzt farbig umrandet, die Tageszahl steht in einem blauen Kreis."],
  },
  {
    id: "2026-10-05-wochentage",
    date: "2026-10-05",
    title: "Wochentage fest als Homeoffice oder Büro",
    items: [
      "Unter Einstellungen → Wochentage kannst du einen Wochentag jetzt direkt als „Homeoffice“ oder „Büro“ "
        + "einstellen. Diese Tage sind im Kalender automatisch so geplant und zählen in der Prognose mit – "
        + "kein Durchklicken mehr Tag für Tag.",
      "Einzelne Tage änderst du weiterhin per Klick oder Rechtsklick im Kalender; was du dort planst, "
        + "geht vor.",
    ],
  },
  {
    id: "2026-10-05-neuigkeiten",
    date: "2026-10-05",
    title: "Neuigkeiten und Hilfe",
    items: [
      "Nach einem Update zeigt die App einmal, was neu ist. Alle Änderungen findest du jederzeit über "
        + "„Neuigkeiten“ oben rechts.",
      "Unter Einstellungen → Hilfe & Kontakt steht, wofür du einen Admin brauchst und wer Admin ist.",
    ],
  },
  {
    id: "2026-10-05-sicherung",
    date: "2026-10-05",
    title: "Automatische Datensicherung",
    items: ["Die Daten werden jetzt regelmäßig automatisch auf dem Server gesichert."],
  },
  {
    id: "2026-10-05-lesekonten",
    date: "2026-10-05",
    title: "Lese-Konten",
    items: [
      "Neue Kontoart „Nur Lesen“: z. B. eine Führungskraft kann Planung, Einträge und Auswertung "
        + "freigegebener Konten ansehen, aber nichts ändern.",
      "Unter Einstellungen → Daten siehst du, wer deine Daten lesen darf.",
    ],
    ask: "Lese-Konten und ihre Freigaben richtet ein Admin ein – melde dich dort, wenn jemand deine Daten sehen soll.",
  },
  {
    id: "2026-10-05-cache",
    date: "2026-10-05",
    title: "Fehlerbehebung nach Updates",
    items: ["Behoben: Direkt nach einem Update konnte die App eine Fehlermeldung zeigen, bis man die Seite neu lud."],
  },
  {
    id: "2026-10-02-webversion",
    date: "2026-10-02",
    title: "Start der Web-Version",
    items: [
      "Anmeldung mit E-Mail und Passwort, Konten nur per Einladung.",
      "Planung im Kalender (Klick: Homeoffice, Büro, Frei; Rechtsklick: Urlaub, Krank, "
        + "Berufsschule/Studium und Zeit erfassen), Feiertage und Schulferien nach Bundesland.",
      "Zeiterfassung mit Prognose des Homeoffice-Anteils und Gleitzeitkonto.",
      "Wochentage als Arbeitstag, Berufsschule/Studium oder Frei einstellbar.",
      "Export und Import der eigenen Daten, auch aus der früheren Desktop-Version.",
    ],
    ask: "Neue Personen einladen oder einen Passwort-Link erstellen kann nur ein Admin.",
  },
];
