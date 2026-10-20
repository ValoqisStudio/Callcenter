# ☎️ Callcenter Chaos

Ein satirisches Browser-Spiel über ein chaotisches Callcenter. Erfülle die Tagesquote, halte den Chef bei Laune und fall nicht auf Scambaiter rein.

## Starten

Kein Build nötig: `index.html` im Browser öffnen. Alternativ:

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

## Spielablauf

- **Anrufe**: Telefone klingeln in der Leitungsliste. Wer zu lange wartet, legt auf, und der Chef merkt sich das.
- **Gespräch**: Pro Zug wählst du eine von drei Maschen (Charme, Druck, Autorität, Fachchinesisch). Jeder Anrufer hat eine versteckte **Schwäche** und eine **Abneigung**, die er im Gespräch andeutet. Vertrauen rauf, Geduld runter.
- **Fernzugriff**: Bei 100 % Vertrauen startet ein Minispiel. Schließe die Pop-ups (oberstes zuerst) und klicke rechtzeitig auf „Gutschein einlösen“.
- **Scambaiter**: Sie vertrauen dir verdächtig schnell und verraten sich durch merkwürdige Sätze. Rechtzeitig auflegen bringt Chef-Laune, sonst kostet dich ein Virus 35 % der Tageseinnahmen.
- **Chef**: Er kommt zufällig vorbei. Wenn du dann nicht telefonierst, sinkt seine Laune.
- **Mitarbeitergespräch**: Quote verfehlt oder Chef zu schlecht gelaunt → Verwarnung. Drei Verwarnungen = gefeuert.
- **Pausenraum-Shop**: 25 % der Einnahmen gehen als Provision aufs Konto. Davon kaufst du Upgrades (Headset, Spickzettel, Kaffeemaschine, zweiter Monitor, Baiter-Radar, Antivirus).

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Aufbau aller Bildschirme und Overlays |
| `style.css` | Gestaltung |
| `game.js` | Spiellogik: Anrufer, Gespräche, Minispiel, Chef, Tagesablauf, Shop |

Alle Figuren und Maschen sind frei erfunden und absichtlich absurd.
