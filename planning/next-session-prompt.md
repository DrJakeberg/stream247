# Prompt für die Folge-Session

Kopiere den Block unterhalb der Trennlinie als erste Nachricht in eine neue Session.

---

Du übernimmst die Weiterentwicklung von **Stream247** (`/home/benjamin/code/stream247`), einer
selbst gehosteten 24/7-Twitch-Plattform. Arbeite eigenständig weiter und pausiere nur, wenn eine
Entscheidung wirklich irreversibel ist oder eine Frage die Richtung grundlegend ändert.

## Ausgangslage

Produktion läuft auf **v1.5.19** (DUT, `ssh dut`, Stack `stream247`). Der Kanal lief zuvor 38
Stunden in einer Playout-Restart-Schleife (674 Restarts) und ist seit dem Deploy stabil:
`restarts=0`, keine `worker.loop.stalled`, keine `scene.render.fallback`.

Behoben in v1.5.19: ein aus dem Internet ausnutzbarer Workspace-Takeover über den ungeschützten
Twitch-OAuth-Callback, die Restart-Schleife (VOD-Download lief inline im Playout-Cycle), der
`APP_SECRET`-Fallback auf eine veröffentlichte Konstante, Path-Traversal beim Upload, fehlendes
Rate-Limit auf Login/TOTP, vier Worker-Ausfallpfade, eine blinde Health-Route, Blöcke über
Mitternacht, IRC-Half-Open. Neu: nativer Overlay-Renderer (satori/resvg statt Chromium-Screenshot)
und Chat-Steuerung (Voting, `!request`, `!skip`) — letztere ist standardmäßig **aus**.

## Offene Entscheidung: Twitch-VOD-Cache

Der Kanal spielt seit dem 19.08. sein Programm **direkt von Twitch**
(`TWITCH_VOD_CACHE_ALLOW_REMOTE_FALLBACK=1`), weil die VODs grösser sind als das Cache-Limit und
deshalb nie fertig heruntergeladen wurden. Vorher lief er dauerhaft auf Fallback-Inhalten.

`TWITCH_VOD_CACHE_MAX_BYTES` steht auf dem Standard von 20 GB, die VODs liegen bei 20+ GB, die
Platte hat 101 GB frei. Selbst mit dem Prune-Fix passt kaum ein VOD hinein und der naechste
verdraengt ihn. Zu klaeren: Limit deutlich anheben, oder diese Quelle bewusst als Direkt-Stream
fuehren und gar nicht cachen. Direktes Streamen haengt an signierten URLs, die waehrend der
Wiedergabe ablaufen koennen — v1.5.14 verwirft dafuer den Probe-Cache und loest neu auf.

## Was zuerst prüfen

Overlay-Renderer und Chat-Verdrahtung sind **erstmals unter Last**. Beide sind durch Unit-Tests und
visuelle Prüfung abgedeckt, aber in Produktion unerprobt. Verifiziere zuerst:

```bash
ssh dut 'docker inspect -f "restarts={{.RestartCount}}" stream247-playout-1'
ssh dut 'docker logs --since 30m stream247-playout-1 2>&1 | grep -o "\"event\":\"[^\"]*\"" | sort | uniq -c | sort -rn'
```

`playout.boundary.fallback_bridge` heisst: der Kanal spielt Fallback statt seines Programms —
Restart-Freiheit allein ist noch kein gesunder Kanal. Pruefe im Zweifel den echten ffmpeg-Input:
`ssh dut 'docker exec stream247-playout-1 sh -lc "ps -o args | grep ^ffmpeg"'`.

`scene.render.fallback` darf nicht auftauchen — das hieße, das Overlay ist stumm im Textmodus.
Notausgang ohne Stream-Unterbrechung: `SCENE_RENDERER_ENABLED=0` in der Stack-Env.

## Aufgaben, in dieser Reihenfolge

1. **Stabilität überwachen und Regressionen beheben.** `./scripts/soak-monitor.sh` existiert.
   Besonderes Augenmerk auf Overlay-Renderer und den Twitch-VOD-Hintergrundjob (`vod.cache.job.*`).
2. **Restliche Audit-Befunde** (~20 bestätigte, mittlere Schwere): Blueprint-Import macht
   Read-Modify-Write auf den ganzen AppState ohne Sperre und überschreibt die Live-Playout-Runtime;
   `presence_windows` nutzt `expires_at` als Primärschlüssel, kollidierende Check-ins werfen 23505
   und töten den Chat-Callback; EventSub behandelt Revocations als echte Notifications; EventSub-Sync
   ignoriert `subscription.status`; Broadcaster-Token wird nur bei aktivem Playout refresht;
   Schedule-Vorschau weicht von der tatsächlichen Playout-Auswahl ab.
