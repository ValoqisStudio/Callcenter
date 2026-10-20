// Statische Spieldaten: Anrufer-Bausteine, Upgrades, Beispielsätze.
// Alles frei erfunden und absichtlich absurd, das Spiel ist Satire.

export const CATEGORIES = {
  charme: "Charme",
  druck: "Druck",
  amt: "Autorität",
  technik: "Fachchinesisch",
};

// Wie ein Anrufer auf eine Masche anspringt bzw. sie hasst (für den KI-Prompt)
export const WEAKNESS_TEXT = {
  charme: "Du bist einsam und schmilzt bei Komplimenten, Freundlichkeit und persönlichem Interesse.",
  druck: "Du bist schnell nervös. Zeitdruck, Warnungen und Notfälle machen dich panisch und gefügig.",
  amt: "Du hast riesigen Respekt vor Behörden, Titeln, Paragrafen und allem, was offiziell klingt.",
  technik: "Du verstehst nichts von Technik. Fachbegriffe beeindrucken dich und machen dir Angst.",
};
export const RESIST_TEXT = {
  charme: "Schmeicheleien findest du schleimig und verdächtig.",
  druck: "Wer dich hetzt, macht dich stur. Zeitdruck lässt dich misstrauisch werden.",
  amt: "Du hältst nichts von Ämtern und Autoritäten und wirst bei sowas bockig.",
  technik: "Dein Enkel ist IT-Fachmann, du erkennst Technik-Unsinn sofort.",
};

export const FIRST_NAMES = {
  f: ["Gerda", "Ingrid", "Waltraud", "Brigitte", "Ursula", "Erika", "Hildegard", "Renate", "Gisela", "Helga", "Margot", "Christa"],
  m: ["Horst", "Klaus", "Heinz", "Dieter", "Manfred", "Günther", "Werner", "Rolf", "Siegfried", "Erwin", "Herbert", "Lothar"],
};
export const LAST_NAMES = ["Kaltwasser", "Brezel", "Schnabel", "Pfannkuch", "Zwiebel", "Sommerfeld", "Hampel", "Knödel", "Möhre", "Tausendschön", "Pumpernickel", "Wackelpudding", "Glühwurm", "Schnitzler"];
export const AVATARS = { f: ["👵", "👩‍🦳", "👩"], m: ["👴", "👨‍🦳", "🧔", "🧓"] };
export const CITIES = ["Kleinkleckersdorf", "Wanne-Eickel", "Buxtehude", "Castrop-Rauxel", "Pusemuckel", "Hintertupfingen", "Bad Bentheim", "Wolkenkuckucksheim", "Posemuckel", "Schilda"];

export const QUIRKS = [
  "züchtet preisgekrönte Riesenkürbisse",
  "war 40 Jahre lang Postbote und kennt jeden Briefkasten",
  "hat eine Katze namens Mausi, die angeblich Gedanken lesen kann",
  "sammelt Porzellanfrösche (aktuell 312 Stück)",
  "schaut jeden Abend Quizshows und weiß alles über Flüsse",
  "ist Vorsitzende(r) des örtlichen Kegelvereins",
  "backt den ganzen Tag Streuselkuchen",
  "hat gerade einen Volkshochschulkurs 'Internet für Anfänger' abgebrochen",
  "telefoniert nebenbei mit der Schwester auf dem anderen Telefon",
  "hat einen Wellensittich, der ständig dazwischenquatscht",
];

export const SPEECH_STYLES = [
  "redet gern ausschweifend und kommt vom Hölzchen aufs Stöckchen",
  "ist etwas schwerhörig und fragt öfter nach",
  "spricht sehr förmlich und siezt betont",
  "berlinert ein bisschen",
  "sagt ständig 'ach Gottchen'",
  "ist kurz angebunden und mürrisch",
  "kichert viel und ist gut gelaunt",
];

export const BAITER_ALIASES = {
  f: ["Anna Nass", "Rosa Schlüpfer", "Ella Vator", "Marie Huana"],
  m: ["Hans Wurst", "Klaus Trophobie", "Rainer Zufall", "Axel Schweiß"],
};

// Upgrades für den Pausenraum-Shop
export const UPGRADES = [
  { id: "headset", name: "🎧 Profi-Headset", desc: "Anrufer haben +2 Geduld.", cost: 150 },
  { id: "notes", name: "📝 Spickzettel", desc: "Zeigt die Schwäche jedes Anrufers.", cost: 250 },
  { id: "coffee", name: "☕ Kaffeemaschine", desc: "Der Arbeitstag dauert 30 Sekunden länger.", cost: 120 },
  { id: "leads", name: "📈 Premium-Leads", desc: "Anrufer haben 25 % mehr Geld.", cost: 220 },
  { id: "radar", name: "📡 Baiter-Radar", desc: "Scambaiter werden markiert.", cost: 300 },
  { id: "antivirus", name: "🛡️ Antivirus", desc: "Blockt einen Virus pro Tag.", cost: 200 },
  { id: "terminal", name: "💳 Wegwerf-Terminal", desc: "Kreditkarten werden seltener zurückgebucht.", cost: 260 },
  { id: "kiosk", name: "🏪 Kiosk-Kontakt", desc: "Anrufer sind schneller vom Gutschein-Kauf zurück.", cost: 140 },
];

// Beispielsätze für den Spickzettel im Client (Spieler können frei sprechen)
export const SAMPLE_LINES = {
  charme: [
    "Sie klingen wie jemand mit exzellentem Geschmack.",
    "Sie sind heute unser Kunde des Jahrhunderts!",
    "Wie schön, mal mit so einem netten Menschen zu sprechen.",
  ],
  druck: [
    "Ihr Computer explodiert in vier Minuten, wenn wir nichts tun!",
    "Das Angebot gilt nur noch, solange dieser Satz dauert!",
    "Wenn Sie jetzt auflegen, löscht sich das Internet!",
  ],
  amt: [
    "Hier spricht das Bundesamt für ordnungsgemäße Mauszeiger.",
    "Laut Paragraf 404 brauchen Sie dringend einen Gutschein.",
    "Ich bin Inspektor Müller von der Abteilung für Steuer-Steuern.",
  ],
  technik: [
    "Ihr Flux-Kompensator hat ein IPv9-Leck im Download-Ordner.",
    "Ich sehe hier 3.000 Viren in Ihrem Bildschirmschoner.",
    "Ihr Cloud-Speicher regnet, wir müssen den Schirm patchen.",
  ],
};
