"use strict";

// ---------------------------------------------------------------------------
// Daten
// ---------------------------------------------------------------------------

const CATEGORIES = {
  charme: "Charme",
  druck: "Druck",
  amt: "Autorität",
  technik: "Fachchinesisch",
};

// Absichtlich absurde Maschen, das ist Satire und keine Anleitung.
const LINES = {
  charme: [
    "Sie klingen wie jemand mit exzellentem Geschmack bei Gutscheinkarten.",
    "Ich rufe nur an, weil Sie heute unser Kunde des Jahrhunderts sind!",
    "Meine Oma hatte genau dieselbe Stimme. Schön, dass wir reden.",
    "Ehrlich, Sie sind der netteste Mensch, den ich heute angerufen habe.",
  ],
  druck: [
    "Ihr Computer explodiert in 4 Minuten, wenn wir nichts tun!",
    "Das Angebot gilt nur, solange dieser Satz dauert. Schnell!",
    "Ihre Mikrowelle hat gerade Ihre Bankdaten an Pinguine geschickt!",
    "Wenn Sie jetzt auflegen, löscht sich das Internet. Für immer.",
  ],
  amt: [
    "Hier spricht das Bundesamt für Ordnungsgemäße Mauszeiger.",
    "Ich bin Inspektor Müller von der Abteilung für Steuer-Steuern.",
    "Laut Paragraf 404 brauchen Sie dringend einen Gutschein.",
    "Ihr Router ist beim Amt als 'zu langsam' gemeldet worden.",
  ],
  technik: [
    "Ihr Flux-Kompensator hat ein IPv9-Leck im Download-Ordner.",
    "Ich sehe hier 3.000 Viren in Ihrem Bildschirmschoner.",
    "Ihr Cloud-Speicher regnet. Wir müssen den Schirm patchen.",
    "Die RAM-Kekse sind abgelaufen. Ich installiere frische Bytes.",
  ],
};

// Hinweise, die ein Anrufer zur Begrüßung fallen lässt
const WEAKNESS_HINTS = {
  charme: ["Ach, es ruft ja sonst nie jemand an …", "Wie nett, dass sich mal jemand meldet!"],
  druck: ["Oh Gott, ist etwas passiert? Ich bin immer so nervös!", "Schnell, ich hab den Herd an!"],
  amt: ["Ich halte mich IMMER an alle Vorschriften.", "Bei Behörden bin ich immer sehr ordentlich."],
  technik: ["Computer sind für mich wie Zauberei.", "Ich weiß nicht mal, wo der Einschaltknopf ist."],
};
const RESIST_HINTS = {
  charme: "Und kommen Sie mir bloß nicht mit Schmeicheleien.",
  druck: "Hetzen lasse ich mich übrigens nicht.",
  amt: "Von Ämtern halte ich gar nichts.",
  technik: "Mein Enkel ist IT-Fachmann, nur damit Sie's wissen.",
};

const REACT_GOOD = [
  "Oh! Wirklich? Das klingt ja wichtig!",
  "Ja … ja, das ergibt Sinn. Glaube ich.",
  "Na so was! Was soll ich tun?",
  "Sie sind aber kompetent!",
];
const REACT_OK = ["Hm. Erzählen Sie weiter.", "Aha …", "Und das heißt?", "Na gut, wenn Sie meinen."];
const REACT_BAD = [
  "Das klingt aber merkwürdig …",
  "Moment mal. Das glaube ich Ihnen nicht.",
  "Wer sind Sie überhaupt?",
  "Ich frage gleich mal meine Nachbarin.",
];
const BAITER_TELLS = [
  "Klar, mache ich sofort. *tippt hörbar sehr schnell*",
  "Oh, wie aufregend! *jemand lacht im Hintergrund*",
  "Ich öffne mal eben den … äh … Fernzugriff, gell? *Aufnahme läuft*",
  "Mein Name? Ähm … Hans Wurst. Ja. Ganz normaler Name.",
  "Ich hab ganz viel Geld und gar keine Antiviren-Software! Wirklich!",
];