3. **Design-Konsolidierung fortsetzen.** Farbliterale stehen bei 100 (von ursprünglich 185). Nächste
   Schritte: die sieben parallelen Zustandsvokabulare (`status-chip-*`, `badge-*`,
   `programming-status-*`, `schedule-block-*`, `toast-*`, `.warning`/`.danger`, `.field-error`) auf
   eines zusammenführen; `Card`/`Panel` und `PageHeader`/`AdminPageHeader` entdoppeln.
4. **Planungsfeature.** Template-Anwendung umgeht die Kollisionsprüfung und sperrt den Editor
   dauerhaft; TOCTOU bei gleichzeitigen Edits; Video-Timeline im Day-Lens an 6 von 7 Tagen leer.

## Umgebung

```bash
scripts/dev-stack.sh up                 # langlebiger Stack + festes Fixture, Port 3020
scripts/dev-stack.sh up --with-runtime  # zusätzlich worker/playout/uplink
scripts/design-baseline.sh              # visuelle Prüfung (24 Snapshots)
scripts/design-baseline.sh --update     # Baseline neu erzeugen
pnpm validate                           # lint, css-token-lint, typecheck, 562 Tests, build
```

Der Dev-Stack lässt worker/playout/uplink **absichtlich** aus: Sie schreiben laufend Heartbeats und
Readiness um, wodurch die UI nicht deterministisch wäre. Ohne sie sind drei Readiness-Abrufe
bytegleich.

## Deploy

Portainer ist die einzige Kontrollebene für Produktion. Die API ist **nicht** über
`https://po.h.3jc.de` erreichbar (OAuth2-Proxy liefert 404 auf `/api/`), und das Zertifikat dort ist
seit 18.08.2026 abgelaufen. Funktionierender Weg — über die Netzwerk-Namespace des Containers:

```bash
ssh dt 'KEY=$(cat ~/.pt-key); docker run --rm -e KEY="$KEY" --entrypoint sh \
  --network container:portainer2-portainer-1 curlimages/curl:latest \
  -c "curl -s -H \"X-API-Key: \$KEY\" http://127.0.0.1:9000/api/stacks/148"'
```

Stack-Id 148, EndpointId 3. Update per `PUT /api/stacks/148?endpointId=3` mit
`{env, stackFileContent, prune:false, pullImage:true}`; die Nutzlast über **stdin** (`--data-binary @-`)
reichen, denn Volume-Mounts aus dem Home-Verzeichnis funktionieren auf `dt` nicht.

Der API-Key liegt auf `dt` unter `~/.pt-key` (Modus 600). **Er stand im Klartext in einem
Chatverlauf — kläre mit dem Nutzer, ob er rotiert werden soll.**

Vor jedem Deploy prüfen: `APP_SECRET` muss ≥32 Zeichen haben, sonst startet die Web-App nicht
(bewusst, der alte Fallback war eine veröffentlichte Konstante). Rollback: dieselben drei Image-Tags
zurücksetzen — Migrationen legen nur neue Tabellen an, ältere Versionen laufen mit dem migrierten
Schema weiter.

## Fallen, die in der Vorsession Zeit gekostet haben

- **Snapshots sind nicht portabel.** Playwright nennt sie `chromium-linux`, aber Desktop und
  GitHub-Runner rendern unterschiedlich. Deshalb läuft die visuelle Suite im offiziellen
  Playwright-Image. Baseline immer über `scripts/design-baseline.sh` erzeugen *und* prüfen — dasselbe
  Skript besitzt beide Seiten, damit sie nicht auseinanderlaufen.
- **`e2e-smoke.sh` baut keine Images.** Es nutzt das vorhandene `stream247-web:test`. Eine Baseline
  gegen ein veraltetes Image beschreibt den Code nicht mehr.
- **`admin-smoke.spec.ts` schaltet 2FA für den Owner ein.** Jede Spec, die danach im selben Stack
  eine Anmeldung versucht, scheitert. Deshalb laufen beide in getrennten Stacks.
- **Compose führt Listen zusammen, statt sie zu ersetzen.** `ports`, `env_file` und `volumes` brauchen
  `!override`, sonst erbt der Test-Stack die Werte der Basisdatei.
- **Docker ist lokal rootless, auf den Servern rootful.** `--user` bildet in entgegengesetzte
  Richtungen ab; Container-Aufrufe ohne `--user` funktionieren in beiden Modi.

## Arbeitsweise

Nach jeder abgeschlossenen Aufgabe committen und pushen, dann `gh run watch --exit-status`
blockierend abwarten statt den Ausgang zu raten. Bei Fehlschlag Logs holen, Ursache finden, beheben.

Wenn ein bestehender Test dem Code widerspricht: **prüfe, welcher von beiden recht hat.** In der
Vorsession kodierten zwei Schedule-Tests nachweislich falsches Verhalten (ein Block Mittwoch
23:00–01:00 sollte bereits Mittwoch 00:30 laufen, 23 Stunden zu früh).
