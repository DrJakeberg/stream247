/**
 * English viewer messages: the reference catalogue (M80).
 *
 * Everything a viewer sees on the picture or reads in chat comes from here or from its German twin
 * in de.ts. The admin interface does not: it stays English until M81, and operator content (titles,
 * scene text layers, the ticker) is never translated at all.
 *
 * The keys of this object are the catalogue's type, so a key missing from another language is a
 * compile error there and a parity-test failure here. Placeholders are `{name}`; a value written as
 * `{ one, other }` is chosen by the `count` parameter through Intl.PluralRules.
 *
 * The English texts are the strings that were on air before M80, byte for byte, except where M80
 * fixed the wording on purpose — each such entry says what it replaced.
 */
export const EN_VIEWER_MESSAGES = {
  // The chip on the lower third, by what is on air.
  "overlay.heroLabel.asset": "Now Playing",
  "overlay.heroLabel.insert": "Insert On Air",
  "overlay.heroLabel.live": "Live Now",
  "overlay.heroLabel.reconnect": "Reconnect Window",
  // Was "Standby": one term for the standby state, the same as overlay.title.standby.
  "overlay.heroLabel.standby": "Stand by",

  // The next card's heading; the layout falls back to the last one when a payload carries none.
  "overlay.nextLabel.asset": "Next",
  "overlay.nextLabel.insert": "After Insert",
  "overlay.nextLabel.reconnect": "Returning With",
  "overlay.nextLabel.live": "After Live",
  "overlay.nextLabel.fallback": "Up next",
  "overlay.next.timeRange": "{start}-{end}",
  // M100 (V7): the bare range said nothing about how soon; under an hour minutes, under a day hours.
  "overlay.next.timeRangeInMinutes": "{start}-{end} · in {count} min",
  "overlay.next.timeRangeInHours": "{start}-{end} · in {count} h",
  // M107: when the next video is expected to start, i.e. when the one on air is expected to end. Only
  // "about": a video starts when the one before it ends, and that is a planned length, not a timetable.
  "overlay.next.expectedAt": "about {time}",
  // Was "No next block configured" (an operator's word on air) and, as the payload's own fallback,
  // "Nothing scheduled next" — two sentences for one state.
  "overlay.next.noBlock": "Nothing scheduled",
  // The studio preview's stand-in for an unknown source; the broadcast leaves the slot empty.
  "overlay.meta.sourceUnknown": "Source to be announced",
  "overlay.next.noTitle": "Schedule not available",
  "overlay.next.comingUp": "Coming up next",
  // The studio preview said "Program resumes shortly"; the broadcast's wording wins.
  "overlay.next.resumesShortly": "Programming will resume shortly",
  "overlay.countdown": "{seconds}s",

  // Stored defaults (packages/db). A stored value equal to its English default is rendered from
  // here in the channel language; see localizeViewerBuiltInText.
  "overlay.brand.channelName": "Stream247",
  "overlay.brand.replayLabel": "Replay stream",
  "overlay.headline.asset": "Always on air",
  "overlay.headline.insert": "Insert on air",
  "overlay.headline.reconnect": "Scheduled reconnect in progress",
  // Was "Please wait, restream is starting": "restream" is the operator's machinery, and the state
  // now has one name.
  "overlay.headline.standby": "Stand by, we’ll be right back",

  // Titles the worker writes when nothing titled is on air. Was "Replay standby" as well.
  "overlay.title.standby": "Stand by",
  "overlay.title.reconnect": "Scheduled reconnect",
  "overlay.title.untitledAsset": "{source} item",

  // The local library's source name. The worker writes it into the sources table on every scan, in
  // English for the admin, and the lower third's meta line shows it; see localizeViewerBuiltInText.
  "source.localLibrary": "Local Media Library",

  "liveBridge.label": "Live Bridge",
  "liveBridge.category": "Live input",
  "liveBridge.sourceLabel": "Live Bridge · {inputType}",
  "liveBridge.resumes": "Schedule resumes after live mode",

  // Text mode and the standby slate, drawn by ffmpeg when no scene picture is on air.
  "textMode.now": "Now: {title}",
  "textMode.next": "Next: {title}",
  "textMode.insert": "Insert: {title}",
  "textMode.afterThis": "After this: {titles}",
  "textMode.resumingWith": "Resuming with: {title}",
  "textMode.queue": "Queue: {titles}",
  "textMode.current": "Current: {title}",
  "textMode.later": "Later: {titles}",

  // The poll and the skip campaign. Before M80 these were German on every channel.
  "vote.headline": "What plays next?",
  "vote.hint": "Type {tokens} in chat",
  "skip.headline": "Skip?",
  "skip.option": "Move on to the next video",
  "skip.progress": { one: "{votes} of {count} vote", other: "{votes} of {count} votes" },

  // Chat game panels. The names are the viewer's; the studio keeps CHAT_GAMES' own labels.
  "game.name.snake": "Snake",
  "game.name.minesweeper": "Minesweeper",
  "game.name.2048": "2048",
  "game.headline": "Chat plays {game}",
  "game.status.score": "Score {count}",
  "game.status.over": "Game over · Score {count}",
  "game.status.cleared": "Board cleared · Score {count}",
  "game.status.progress": "Cleared {cleared} of {total}",
  "game.hint.arrowRestart": "Send any arrow emote to start the next round",
  "game.hint.cellRestart": "Send a cell like b3 to start the next round",
  "game.hint.snake": "Steer with {emotes} in chat",
  "game.hint.2048": "Merge with {emotes} in chat",
  "game.hint.minesweeper": "Dig with column and row like b3 — a to {lastColumn}, 1 to {lastRow}",

  // Chat bot replies. Command words (!game, !here, stop, the game ids) stay untranslated in every
  // language: they are what the bot listens for.
  "chat.presence.minimum": "received {input}, minimum is {limit}; window set to {minutes} min",
  "chat.presence.maximum": "received {input}, maximum is {limit}; window set to {minutes} min",
  "chat.presence.default": "received {input}, default is {limit}; window set to {minutes} min",
  "chat.presence.accepted": "presence window set to {minutes} min",
  "chat.presence.saveFailed": "@{actor} your check-in could not be saved — please try again in a moment.",
  "chat.game.infoIdle":
    "No game is running. Start one: {commands} — then steer with {emotes}, or type a cell like b3 in Minesweeper. !game stop ends a round.",
  "chat.game.infoRunning": "{game} is on air — {steering}. Other games: {commands}. !game stop ends the round.",
  "chat.game.steerCells": "type a cell like b3",
  "chat.game.steerEmotes": "steer with {emotes}",
  "chat.game.unknownGame": "A game",
  // The "one" form is new: a cap of one layer used to read "1 layers".
  "chat.game.noRoom": {
    one: "No room for the game layer: the studio already has {count} layer. Remove one in the studio, then try !{gameId} again.",
    other: "No room for the game layer: the studio already has {count} layers. Remove one in the studio, then try !{gameId} again."
  },
  "chat.game.moderatorOnly": "{actor}: only a moderator can start or stop a game. Type !game to see what is running.",
  "chat.game.stopped": "Game stopped.",
  "chat.skip.pausedInsert": "The operator is playing an insert — skip votes are paused until it ends.",
  "chat.skip.pausedFallback": "The operator has put the fallback on air — skip votes are paused until it ends.",
  "chat.skip.pausedPin": "The operator has pinned this item — skip votes are paused until the pin ends.",
  // The answers viewers can ask for (M104): !commands, !now, !next, and one per !request.
  "chat.commands.list": "@{actor} commands: {commands}",
  "chat.commands.request": "{command} title",
  "chat.commands.vote": "!1–{last} during a poll",
  "chat.now.onAir": "@{actor} now on air: {title}.",
  "chat.now.nothing": "@{actor} nothing is playing right now — stand by, we’ll be right back.",
  "chat.next.at": "@{actor} next at {time}: {title}.",
  "chat.next.item": "@{actor} up next: {title}.",
  // M107: the next video with the time it is expected to start (overlay.next.expectedAt's estimate).
  "chat.next.around": "@{actor} next at about {time}: {title}.",
  "chat.next.nothing": "@{actor} nothing further is scheduled yet.",
  "chat.programmeLink": "Programme: {url}",
  "chat.request.queued": "@{actor} “{title}” is in the queue at position {position}.",
  "chat.request.noMatch": "@{actor} no requestable video matches that title.",
  "chat.request.cooldownSeconds": {
    one: "@{actor} you can request again in {count} second.",
    other: "@{actor} you can request again in {count} seconds."
  },
  "chat.request.cooldownMinutes": {
    one: "@{actor} you can request again in {count} minute.",
    other: "@{actor} you can request again in {count} minutes."
  },
  "chat.request.queueFull": "@{actor} the request queue is full — try again once a request has played.",
  "chat.request.alreadyQueued": "@{actor} “{title}” is already in the queue.",
  // The on-air chat panel's name for a message that arrived without one.
  "chat.viewerName": "Viewer",

  // The public page /channel and its tab (apps/web/lib/public-channel-view.ts builds it).
  "channel.badge": "Schedule",
  "channel.heading": "What is live now, and what comes next.",
  // {timeZone} is the zone's name in the channel language ("Central European Time"), not the IANA
  // id the page printed before M80.
  "channel.timeZoneNote": "All times are shown in {timeZone}.",
  // M100: the viewer's own zone first, the channel's second (owner default R2 Q7).
  "channel.viewerTimeZoneNote": "Times are shown in your time zone, {viewerZone}. Channel time: {channelZone}.",
  "channel.channelTime": "{range} channel time",
  "channel.lineupTitle": "Upcoming lineup",
  "channel.watch": "Watch the stream",
  "channel.onAirNow": "On air now",
  // Was "Standby": the same standby term as on air.
  "channel.standby": "Stand by",
  "channel.timeRange": "{start} to {end}",
  "channel.upNext": "Up next",
  "channel.noNext": "No next item published yet",
  // Was "...as soon as the runtime confirms it." — the runtime is the operator's machinery.
  "channel.noNextBody": "The next item will appear here as soon as it is confirmed.",
  // M100: the item on air and the next 24 hours of items, grouped by programme.
  "channel.scheduledNow": "Scheduled now",
  "channel.remaining": "{time} left",
  "channel.more": { one: "{count} more video", other: "{count} more videos" },
  "channel.weekTitle": "The next 7 days",
  "channel.weekEmpty": "Nothing is scheduled for the next 7 days.",
  // A block with dates of its own (once, or between two dates) rather than every week.
  "channel.dated": "Special",
  "channel.today": "Today",
  "channel.tomorrow": "Tomorrow",
  "channel.dayLabel": "{weekday} {day} {month}",
  "channel.weekday.0": "Sun",
  "channel.weekday.1": "Mon",
  "channel.weekday.2": "Tue",
  "channel.weekday.3": "Wed",
  "channel.weekday.4": "Thu",
  "channel.weekday.5": "Fri",
  "channel.weekday.6": "Sat",
  "channel.month.1": "Jan",
  "channel.month.2": "Feb",
  "channel.month.3": "Mar",
  "channel.month.4": "Apr",
  "channel.month.5": "May",
  "channel.month.6": "Jun",
  "channel.month.7": "Jul",
  "channel.month.8": "Aug",
  "channel.month.9": "Sep",
  "channel.month.10": "Oct",
  "channel.month.11": "Nov",
  "channel.month.12": "Dec",
  "channel.calendar": "Add the schedule to your calendar",
  // The calendar feed /channel.ics: its name in a calendar app.
  "channel.calendarName": "{channel} schedule",
  "channel.status.onAir": "On air",
  "channel.status.startingUp": "Starting up",
  "channel.status.offAir": "Off air",
  // Under "On air now" when no schedule block covers the hour. Was the playout's own status message
  // ("Crash-loop protection is active.", "Playout engine has not started yet."), written for the
  // operator; the viewer gets the state in their words instead.
  "channel.statusLine.onAir": "Playing now.",
  "channel.statusLine.startingUp": "The stream is starting, back in a moment.",
  "channel.statusLine.offAir": "The channel is off air right now.",
  "channel.updateNotice": "Updating every few seconds"
} as const;
