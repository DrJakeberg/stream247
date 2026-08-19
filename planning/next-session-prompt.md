# Prompt für die Folge-Session

Kopiere den Block unterhalb der Trennlinie als erste Nachricht in eine neue Session.

---

Du übernimmst die Weiterentwicklung von **Stream247** (`/home/benjamin/code/stream247`), einer
selbst gehosteten 24/7-Twitch-Plattform. Arbeite eigenständig weiter und pausiere nur, wenn eine
Entscheidung wirklich irreversibel ist oder eine Frage die Richtung grundlegend ändert.

## Ausgangslage

Produktion läuft auf **v1.5.22** (DUT, `ssh dut`, Stack `stream247`). Zuletzt gemessen: Programm-Feed
100 % Echtzeit, A/V-Versatz 0,18 ms, 0 Neustarts, 0 Diskontinuitäten.

Drei Produktionsfehler wurden am 19.08. gefunden und behoben:

1. **Halbe Echtzeit.** Die Overlay-Pipe ist als 1 fps deklariert, bekam aber nur alle 2000 ms einen
   Frame. Da `overlay` erst ausgibt, wenn *beide* Eingänge einen Frame haben, drosselte das den
   gesamten Encode auf 50 %. Writer und Renderer laufen jetzt getrennt, der Writer taktet nach
   Wanduhr mit festem Vorlauf.
2. **Uplink lief, produzierte aber nicht.** Nach einem Playout-Neustart beginnen die Zeitstempel des
   Feeds von vorn; der langlebige Uplink liest über die Naht und korrigiert Audio und Video auf
   *getrennte* Zeitachsen (~117 s auseinander). Er erholt sich nie von selbst. Zwei Wächter fangen
   das jetzt ab: `out_time`-Stillstand und ein Diskontinuitätssturm (>120/min). Beide haben in
   Produktion bereits ausgelöst und repariert.
3. **Teardown tötete den Worker.** Die fd-3-Pipe hatte keinen `error`-Listener; beim Herunterfahren
   verlor sie ihren Leser und die unbehandelte Ausnahme beendete den Prozess — bei *jedem*
   Asset-Wechsel. Mit echtem ffmpeg reproduziert: 3/3 Absturz ohne, 3/3 überlebt mit Fix.

**VOD-Cache-Richtlinie** (v1.5.22, vom Nutzer so festgelegt): unter 20 GB cachen und nach der
Wiedergabe freigeben, darüber direkt von Twitch streamen. Auf DUT verifiziert — zwei VODs mit 23,2
und 23,1 GB wurden korrekt als `too-large` eingestuft und nicht geladen.

Wichtig dabei: **Twitch meldet keine Dateigröße** (`filesize` und `filesize_approx` sind immer `NA`).
Die Größe wird aus `tbr × duration` geschätzt. `--max-filesize` wurde entfernt, weil yt-dlp es für
fragmentiertes HLS gar nicht auswertet (gemessen: 95 MB gegen ein 1-MiB-Limit).

## Was zuerst prüfen

```bash
ssh dut 'docker inspect -f "restarts={{.RestartCount}}" stream247-playout-1'
ssh dut 'docker logs --since 5m stream247-uplink-1 2>&1 | grep -ci discontinuity'
```

Eine anhaltende Diskontinuitätsrate über ~100/min bedeutet auseinanderlaufenden Ton. Der Wächter
sollte das binnen einer Minute selbst beheben (`uplink.discontinuity_storm.restart`); tut er es
nicht, ist die Schwelle falsch kalibriert.

**`docker stats --no-stream` ist unbrauchbar**, um zu beurteilen, ob der Uplink encodiert. Zwei
Stichproben desselben gesunden Prozesses lasen 0,05 % und 17,43 %, der 30-Sekunden-Mittelwert lag bei
99 %. Miss `cpu.stat` über ein Fenster oder die Interface-Zähler.

## Offene Aufgaben

1. **Visuelle Gestaltung.** Das Einzige aus dem ursprünglichen Auftrag, das offen ist. Der Nutzer
   hatte „konsolidieren statt neu erfinden" gewählt, und die Konsolidierung ist durch: Farbliterale
   von 185 auf 93, sieben Zustandsvokabulare auf fünf Töne (`--tone-*`), drei nie eingeführte
   Design-System-Primitive entfernt. Ein echter gestalterischer Neuentwurf von Admin, Overlay und
   Kanalseite braucht die Richtung des Nutzers — frag danach, statt zu raten.
