Du arbeitest an Stream247 (Repo DrJakeberg/stream247): eine selbst gehostete Software, die einen
Twitch-Kanal rund um die Uhr aus Aufzeichnungen bespielt. Dein Startbranch m75-source-breaker ist
der Stand der kommenden Version 2.2.0.

AUFTRAG
Recherchiere und plane die nächste Ausbaustufe. Du änderst keinen Produktcode. Dein Ergebnis ist
die Datei planning/proposal-2026-10.md, gepusht auf deinem Branch.
Grund: Parallel läuft der Release-Zug 2.1.0 → 2.2.0. Bis er durch ist, bleiben main, PLANS.md und
CHANGELOG.md unberührt; sonst entstehen Merge-Konflikte, und ungetesteter Code landet in einer
Version, die 24 Stunden im Soak lief. Umgesetzt wird erst, wenn ich den Vorschlag freigegeben habe.

Ich schaue nicht zu, während du arbeitest, und kann zwischendurch keine Fragen beantworten. Triff
Routineentscheidungen selbst und nenne die Annahme. Produktentscheidungen sammelst du als Fragen an
mich im Vorschlag, jede mit deiner Empfehlung. Hör nicht bei einem Zwischenstand auf: Ende ist,
wenn die Datei die Kriterien unter FERTIG WENN erfüllt.

MEIN ZIEL DAHINTER
Stream247 soll stabil laufen, sich von Störungen selbst erholen, sich von jedem ohne Vorwissen
fehlerfrei installieren lassen und so bedienbar sein, dass ein Streamer sein Programm ohne Handbuch
plant.

THEMEN
1. Zeitplanung. Ich will sagen können: „Die nächsten 10 Tage läuft jeden Abend um 20 Uhr diese
   Playlist.“ Heute kennt schedule_blocks nur Wochentag, Uhrzeit, Dauer und einen Wiederholmodus
   (single/daily/weekdays/weekends/custom), kein Start- und Enddatum; prüfe das nach. Entwirf die
   kleinste Erweiterung für befristete und einmalige Programmpunkte: Datenmodell (additiv), Vorrang
   gegenüber dem Wochenraster, Verhalten nach Ablauf, Zeitzone und Zeitumstellung, Abgleich mit dem
   Twitch-Zeitplan, die öffentliche Seite /channel und der Bedienweg im Editor Schritt für Schritt.
   Vorbild für die Zuschauersicht ist der Sendeplan von GronkhTV; Screenshots hängen an. Fehlen
   sie: gronkh.tv ist eine JavaScript-App, öffne sie und twitch.tv/gronkhtv/schedule mit Playwright.
   Gelingt das nicht, stell mir dazu eine Frage im Vorschlag, statt zu raten.
2. Wettbewerb. Was können diese Dienste bei Planung, Ausfallsicherheit, Einrichtung und
   Zuschauerbindung besser, und was davon passt zu einem selbst gehosteten Produkt?
   upstream.so, streamloop.app, streamhouse.co, livereacting.com, livepush.io, gyre.pro,
   onestream.live, castr.com
   Baue auf dem Vergleich vom 2026-10-01 auf (M75 bis M77 in PLANS.md, „Known follow-ups“ in
   HANDOFF.md auf main); wiederhole ihn nicht. Jede Aussage über einen Dienst braucht die URL, auf
   der du sie gelesen hast. Was nur Werbetext ist, markierst du so. Ist eine Seite gesperrt, nimm
   die Websuche und markiere die Aussage als nicht selbst gelesen. Übernimm Ideen, keine Texte,
   Namen oder Oberflächen.
3. Bedienung. Geh die Oberfläche in zwei Rollen durch. Streamer: Ersteinrichtung, eine Woche
   planen, nachts um drei eine Störung verstehen. Zuschauer: /channel, das Bild auf Sendung,
   Chat-Befehle. Grundlage sind die 28 Baseline-Screenshots unter
   tests/e2e/design-baseline.spec.ts-snapshots/ (als Bilder lesen), docs/ui.md und der Code; wenn
   Docker läuft, zusätzlich der Dev-Stack (scripts/dev-stack.sh). Je Befund: Seite, Problem,
   Vorschlag, Aufwand.