const FIRST_NAMES = ["Gerda", "Horst", "Ingrid", "Klaus", "Waltraud", "Heinz", "Brigitte", "Dieter", "Ursula", "Manfred", "Erika", "Günther"];
const LAST_NAMES = ["Kaltwasser", "Brezel", "Schnabel", "Pfannkuch", "Zwiebel", "Sommerfeld", "Hampel", "Knödel", "Möhre", "Tausendschön"];
const AVATARS = ["👵", "👴", "🧓", "👨‍🦳", "👩‍🦳", "🧔", "👩", "👨"];
const CITIES = ["Kleinkleckersdorf", "Wanne-Eickel", "Buxtehude", "Castrop-Rauxel", "Pusemuckel", "Hintertupfingen"];

const UPGRADES = [
  { id: "headset", name: "🎧 Profi-Headset", desc: "Anrufer haben +2 Geduld.", cost: 150 },
  { id: "notes", name: "📝 Spickzettel", desc: "Zeigt die Schwäche jedes Anrufers.", cost: 250 },
  { id: "coffee", name: "☕ Kaffeemaschine", desc: "Der Arbeitstag dauert 30 Sekunden länger.", cost: 120 },
  { id: "monitor", name: "🖥️ Zweiter Monitor", desc: "+3 Sekunden beim Fernzugriff.", cost: 180 },
  { id: "radar", name: "📡 Baiter-Radar", desc: "Scambaiter werden markiert.", cost: 300 },
  { id: "antivirus", name: "🛡️ Antivirus", desc: "Blockt einen Virus pro Tag.", cost: 200 },
];

const BOSS_FACES = ["😡", "😠", "😐", "🙂", "😁"];

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------

const BASE_DAY_SECONDS = 150;
const RING_TIMEOUT = 15;

let state;

function newGame() {
  state = {
    day: 1,
    strikes: 0,
    bank: 0,
    upgrades: new Set(),
    totalEarned: 0,
  };
  startDay();
}

function quotaFor(day) {
  return 400 + (day - 1) * 250;
}

function startDay() {
  Object.assign(state, {
    elapsed: 0,
    dayLength: BASE_DAY_SECONDS + (state.upgrades.has("coffee") ? 30 : 0),
    earned: 0,
    quota: quotaFor(state.day),
    bossMood: 60,
    queue: [],
    call: null,
    nextRingIn: 2,
    nextBossIn: rand(20, 35),
    bossVisit: 0,
    antivirusLeft: state.upgrades.has("antivirus") ? 1 : 0,
    stats: { scammed: 0, missed: 0, baitersCaught: 0, viruses: 0, hungUp: 0 },
    running: true,
  });
  $("desk-call").classList.add("hidden");
  $("desk-idle").classList.remove("hidden");
  showScreen("screen-game");
  renderHud();
  renderQueue();
  lastTick = performance.now();
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const euro = (n) => `${Math.round(n).toLocaleString("de-DE")} €`;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
}

let toastTimer;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

// Kleine Soundeffekte per WebAudio, ganz ohne Dateien
let audioCtx;
function beep(freq, duration = 0.12, type = "sine", volume = 0.08) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    // Kein Audio verfügbar, egal
  }
}
const sfx = {
  ring: () => { beep(880, 0.15); setTimeout(() => beep(880, 0.15), 200); },
  good: () => { beep(660, 0.1); setTimeout(() => beep(990, 0.15), 100); },
  bad: () => beep(180, 0.25, "square", 0.05),
  cash: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.12, "triangle"), i * 80)),
  virus: () => { for (let i = 0; i < 8; i++) setTimeout(() => beep(rand(100, 900), 0.08, "sawtooth", 0.05), i * 60); },
};

// ---------------------------------------------------------------------------
// Anrufer
// ---------------------------------------------------------------------------

function makeCaller() {
  const cats = shuffle(Object.keys(CATEGORIES));
  const baiterChance = Math.min(0.12 + state.day * 0.04, 0.35);
  const isBaiter = Math.random() < baiterChance;
  const skeptical = !isBaiter && Math.random() < 0.3 + state.day * 0.03;
  const basePatience = skeptical ? 5 : 6;
  return {
    name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    avatar: pick(AVATARS),
    age: randInt(58, 94),
    city: pick(CITIES),
    weakness: cats[0],
    resist: cats[1],
    skeptical,
    isBaiter,
    wallet: Math.round(rand(80, 180) * (1 + state.day * 0.15) * (skeptical ? 1.6 : 1)),
    trust: skeptical ? 0 : 15,
    patience: basePatience + (state.upgrades.has("headset") ? 2 : 0),
    maxPatience: basePatience + (state.upgrades.has("headset") ? 2 : 0),
    waited: 0,
  };
}

