# ☎️ Call Center

Ein satirisches Koop-Spiel für 1 bis 6 Spieler im Browser. Ihr arbeitet in einem absurden Fake-Support-Callcenter, sprecht mit KI-gesteuerten Anrufern, müsst die Tagesquote schaffen, den Chef bei Laune halten und dürft nicht auf Scambaiter reinfallen.

## Starten

```bash
npm install
npm start
# dann http://localhost:3000 öffnen
```

### KI-Anrufer mit Claude

Ohne API-Key läuft eine eingebaute Offline-KI (Stichwort-Erkennung). Für echte, frei improvisierende Anrufer:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```

| Variable | Standard | Bedeutung |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Aktiviert Claude für die Anrufer |
| `CALLCENTER_MODEL` | `claude-opus-5-5` | Modell für die Anrufer |
| `CALLCENTER_EFFORT` | `low` | Denkaufwand (`low` hält die Antwortzeit kurz) |
| `CALLCENTER_AI` | automatisch | `offline` erzwingt die Offline-KI |
| `PORT` | `3000` | Server-Port |
| `CALLCENTER_DAY_SECONDS` | `180` | Länge eines Arbeitstags (zum Testen) |

Jeder Anrufer bekommt eine eigene Persönlichkeit (Alter, Macke, Sprechweise, Schwäche, Abneigung). Claude antwortet pro Zug mit strukturiertem JSON: Antwort, Vertrauensänderung, ob aufgelegt wird, und welche Masche erkannt wurde. Server-seitige Fallbacks bei Ablehnungen sind aktiviert; schlägt ein Aufruf fehl, springt für diesen Zug die Offline-KI ein.

## Spielablauf

- **Koop**: „Büro eröffnen“ erzeugt einen 4-stelligen Code, Freunde treten mit dem Code bei. Quote und Anrufaufkommen wachsen mit der Spielerzahl. Ihr seht, wer gerade telefoniert, und könnt bei Kollegen **mithören**.
- **Sprechen**: 🎤 anklicken oder Taste <kbd>V</kbd> gedrückt halten (Chrome/Edge). Alternativ tippen. Die Anrufer antworten mit Stimme (Sprachausgabe des Browsers), ein- und ausschaltbar über 🔊.
- **Überzeugen**: Jeder Anrufer hat eine Schwäche (Charme, Druck, Autorität, Fachchinesisch) und eine Abneigung. Vertrauen rauf, bevor die Geduld aufgebraucht ist. Der 📝 Spickzettel liefert Beispielsätze.
- **Bezahlen** bei 100 % Vertrauen:
  - **💳 Kreditkarte**: Der Anrufer liest die (frei erfundenen) Kartendaten vor. Bei aktiver Sprachausgabe werden sie im Chat verdeckt, also gut zuhören und ins Terminal tippen. Volle Summe, aber bis Feierabend kann die Bank zurückbuchen.
  - **🎁 Gutscheinkarten**: Der Anrufer geht zum Kiosk, die Kassiererin wird misstrauisch, und du musst ihm sagen, was er antworten soll. Danach im **Fernzugriff** die Pop-ups wegklicken und die Codes einlösen. 90 % Wert, dafür keine Rückbuchung.
- **Scambaiter**: vertrauen verdächtig schnell und lassen Hinweise fallen (Tippgeräusche, Lachen, falsche Namen). Rechtzeitig auflegen bringt Chef-Laune, sonst kostet ein Virus 35 % der Tageseinnahmen.
- **Chef**: kommt zufällig vorbei. Wer dann nicht telefoniert, verdirbt ihm die Laune.
- **Mitarbeitergespräch**: Quote verfehlt oder Chef zu schlecht gelaunt → Verwarnung. Drei Verwarnungen = gefeuert.
- **Pausenraum-Shop**: 25 % der Einnahmen gehen aufs Teamkonto. Upgrades: Headset, Spickzettel, Kaffeemaschine, zweiter Monitor, Baiter-Radar, Antivirus, Wegwerf-Terminal, Kiosk-Kontakt.

## Aufbau

| Datei | Inhalt |
|---|---|
| `server/index.js` | HTTP-Server, REST-Aktionen, Live-Zustand per Server-Sent Events |
| `server/game.js` | Spiellogik: Räume, Tagesablauf, Anrufer, Chef, Zahlungen, Shop |
| `server/ai.js` | Anrufer-KI: Claude und Offline-Fallback |
| `server/data.js` | Namen, Macken, Upgrades, Beispielsätze |
| `public/index.html`, `public/style.css`, `public/client.js` | Oberfläche, Spracheingabe/-ausgabe, Minispiele |

Der Server ist maßgeblich für den Spielzustand, der Browser stellt nur dar und schickt Aktionen. Ein Solo-Spiel ist ein Büro mit einem Spieler.

Alle Figuren, Kartennummern (beginnen immer mit `0000`) und Codes sind frei erfunden und absichtlich absurd. Das Spiel ist Satire.