2. **Kontrast vor Farbe.** Es gibt `tests/unit/design-contrast.test.ts` (liest `globals.css`, kennt
   nur hex/rgba) und `tests/unit/design-tones.test.ts` (löst die Kanal-Syntax
   `rgb(var(--x-rgb) / 0.12)` auf). Miss jede neue Paarung, bevor du sie festlegst — das Projekt
   hält Statustext auf 4,5:1.
3. **Teildownloads auf DUT.** 13,8 GB verwaiste Partials von einem abgebrochenen Download liegen im
   Cache. v1.5.23 sammelt sie ein; nach dem Deploy prüfen, ob sie verschwinden.

## Umgebung

```bash
scripts/dev-stack.sh up                 # langlebiger Stack, Port 3020, mit gepinnter Playout-Runtime
scripts/design-baseline.sh              # visuelle Prüfung (28 Snapshots)
scripts/design-baseline.sh --update     # Baseline neu erzeugen
pnpm validate                           # lint, css-token-lint, typecheck, Tests, build
```

Der Dev-Stack lässt worker/playout/uplink **absichtlich** aus und sät stattdessen eine feste
Playout-Runtime (`scripts/seed-playout-runtime.mjs`), damit die Live-Seiten einen laufenden Kanal
zeigen statt „nichts on air". Deshalb sind `/live?tab=status` und `?tab=control` seit v1.5.23 in der
visuellen Suite; sie waren vorher wegen Flakiness ausgeschlossen.

## Deploy

Portainer ist die einzige Kontrollebene. Die API ist **nicht** über `https://po.h.3jc.de` erreichbar;
der Weg führt über die Netzwerk-Namespace des Containers auf `dt`:

```bash
ssh dt 'KEY=$(cat /root/.pt-key); docker run --rm -e KEY="$KEY" --entrypoint sh \
  --network container:portainer2-portainer-1 curlimages/curl:latest \
  -c "curl -s -H \"X-API-Key: \$KEY\" http://127.0.0.1:9000/api/stacks/148"'
```

Stack 148, Endpoint 3. Update per `PUT /api/stacks/148?endpointId=3` mit
`{env, stackFileContent, prune:false, pullImage:true}`, Nutzlast über **stdin** (`--data-binary @-`).
Die laufende Version steuern die Env-Variablen `STREAM247_{WEB,WORKER,PLAYOUT}_IMAGE`, nicht die
Defaults in der Compose-Datei.

**Der API-Key stand im Klartext in einem Chatverlauf — kläre mit dem Nutzer, ob er rotiert wird.**

## Fallen, die Zeit gekostet haben

- **Das SSH-Zertifikat hält ~8 Stunden.** `Permission denied (publickey)` auf dut/dt heißt meistens
  nur, dass es abgelaufen ist: `ssh-keygen -L -f ~/.ssh/id_ed25519_homelab-cert.pub | grep -i valid`.
  Erneuern kann nur der Nutzer (Vault-OIDC).
- **CI serialisiert über `concurrency: ci-${{ github.ref }}`.** Ein neuer Push stellt sich hinter den
  laufenden Lauf. Stehen veraltete Läufe vorne, brich sie ab (`gh run cancel`), sonst wartest du
  zwanzig Minuten auf nichts.
- **Snapshots sind nicht portabel.** Die visuelle Suite läuft im offiziellen Playwright-Image;
  Baseline immer über `scripts/design-baseline.sh` erzeugen *und* prüfen.
- **Compose führt Listen zusammen.** `ports`, `env_file` und `volumes` brauchen `!override`.

## Arbeitsweise

Nach jeder abgeschlossenen Aufgabe committen und pushen, dann `gh run watch --exit-status`
blockierend abwarten statt den Ausgang zu raten.

Wenn ein bestehender Test dem Code widerspricht: **prüfe, welcher von beiden recht hat.**

Und miss, bevor du schließt. In dieser Session wurden mehrere Fehler nur deshalb gefunden, weil eine
gegnerische Prüfung sie gegen echte Systeme reproduziert hat statt sie zu erschließen — zwei davon
hätten die Cache-Richtlinie still wirkungslos gemacht.