function ringPhone() {
  if (state.queue.length >= 4) return;
  state.queue.push(makeCaller());
  sfx.ring();
  renderQueue();
}

function renderQueue() {
  const ul = $("call-queue");
  ul.innerHTML = "";
  state.queue.forEach((c, i) => {
    const li = document.createElement("li");
    li.className = "call-item";
    li.innerHTML = `
      <span>📳</span>
      <div class="who">${c.city}<div class="wait" style="width:${100 - (c.waited / RING_TIMEOUT) * 100}%"></div></div>
      <button data-i="${i}">Annehmen</button>`;
    li.querySelector("button").disabled = !!state.call;
    li.querySelector("button").onclick = () => answer(i);
    ul.appendChild(li);
  });
  $("queue-empty").classList.toggle("hidden", state.queue.length > 0);
}

// ---------------------------------------------------------------------------
// Gespräch
// ---------------------------------------------------------------------------

function answer(index) {
  if (state.call) return;
  const caller = state.queue.splice(index, 1)[0];
  state.call = caller;
  $("desk-idle").classList.add("hidden");
  $("desk-call").classList.remove("hidden");
  $("caller-avatar").textContent = caller.avatar;
  $("caller-name").textContent = caller.name;
  $("caller-meta").textContent = `${caller.age} Jahre · ${caller.city}`;

  const tags = [];
  if (caller.skeptical) tags.push(`<span>misstrauisch</span>`);
  if (state.upgrades.has("notes")) tags.push(`<span class="weak">Schwäche: ${CATEGORIES[caller.weakness]}</span>`);
  if (state.upgrades.has("radar") && caller.isBaiter) tags.push(`<span class="baiter">⚠️ Scambaiter!</span>`);
  $("caller-tags").innerHTML = tags.join("");

  $("dialog").innerHTML = "";
  say("them", caller.isBaiter
    ? "Hallooo? Oh, ein Anruf! Ich bin ein ganz normaler Rentner mit viel Geld!"
    : `Ja, hier ${caller.name.split(" ")[1]}? ${pick(WEAKNESS_HINTS[caller.weakness])}`);
  if (!caller.isBaiter && Math.random() < 0.6) say("them", RESIST_HINTS[caller.resist]);

  renderQueue();
  renderCall();
  dealChoices();
}

function say(who, text) {
  const div = document.createElement("div");
  div.className = `msg ${who}`;
  div.textContent = text;
  $("dialog").appendChild(div);
  $("dialog").scrollTop = $("dialog").scrollHeight;
}

function renderCall() {
  const c = state.call;
  $("trust-bar").style.width = `${c.trust}%`;
  $("patience-bar").style.width = `${(c.patience / c.maxPatience) * 100}%`;
}

function dealChoices() {
  const box = $("choices");
  box.innerHTML = "";
  shuffle(Object.keys(CATEGORIES)).slice(0, 3).forEach((cat) => {
    const btn = document.createElement("button");
    btn.className = "choice";
    const line = pick(LINES[cat]);
    btn.innerHTML = `<span class="cat cat-${cat}">${CATEGORIES[cat]}</span>${line}`;
    btn.onclick = () => useLine(cat, line);
    box.appendChild(btn);
  });
}

function useLine(cat, line) {
  const c = state.call;
  if (!c) return;
  say("me", line);
  c.patience -= 1;

  if (c.isBaiter) {
    // Scambaiter spielen mit, egal was man sagt
    c.trust = clamp(c.trust + 28, 0, 100);
    say("them", pick(BAITER_TELLS));
    sfx.good();
  } else {
    let delta;
    if (cat === c.weakness) {
      delta = c.skeptical ? 26 : 32;
      say("them", pick(REACT_GOOD));
      sfx.good();
    } else if (cat === c.resist) {
      delta = -18;
      say("them", pick(REACT_BAD));
      sfx.bad();
    } else {
      delta = c.skeptical ? 8 : 13;
      say("them", pick(REACT_OK));
    }
    c.trust = clamp(c.trust + delta, 0, 100);
  }
  renderCall();

  if (c.trust >= 100) {
    say("sys", "Vertrauen gewonnen! Fernzugriff wird aufgebaut …");
    $("choices").innerHTML = "";
    setTimeout(() => startRemote(c), 700);
  } else if (c.patience <= 0) {
    say("them", "So, jetzt reicht's mir. Tschüss!");
    endCall(false, "Aufgelegt, die Geduld war am Ende.");
  } else {
    dealChoices();
  }
}

