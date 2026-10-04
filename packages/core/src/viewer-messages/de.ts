import type { ViewerMessageCatalogue } from "./types.js";

/**
 * German viewer messages (M80).
 *
 * Short Twitch German in the du-form, with one word per thing: "Als Nächstes" for what comes next,
 * "Gleich geht’s weiter" for the standby state, "Stimme/Stimmen" for votes, "Überspringen" for a skip,
 * "Einspieler" for an insert, "Regie" for the operator. Every text that shares a row on the picture
 * was measured in the renderer's fonts against the room the layout gives it, not counted in
 * characters; tests/unit/viewer-language-fit.test.ts holds the measurement and fails when German
 * needs more room than the panel has (or than English already takes).
 */
export const DE_VIEWER_MESSAGES: ViewerMessageCatalogue = {
  "overlay.heroLabel.asset": "Läuft gerade",
  "overlay.heroLabel.insert": "Einspieler",
  "overlay.heroLabel.live": "Jetzt live",
  "overlay.heroLabel.reconnect": "Kurze Unterbrechung",
  "overlay.heroLabel.standby": "Gleich geht’s weiter",

  "overlay.nextLabel.asset": "Als Nächstes",
  "overlay.nextLabel.insert": "Danach",
  "overlay.nextLabel.reconnect": "Weiter mit",
  "overlay.nextLabel.live": "Danach",
  "overlay.nextLabel.fallback": "Als Nächstes",
  "overlay.next.timeRange": "{start}–{end}",
  "overlay.next.timeRangeInMinutes": "{start}–{end} · in {count} Min.",
  "overlay.next.timeRangeInHours": "{start}–{end} · in {count} Std.",
  "overlay.next.noBlock": "Noch nichts geplant",
  "overlay.meta.sourceUnknown": "Quelle folgt",
  "overlay.next.noTitle": "Programm folgt",
  "overlay.next.comingUp": "Gleich im Anschluss",
  "overlay.next.resumesShortly": "Das Programm geht gleich weiter",
  "overlay.countdown": "{seconds}s",

  "overlay.brand.channelName": "Stream247",
  "overlay.brand.replayLabel": "Wiederholung",
  "overlay.headline.asset": "Rund um die Uhr auf Sendung",
  "overlay.headline.insert": "Einspieler läuft",
  "overlay.headline.reconnect": "Der Stream verbindet sich neu – gleich geht’s weiter",
  "overlay.headline.standby": "Kurze Pause – gleich geht’s weiter",

  "overlay.title.standby": "Gleich geht’s weiter",
  "overlay.title.reconnect": "Geplanter Neustart",
  "overlay.title.untitledAsset": "Video aus {source}",

  "source.localLibrary": "Lokale Mediathek",

  "liveBridge.label": "Live-Schaltung",
  "liveBridge.category": "Live-Übertragung",
  "liveBridge.sourceLabel": "Live-Schaltung · {inputType}",
  "liveBridge.resumes": "Danach geht’s im Programm weiter",

  "textMode.now": "Jetzt: {title}",
  "textMode.next": "Als Nächstes: {title}",
  "textMode.insert": "Einspieler: {title}",
  "textMode.afterThis": "Danach: {titles}",
  "textMode.resumingWith": "Weiter mit: {title}",
  "textMode.queue": "Demnächst: {titles}",
  "textMode.current": "Gerade: {title}",
  "textMode.later": "Später: {titles}",

  "vote.headline": "Was läuft als Nächstes?",
  "vote.hint": "Schreib {tokens} in den Chat",
  "skip.headline": "Überspringen?",
  "skip.option": "Weiter zum nächsten Video",
  "skip.progress": { one: "{votes} von {count} Stimme", other: "{votes} von {count} Stimmen" },

  "game.name.snake": "Snake",
  "game.name.minesweeper": "Minesweeper",
  "game.name.2048": "2048",
  "game.headline": "Chat spielt {game}",
  // Shorter than a literal translation on purpose: the status chip shares the game header with the
  // headline, and "Spiel vorbei · Punkte: 60" next to "CHAT SPIELT MINESWEEPER" overflowed the
  // default game box where the English line still fit (measured, see the surfaces test).
  "game.status.score": { one: "{count} Punkt", other: "{count} Punkte" },
  "game.status.over": { one: "Vorbei · {count} Punkt", other: "Vorbei · {count} Punkte" },
  "game.status.cleared": { one: "Geschafft · {count} Punkt", other: "Geschafft · {count} Punkte" },
  // Not "{cleared} von {total} offen": "X von Y offen" is how German says "X of Y still to do", so a
  // viewer joining late read the uncovered count as the remaining one. "geschafft" counts what is
  // done and is the word the chip ends on when the board is cleared. The slash, not "von": the
  // natural "512 von 576 aufgedeckt" needs 589 px of the 540 the header has, "512/576 aufgedeckt"
  // 549; this one needs 531, where English takes 533.
  "game.status.progress": "{cleared}/{total} geschafft",
  "game.hint.arrowRestart": "Schick ein Pfeil-Emote für die nächste Runde",
  "game.hint.cellRestart": "Schick ein Feld wie b3 für die nächste Runde",
  "game.hint.snake": "Steuere mit {emotes} im Chat",
  "game.hint.2048": "Schieb mit {emotes} im Chat",
  "game.hint.minesweeper": "Deck ein Feld auf: Spalte und Zeile wie b3 – a bis {lastColumn}, 1 bis {lastRow}",

  "chat.presence.minimum": "{input} erhalten, Minimum ist {limit}; Fenster auf {minutes} Min. gesetzt",
  "chat.presence.maximum": "{input} erhalten, Maximum ist {limit}; Fenster auf {minutes} Min. gesetzt",
  "chat.presence.default": "{input} erhalten, Standard ist {limit}; Fenster auf {minutes} Min. gesetzt",
  "chat.presence.accepted": "Anwesenheitsfenster auf {minutes} Min. gesetzt",
  "chat.presence.saveFailed": "@{actor} dein Check-in konnte nicht gespeichert werden – versuch es gleich noch mal.",
  "chat.game.infoIdle":
    "Gerade läuft kein Spiel. Starte eins: {commands} – dann steuerst du mit {emotes}, oder schreib bei Minesweeper ein Feld wie b3. !game stop beendet eine Runde.",
  "chat.game.infoRunning": "{game} läuft gerade – {steering}. Weitere Spiele: {commands}. !game stop beendet die Runde.",
  "chat.game.steerCells": "schreib ein Feld wie b3",
  "chat.game.steerEmotes": "steuere mit {emotes}",
  "chat.game.unknownGame": "Ein Spiel",
  "chat.game.noRoom": {
    one: "Kein Platz für die Spielebene: Im Studio ist schon {count} Ebene. Entfern eine im Studio und versuch dann !{gameId} noch mal.",
    other: "Kein Platz für die Spielebene: Im Studio sind schon {count} Ebenen. Entfern eine im Studio und versuch dann !{gameId} noch mal."
  },
  "chat.game.moderatorOnly": "{actor}: Nur Mods können ein Spiel starten oder stoppen. Schreib !game, um zu sehen, was gerade läuft.",
  "chat.game.stopped": "Spiel beendet.",
  "chat.skip.pausedInsert": "Die Regie spielt gerade einen Einspieler – Überspringen ist pausiert, bis er vorbei ist.",
  "chat.skip.pausedFallback": "Die Regie hat das Ersatzprogramm auf Sendung – Überspringen ist pausiert, bis es vorbei ist.",
  "chat.skip.pausedPin": "Die Regie hat diesen Beitrag angepinnt – Überspringen ist pausiert, bis der Pin endet.",
  "chat.commands.list": "@{actor} Befehle: {commands}",
  "chat.commands.request": "{command} Titel",
  "chat.commands.vote": "!1–{last} während einer Abstimmung",
  "chat.now.onAir": "@{actor} gerade läuft: {title}.",
  "chat.now.nothing": "@{actor} gerade läuft nichts – kurze Pause, gleich geht’s weiter.",
  "chat.next.at": "@{actor} als Nächstes um {time}: {title}.",
  "chat.next.item": "@{actor} als Nächstes: {title}.",
  "chat.next.nothing": "@{actor} als Nächstes ist noch nichts geplant.",
  "chat.programmeLink": "Programm: {url}",
  "chat.request.queued": "@{actor} „{title}“ steht in der Warteschlange auf Platz {position}.",
  "chat.request.noMatch": "@{actor} dazu finde ich kein Video, das du dir wünschen kannst.",
  "chat.request.cooldownSeconds": {
    one: "@{actor} du kannst dir in {count} Sekunde wieder etwas wünschen.",
    other: "@{actor} du kannst dir in {count} Sekunden wieder etwas wünschen."
  },
  "chat.request.cooldownMinutes": {
    one: "@{actor} du kannst dir in {count} Minute wieder etwas wünschen.",
    other: "@{actor} du kannst dir in {count} Minuten wieder etwas wünschen."
  },
  "chat.request.queueFull": "@{actor} die Warteschlange für Wünsche ist voll – versuch es wieder, wenn ein Wunsch gelaufen ist.",
  "chat.request.alreadyQueued": "@{actor} „{title}“ steht schon in der Warteschlange.",
  "chat.viewerName": "Zuschauer",

  "channel.badge": "Programm",
  "channel.heading": "Was gerade läuft und was als Nächstes kommt.",
  // A colon, not "in": the zone's German name is nominative ("Mitteleuropäische Zeit"), and
  // "in Mitteleuropäische Zeit" is wrong German.
  "channel.timeZoneNote": "Alle Uhrzeiten: {timeZone}.",
  "channel.viewerTimeZoneNote": "Uhrzeiten in deiner Zeitzone: {viewerZone}. Sendezeit des Kanals: {channelZone}.",
  "channel.channelTime": "{range} Sendezeit",
  "channel.lineupTitle": "Demnächst im Programm",
  "channel.watch": "Zum Stream",
  "channel.onAirNow": "Jetzt auf Sendung",
  "channel.standby": "Gleich geht’s weiter",
  "channel.timeRange": "{start} bis {end}",
  "channel.upNext": "Als Nächstes",
  "channel.noNext": "Noch nichts angekündigt",
  "channel.noNextBody": "Sobald feststeht, was als Nächstes läuft, steht es hier.",
  "channel.scheduledNow": "Laut Programm jetzt",
  "channel.remaining": "noch {time}",
  "channel.more": { one: "{count} weiteres Video", other: "{count} weitere Videos" },
  "channel.weekTitle": "Die nächsten 7 Tage",
  "channel.weekEmpty": "Für die nächsten 7 Tage ist nichts geplant.",
  "channel.dated": "Sondersendung",
  "channel.today": "Heute",
  "channel.tomorrow": "Morgen",
  "channel.dayLabel": "{weekday}, {day}. {month}",
  "channel.weekday.0": "So",
  "channel.weekday.1": "Mo",
  "channel.weekday.2": "Di",
  "channel.weekday.3": "Mi",
  "channel.weekday.4": "Do",
  "channel.weekday.5": "Fr",
  "channel.weekday.6": "Sa",
  "channel.month.1": "Jan.",
  "channel.month.2": "Feb.",
  "channel.month.3": "März",
  "channel.month.4": "Apr.",
  "channel.month.5": "Mai",
  "channel.month.6": "Juni",
  "channel.month.7": "Juli",
  "channel.month.8": "Aug.",
  "channel.month.9": "Sept.",
  "channel.month.10": "Okt.",
  "channel.month.11": "Nov.",
  "channel.month.12": "Dez.",
  "channel.calendar": "Programm in den Kalender übernehmen",
  "channel.calendarName": "Programm von {channel}",
  "channel.status.onAir": "Auf Sendung",
  "channel.status.startingUp": "Startet gerade",
  "channel.status.offAir": "Gerade nicht auf Sendung",
  "channel.statusLine.onAir": "Läuft gerade.",
  "channel.statusLine.startingUp": "Der Stream startet, gleich geht’s weiter.",
  "channel.statusLine.offAir": "Der Kanal ist gerade nicht auf Sendung.",
  "channel.updateNotice": "Aktualisiert sich alle paar Sekunden"
};
