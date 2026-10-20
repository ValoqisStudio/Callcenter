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

1. **Ins Büro**: Am PC mit <kbd>WASD</kbd> laufen, Maus zum Umsehen, <kbd>E</kbd> zum Benutzen, <kbd>Shift</kbd> zum Rennen. Am **Handy** links mit dem Joystick laufen, rechts wischen, ✋ zum Benutzen. Dein Name steht an deinem Platz; 🪑 oben (oder <kbd>Tab</kbd>) springt direkt hin.
2. **Telefon**: Am Platz erscheint dein Telefon. Klingelt es, nimmst du mit dem grünen Knopf ab (rot lehnt ab). Während des Gesprächs siehst du oben die **Vertrauensleiste**, die Anrufdauer und den aktuellen Satz des Anrufers als Untertitel.
3. **Reden**: **Freisprechen** ist an. Einfach sprechen („Hallo, guten Tag, mein Name ist Johannes, wir haben Viren auf Ihrem Computer festgestellt …“), nach einer kurzen Pause wird automatisch gesendet; während der Anrufer spricht, pausiert das Mikro. ⌨️ öffnet ein Textfeld mit Spickzettel, 🔁 wiederholt den letzten Satz, 📴 legt auf.
4. **Abkassieren**, je nachdem, was du verlangst:
   - **🖱️ Fernzugriff** (wie im Original): „Installieren Sie bitte FernViewer und lesen Sie mir Ihre ID vor.“ Am PC (<kbd>Q</kbd>) in der App **FernViewer** die ID eingeben, schon siehst du seinen Desktop. Im **Online-Banking** überweist du dir Geld, solange er am Telefon bleibt. Zu gierig? Dann merkt er es vielleicht.
   - **🎁 Gutschein**: „Holen Sie eine Gutscheinkarte vom Kiosk.“ Er geht los; fragst du zu früh, kommt keine Antwort. Nach ein paar Sekunden „Sind Sie wieder da?“, dann liest er den Code vor → App **Gutscheine**.
   - **💳 Kreditkarte**: Er liest Nummer, Ablaufdatum und Prüfnummer vor → App **Karte**. Bis Feierabend kann die Bank zurückbuchen.
   Codes und Nummern werden nur vorgelesen, nicht angezeigt: gut zuhören und in der App **Notizen** mitschreiben.

Außerdem:

- **Scambaiter** machen verdächtig bereitwillig mit und verraten sich durch Kleinigkeiten (Tippgeräusche, Lachen, alberne Namen). Wer bei ihnen abkassiert, fängt sich einen Virus (−35 % der Tageseinnahmen). Rechtzeitig auflegen bringt Chef-Laune.
- **Der Chef** läuft regelmäßig durchs Büro. Wer dann nicht telefoniert, verdirbt ihm die Laune.
- **Koop**: „Büro eröffnen“ erzeugt einen Code. Bis zu 6 Spieler teilen Büro, Quote und Kasse und sehen sich als Figuren mit Headset.
- **Feierabend**: Quote verfehlt oder Chef sauer → Verwarnung, drei Verwarnungen = gefeuert. Nicht eingelöste Codes verfallen. 25 % der Einnahmen gehen aufs Teamkonto für Upgrades.

## Aufbau

| Datei | Inhalt |
|---|---|
| `server/index.js` | HTTP-Server, REST-Aktionen, Live-Zustand per Server-Sent Events, liefert three.js aus |
| `server/game.js` | Spiellogik: Räume, Tagesablauf, Anrufer, Chef, Zahlungen, Shop |
| `server/ai.js` | Anrufer-KI: Claude und Offline-Fallback |
| `server/data.js` | Namen, Macken, Upgrades, Beispielsätze |
| `public/office3d.js` | Begehbares 3D-Büro (three.js): Schreibtische, Telefone, Chef, Kollegen, Whiteboard |
| `public/client.js` | Telefon, PC-Apps (Gutscheine, Karte, FernViewer mit Online-Banking, Notizen), Spracheingabe/-ausgabe |
| `public/index.html`, `public/style.css` | Bildschirme und Gestaltung |

Der Server ist maßgeblich für den Spielzustand, der Browser stellt nur dar und schickt Aktionen. Ein Solo-Spiel ist ein Büro mit einem Spieler.

Alle Figuren, Kartennummern (beginnen immer mit `0000`) und Codes sind frei erfunden und absichtlich absurd. Das Spiel ist Satire.