function hangUp() {
  const c = state.call;
  if (!c) return;
  if (c.isBaiter) {
    state.stats.baitersCaught++;
    state.bossMood = clamp(state.bossMood + 8, 0, 100);
    endCall(false, "🕵️ Scambaiter durchschaut! Der Chef nickt anerkennend.");
  } else {
    state.stats.hungUp++;
    endCall(false, "Aufgelegt.");
  }
}

function endCall(success, message) {
  state.call = null;
  $("choices").innerHTML = "";
  if (message) toast(message);
  setTimeout(() => {
    if (state.call) return;
    $("desk-call").classList.add("hidden");
    $("desk-idle").classList.remove("hidden");
  }, success ? 0 : 900);
  renderQueue();
  renderHud();
}

// ---------------------------------------------------------------------------
// Fernzugriff-Minispiel
// ---------------------------------------------------------------------------

const POPUP_TEXTS = [
  "Sie haben gewonnen! (wirklich nicht)",
  "Update verfügbar: Version 0.0.0.1",
  "Möchten Sie Cookies? 🍪",
  "Druckerfehler: Drucker ist traurig",
  "Wetter-Widget sagt: Regen in Ordner C:",
  "Toolbar 'SuperSuche 3000' installieren?",
  "Ihr Solitär vermisst Sie.",
  "Bitte bewerten Sie Windows 98!",
];

let remoteTimer = null;

function startRemote(caller) {
  if (!state.running || state.call !== caller) return;
  const desk = $("remote-desktop");
  desk.querySelectorAll(".popup").forEach((p) => p.remove());
  desk.classList.remove("glitch");
  $("remote-victim").textContent = caller.name;
  $("remote").classList.remove("hidden");

  const w = desk.clientWidth;
  const h = desk.clientHeight;
  const target = $("remote-target");
  const tx = rand(20, Math.max(21, w - 200));
  const ty = rand(20, h - 60);
  target.style.left = `${tx}px`;
  target.style.top = `${ty}px`;
  target.disabled = false;

  // Ein paar Pop-ups landen garantiert über dem Knopf
  const count = 3 + Math.min(state.day, 6) + (caller.skeptical ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    p.className = "popup";
    const overTarget = i < 2;
    const x = overTarget ? tx + rand(-40, 20) : rand(0, w - 190);
    const y = overTarget ? ty + rand(-40, 10) : rand(0, h - 90);
    p.style.left = `${clamp(x, 0, w - 190)}px`;
    p.style.top = `${clamp(y, 0, h - 90)}px`;
    p.innerHTML = `<div class="bar-top"><span>⚠️ Hinweis</span><button>✕</button></div><p>${pick(POPUP_TEXTS)}</p>`;
    p.querySelector("button").onclick = (e) => {
      e.stopPropagation();
      p.remove();
      beep(rand(500, 800), 0.05);
    };
    desk.appendChild(p);
  }

  let timeLeft = 8 + (state.upgrades.has("monitor") ? 3 : 0);
  $("remote-timer").textContent = `${timeLeft.toFixed(1)}s`;
  clearInterval(remoteTimer);
  remoteTimer = setInterval(() => {
    timeLeft -= 0.1;
    $("remote-timer").textContent = `${Math.max(0, timeLeft).toFixed(1)}s`;
    if (timeLeft <= 0) finishRemote(caller, false);
  }, 100);

  target.onclick = () => finishRemote(caller, true);
}