4. Selbstheilung. Liste, welche Störungen das System heute selbst behebt (Wächter, Breaker,
   Neustart-Regeln, Incident-Bereinigung) und welche einen Menschen brauchen, jeweils mit Datei und
   Zeile. Schlage vor, wo eine automatische Erholung fehlt und sicher wäre.
5. Installation. Folge docs/getting-started.md wörtlich auf einem frischen Stack, wenn Docker
   läuft, und notiere jede Stelle, an der ein Fremder scheitern würde. Sonst als Lesedurchgang, und
   sag das dazu.
6. Fehler. Prüfe die riskantesten Stellen gegnerisch: Auswahl und Übergänge im Worker,
   Zeitplan-Rechnung über Mitternacht und Zeitumstellung, Migrationen. Ein Fehler zählt, wenn du
   ihn mit einem Test oder einer Befehlsausgabe zeigen kannst; alles andere heißt „Verdacht“.
   Nichts beheben.
7. Ein Plan. Inventarisiere alle Plan- und Agentendateien und schlage vor, wie daraus ein kurzer,
   aktueller Plan plus Archiv wird. Bekannte Fundstellen: AGENTS.md und IMPLEMENT.md verweisen auf
   docs/full-product-reset-audit.md, das es nicht mehr gibt; der DUT-Abschnitt in AGENTS.md
   widerspricht HANDOFF.md; planning/next-session-prompt.md beschreibt v1.5.22; PLANS.md hat über
   5.000 Zeilen, die laut AGENTS.md jede Sitzung ganz lesen soll; im Repo-Root liegt
   release-prune-backup-20260614T000908Z/; zwei claude/-Branches sind nicht in main enthalten.
   Regeln, die heute nur in HANDOFF.md und in meinen Prompts stehen, gehören dauerhaft nach
   AGENTS.md.

FORM DES ERGEBNISSES
planning/proposal-2026-10.md, auf Englisch wie PLANS.md: Kurzfassung (höchstens 15 Zeilen); je
Thema die Befunde mit Beleg; dann die vorgeschlagenen Meilensteine als Tabellenzeilen im Format von
PLANS.md (fortlaufend nach der höchsten vergebenen Nummer; Type, Priority, Goal, Acceptance,
Touched Areas, Risk, Rollback), nach Nutzen und Risiko geordnet. Jede Acceptance muss sich mit
einem Befehl oder Test prüfen lassen: „intuitiv“ ist kein Kriterium; „ein befristeter Block
erscheint in der Vorschau und endet am Enddatum, Test X beweist es“ ist eines. Am Ende höchstens
zehn Fragen an mich, jede mit Empfehlung.

REGELN
- Keine Änderung an Produktcode, PLANS.md, CHANGELOG.md oder main. Du legst nur zwei Dateien unter
  planning/ an. Kein Pull-Request, solange PR #3 offen ist; pushe nur deinen Branch.
- M66, der Soak-Teil von M57, M77 und M81 bleiben zurückgestellt: nicht einplanen, nur erwähnen.
- Nie ein Secret oder einen Stream-Key ausgeben oder committen.
- Stream247 ist source-available. Code aus anderen Projekten zu übernehmen ist eine Lizenzfrage:
  als Frage an mich, nicht als Vorschlag.

ARBEITSWEISE
Lege als Erstes planning/research-brief.md mit diesem Auftrag an, unverändert; nach einer
Kontextverdichtung liest du ihn dort nach. Bearbeite die Themen mit Subagenten parallel, committe
und pushe nach jedem Thema und schreib dazu einen Satz Zwischenstand. Lass am Ende einen
Subagenten, der die Entstehung nicht kennt, den Vorschlag gegen FERTIG WENN prüfen: nur Lücken, die
die Kriterien betreffen, keine Stilfragen. Mit mir sprichst du Deutsch.

FERTIG WENN
- planning/proposal-2026-10.md liegt gepusht auf deinem Branch und enthält alle sieben Themen;
- jeder Meilenstein hat eine prüfbare Acceptance und einen Rollback;
- jede Aussage über einen Wettbewerber hat eine URL, jeder Befund im Code Datei und Zeile;
- jeder Fehler ist reproduziert oder als Verdacht markiert;
- deine Abschlussnachricht nennt die fünf wichtigsten Vorschläge, die Fragen an mich und was du
  nicht prüfen konntest.
