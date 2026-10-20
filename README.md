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
| `CALLCENTER_DAY_SECONDS` | `240` | Länge eines Arbeitstags (zum Testen) |

Jeder Anrufer bekommt eine eigene Persönlichkeit (Alter, Macke, Sprechweise, Schwäche, Abneigung). Claude antwortet pro Zug mit strukturiertem JSON: Antwort, Vertrauensänderung, ob aufgelegt wird, welche Masche erkannt wurde, und ob der Anrufer einer Aufforderung (Gutschein holen, Karte vorlesen) nachkommt. Codes und Kartennummern erzeugt immer das Spiel selbst. Server-seitige Fallbacks bei Ablehnungen sind aktiviert; schlägt ein Aufruf fehl, springt für diesen Zug die Offline-KI ein.

## Spielablauf

Ein ganz normaler Arbeitstag im Callcenter, in der Ich-Perspektive:

1. **Ins Büro**: Am PC mit <kbd>WASD</kbd> laufen, Maus zum Umsehen, <kbd>E</kbd> zum Benutzen, <kbd>Shift</kbd> zum Rennen. Am **Handy** links mit dem Joystick laufen, rechts wischen zum Umsehen, ✋ zum Benutzen. Dein Name steht an deinem Platz. 🪑 oben (oder <kbd>Tab</kbd>) springt direkt hin.
2. **Abnehmen**: Klingelt das Telefon (rote Lampe am Tisch, 📞 im HUD), nimm am PC ab. Der Anrufer meldet sich mit „Hallo?“.
3. **Vorstellen und überreden**: „Hallo, guten Tag, hier ist der Technik-Support …“. Sprich ins Mikrofon (🎤 oder <kbd>V</kbd> gedrückt halten, Chrome/Edge) oder tippe. Jeder Anrufer hat eine Schwäche (Charme, Druck, Autorität, Fachchinesisch) und etwas, das er hasst.
4. **Gutschein holen lassen**: „Holen Sie bitte eine Gutscheinkarte vom Kiosk.“ Ist das Vertrauen hoch genug, legt er den Hörer weg und geht los. Fragst du zu früh, kommt keine Antwort. Nach ein paar Sekunden: „Sind Sie wieder da?“, und er liest dir den Code vor. Er kann auch mehrmals gehen, solange er Geld hat.
5. **Oder Kreditkarte**: „Lesen Sie mir bitte Ihre Kreditkartennummer vor.“ Er liest Nummer, Ablaufdatum und Prüfnummer vor. Damit wird abgebucht, was er noch hat, aber bis Feierabend kann die Bank zurückbuchen.
6. **Einlösen am PC**: Code ins **Gutschein-Portal**, Kartendaten ins **Kartenterminal**. Bei aktiver Sprachausgabe stehen Codes und Nummern nicht im Chat, also gut zuhören und im **Notizblock** mitschreiben (🔁 liest nochmal vor).

Außerdem:

- **Scambaiter** machen verdächtig bereitwillig mit und verraten sich durch Kleinigkeiten (Tippgeräusche, Lachen, alberne Namen). Wer ihren Code einlöst, fängt sich einen Virus (−35 % der Tageseinnahmen). Rechtzeitig auflegen bringt Chef-Laune.
- **Der Chef** läuft regelmäßig durchs Büro. Wer dann nicht telefoniert, verdirbt ihm die Laune.
- **Handy**: Der PC am Platz ist in drei Reiter aufgeteilt (Anrufe, Gespräch, Einlösen). Beim Abnehmen springt er automatisch zum Gespräch.
- **Koop**: „Büro eröffnen“ erzeugt einen Code. Bis zu 6 Spieler teilen Büro, Quote und Kasse, sehen sich als Figuren mit Headset und können bei Kollegen mithören.
- **Feierabend**: Quote verfehlt oder Chef sauer → Verwarnung, drei Verwarnungen = gefeuert. Nicht eingelöste Codes verfallen. 25 % der Einnahmen gehen aufs Teamkonto für Upgrades (Headset, Spickzettel, Kaffeemaschine, Premium-Leads, Baiter-Radar, Antivirus, Wegwerf-Terminal, Kiosk-Kontakt).

## Aufbau

| Datei | Inhalt |
|---|---|
| `server/index.js` | HTTP-Server, REST-Aktionen, Live-Zustand per Server-Sent Events, liefert three.js aus |
| `server/game.js` | Spiellogik: Räume, Tagesablauf, Anrufer, Chef, Zahlungen, Shop |
| `server/ai.js` | Anrufer-KI: Claude und Offline-Fallback |
| `server/data.js` | Namen, Macken, Upgrades, Beispielsätze |
| `public/office3d.js` | Begehbares 3D-Büro (three.js): Schreibtische, Telefone, Chef, Kollegen, Whiteboard |
| `public/client.js` | PC-Oberfläche am Platz, Gespräch, Spracheingabe/-ausgabe, Gutschein-Portal, Kartenterminal |
| `public/index.html`, `public/style.css` | Bildschirme und Gestaltung |

Der Server ist maßgeblich für den Spielzustand, der Browser stellt nur dar und schickt Aktionen. Ein Solo-Spiel ist ein Büro mit einem Spieler.

Alle Figuren, Kartennummern (beginnen immer mit `0000`) und Codes sind frei erfunden und absichtlich absurd. Das Spiel ist Satire.