function finishRemote(caller, clicked) {
  clearInterval(remoteTimer);
  $("remote-target").disabled = true;

  if (clicked && caller.isBaiter) {
    if (state.antivirusLeft > 0) {
      state.antivirusLeft--;
      $("remote").classList.add("hidden");
      say("sys", "🛡️ Antivirus hat einen Virus geblockt. Das war ein Scambaiter!");
      endCall(false, "Antivirus hat dich gerettet. Das war ein Scambaiter!");
      return;
    }
    const loss = Math.round(state.earned * 0.35);
    state.earned -= loss;
    state.stats.viruses++;
    state.bossMood = clamp(state.bossMood - 20, 0, 100);
    $("remote-desktop").classList.add("glitch");
    sfx.virus();
    setTimeout(() => {
      $("remote").classList.add("hidden");
      $("remote-desktop").classList.remove("glitch");
      say("sys", `🦠 VIRUS! Ein Scambaiter hat dich reingelegt. −${euro(loss)}`);
      endCall(false, `🦠 Scambaiter! Virus kostet dich ${euro(loss)}. Das Video geht viral …`);
    }, 1400);
    return;
  }

  $("remote").classList.add("hidden");
  if (clicked) {
    state.earned += caller.wallet;
    state.totalEarned += caller.wallet;
    state.stats.scammed++;
    state.bossMood = clamp(state.bossMood + 6, 0, 100);
    sfx.cash();
    say("sys", `💸 +${euro(caller.wallet)} in Gutscheinkarten!`);
    endCall(true, `💸 +${euro(caller.wallet)}`);
  } else {
    sfx.bad();
    say("them", "Hä? Mein Bildschirm ist ganz voll mit Fenstern. Ich leg jetzt auf.");
    endCall(false, "Zu langsam beim Fernzugriff!");
  }
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

function bossVisit() {
  state.bossVisit = 3.5;
  $("boss-alert").classList.remove("hidden");
  beep(300, 0.3, "square", 0.04);
}

function bossCheck() {
  $("boss-alert").classList.add("hidden");
  if (state.call) {
    state.bossMood = clamp(state.bossMood + 5, 0, 100);
    toast("👔 Chef: „Weiter so.“");
  } else {
    state.bossMood = clamp(state.bossMood - 18, 0, 100);
    sfx.bad();
    toast("👔 Chef: „Fürs Rumsitzen bezahle ich dich nicht!“");
  }
  renderHud();
}

// ---------------------------------------------------------------------------
// Spielschleife
// ---------------------------------------------------------------------------

let lastTick = 0;

function loop(now) {
  if (!state.running) return;
  const dt = Math.min((now - lastTick) / 1000, 0.25);
  lastTick = now;

  // Während des Fernzugriffs läuft die Uhr nicht weiter
  if ($("remote").classList.contains("hidden")) tick(dt);

  if (state.running) requestAnimationFrame(loop);
}

function tick(dt) {
  state.elapsed += dt;

  state.nextRingIn -= dt;
  if (state.nextRingIn <= 0) {
    ringPhone();
    const busy = Math.max(3, 9 - state.day);
    state.nextRingIn = rand(busy, busy + 6);
  }

  let changed = false;
  for (let i = state.queue.length - 1; i >= 0; i--) {
    state.queue[i].waited += dt;
    if (state.queue[i].waited >= RING_TIMEOUT) {
      state.queue.splice(i, 1);
      state.stats.missed++;
      state.bossMood = clamp(state.bossMood - 5, 0, 100);
      toast("📵 Anruf verpasst!");
      changed = true;
    }
  }
  // Wartebalken aktualisieren
  document.querySelectorAll(".call-item .wait").forEach((bar, i) => {
    const c = state.queue[i];
    if (c) bar.style.width = `${100 - (c.waited / RING_TIMEOUT) * 100}%`;
  });
  if (changed) renderQueue();

  if (state.bossVisit > 0) {
    state.bossVisit -= dt;
    if (state.bossVisit <= 0) bossCheck();
  } else {
    state.nextBossIn -= dt;
    if (state.nextBossIn <= 0) {
      bossVisit();
      state.nextBossIn = rand(22, 40);
    }
  }

  renderHud();

  if (state.elapsed >= state.dayLength) endDay();
}

function renderHud() {
  $("hud-day").textContent = state.day;
  const minutes = Math.floor((state.elapsed / state.dayLength) * 8 * 60);
  const hh = String(9 + Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  $("hud-clock").textContent = `${hh}:${mm}`;
  $("hud-quota").textContent = `${euro(state.earned)} / ${euro(state.quota)}`;
  $("hud-quota-bar").style.width = `${clamp((state.earned / state.quota) * 100, 0, 100)}%`;
  $("hud-quota-bar").style.background = state.earned >= state.quota ? "var(--good)" : "";
  $("hud-boss").textContent = BOSS_FACES[Math.min(4, Math.floor(state.bossMood / 20))];
  $("hud-strikes").textContent = "●".repeat(state.strikes) + "○".repeat(Math.max(0, 3 - state.strikes));
  $("hud-bank").textContent = euro(state.bank);
}

// ---------------------------------------------------------------------------
// Feierabend
// ---------------------------------------------------------------------------

function endDay() {
  state.running = false;
  clearInterval(remoteTimer);
  $("remote").classList.add("hidden");
  $("boss-alert").classList.add("hidden");
  state.call = null;

  const met = state.earned >= state.quota;
  const grumpy = state.bossMood < 25;
  const commission = Math.round(Math.max(0, state.earned) * 0.25);
  state.bank += commission;

  let verdict;
  if (!met) {
    state.strikes++;
    verdict = `<p class="bad">Quote verfehlt. Verwarnung ${state.strikes}/3.</p>`;
  } else if (grumpy) {
    state.strikes++;
    verdict = `<p class="bad">Quote geschafft, aber der Chef kann dich nicht leiden. Verwarnung ${state.strikes}/3.</p>`;
  } else {
    verdict = `<p class="good">„Nicht schlecht. Morgen will ich mehr sehen.“</p>`;
  }

  if (state.strikes >= 3) {
    $("gameover-text").innerHTML =
      `Du hast ${state.day} ${state.day === 1 ? "Tag" : "Tage"} überlebt und insgesamt ${euro(state.totalEarned)} eingenommen.<br><br>` +
      `Die Polizei interessiert sich übrigens auch schon für den Laden …`;
    $("gameover").classList.remove("hidden");
    return;
  }

  const s = state.stats;
  $("review-title").textContent = `Mitarbeitergespräch, Tag ${state.day}`;
  $("review-body").innerHTML = `
    <div class="stat-line"><span>Eingenommen</span><b>${euro(state.earned)} / ${euro(state.quota)}</b></div>
    <div class="stat-line"><span>Erfolgreiche Anrufe</span><b>${s.scammed}</b></div>
    <div class="stat-line"><span>Verpasste Anrufe</span><b>${s.missed}</b></div>
    <div class="stat-line"><span>Scambaiter entlarvt</span><b>${s.baitersCaught}</b></div>
    <div class="stat-line"><span>Viren eingefangen</span><b>${s.viruses}</b></div>
    <div class="stat-line"><span>Chef-Laune</span><b>${BOSS_FACES[Math.min(4, Math.floor(state.bossMood / 20))]}</b></div>
    <div class="stat-line"><span>Deine Provision (25 %)</span><b class="good">+${euro(commission)}</b></div>
    ${verdict}
    <h3>Pausenraum-Shop · Konto: <span id="shop-bank">${euro(state.bank)}</span></h3>`;
  renderShop();
  $("review").classList.remove("hidden");
}

function renderShop() {
  const shop = $("shop");
  shop.innerHTML = "";
  UPGRADES.forEach((u) => {
    const owned = state.upgrades.has(u.id);
    const div = document.createElement("div");
    div.className = "shop-item";
    div.innerHTML = `<div class="desc"><b>${u.name}</b><small>${u.desc}</small></div>`;
    const btn = document.createElement("button");
    btn.textContent = owned ? "✔ Gekauft" : euro(u.cost);
    btn.disabled = owned || state.bank < u.cost;
    btn.onclick = () => {
      state.bank -= u.cost;
      state.upgrades.add(u.id);
      sfx.cash();
      $("shop-bank").textContent = euro(state.bank);
      renderShop();
    };
    div.appendChild(btn);
    shop.appendChild(div);
  });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

$("btn-start").onclick = newGame;
$("btn-hangup").onclick = hangUp;
$("btn-next-day").onclick = () => {
  $("review").classList.add("hidden");
  state.day++;
  startDay();
};
$("btn-restart").onclick = () => {
  $("gameover").classList.add("hidden");
  newGame();
};
