// Serverseitige Spiellogik. Jeder Raum ist ein gemeinsames Büro;
// Solo-Spiel ist einfach ein Raum mit einem Spieler.

import crypto from "node:crypto";
import {
  FIRST_NAMES, LAST_NAMES, AVATARS, CITIES, QUIRKS, SPEECH_STYLES, BAITER_ALIASES, UPGRADES, CATEGORIES,
} from "./data.js";
import { callerTurn } from "./ai.js";

// Für Tests lässt sich der Arbeitstag per Umgebungsvariable verkürzen
const BASE_DAY_SECONDS = Number(process.env.CALLCENTER_DAY_SECONDS) || 180;
const RING_TIMEOUT = 18;
const MAX_QUEUE = 5;
const PLAYER_COLORS = ["#ffcc33", "#5ab4ff", "#ff7ab6", "#4cd18a", "#b38cff", "#ff8a5c"];
const PLAYER_AVATARS = ["🧑‍💼", "👩‍💻", "🧑‍🎤", "🕵️", "🧑‍🔧", "👨‍🚀"];

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const id = () => crypto.randomBytes(6).toString("hex");

const rooms = new Map();

// ---------------------------------------------------------------------------
// Räume & Spieler
// ---------------------------------------------------------------------------

function newCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code;
  do {
    code = Array.from({ length: 4 }, () => pick(letters.split(""))).join("");
  } while (rooms.has(code));
  return code;
}

export function createRoom(playerName) {
  const room = {
    code: newCode(),
    players: new Map(),
    hostId: null,
    phase: "lobby",
    day: 1,
    strikes: 0,
    bank: 0,
    totalEarned: 0,
    upgrades: new Set(),
    events: [],
    eventSeq: 0,
    review: null,
    calls: new Map(),
    queue: [],
    lastActive: Date.now(),
  };
  rooms.set(room.code, room);
  const player = addPlayer(room, playerName);
  room.hostId = player.id;
  return { room, player };
}

export function joinRoom(code, playerName) {
  const room = rooms.get(String(code || "").toUpperCase());
  if (!room) throw new GameError("Raum nicht gefunden.");
  if (room.players.size >= 6) throw new GameError("Das Büro ist voll (max. 6).");
  const player = addPlayer(room, playerName);
  pushEvent(room, { type: "toast", text: `👋 ${player.name} hat das Büro betreten.` });
  return { room, player };
}

function addPlayer(room, name) {
  const idx = room.players.size;
  const player = {
    id: id(),
    name: String(name || "").trim().slice(0, 18) || `Agent ${idx + 1}`,
    color: PLAYER_COLORS[idx % PLAYER_COLORS.length],
    avatar: PLAYER_AVATARS[idx % PLAYER_AVATARS.length],
    callId: null,
    clients: new Set(),
    goneSince: null,
  };
  room.players.set(player.id, player);
  return player;
}

export function getRoom(code) {
  return rooms.get(String(code || "").toUpperCase());
}

export class GameError extends Error {}

export function attachClient(room, playerId, res) {
  const player = room.players.get(playerId);
  if (!player) throw new GameError("Unbekannter Spieler.");
  player.clients.add(res);
  player.goneSince = null;
  res.write(`data: ${JSON.stringify(view(room))}\n\n`);
  return () => {
    player.clients.delete(res);
    if (player.clients.size === 0) player.goneSince = Date.now();
  };
}

function removePlayer(room, player) {
  if (player.callId) {
    const call = room.calls.get(player.callId);
    if (call) endCall(room, call, false, null);
  }
  room.players.delete(player.id);
  pushEvent(room, { type: "toast", text: `🚪 ${player.name} hat das Büro verlassen.` });
  if (room.hostId === player.id) room.hostId = room.players.keys().next().value || null;
  if (room.players.size === 0) rooms.delete(room.code);
}

function pushEvent(room, ev) {
  room.events.push({ ...ev, id: ++room.eventSeq });
  if (room.events.length > 40) room.events.shift();
}

// ---------------------------------------------------------------------------
// Tagesablauf
// ---------------------------------------------------------------------------

function quotaFor(room) {
  const n = Math.max(1, room.players.size);
  return Math.round((400 + (room.day - 1) * 260) * (1 + 0.65 * (n - 1)) / 10) * 10;
}

function startDay(room) {
  for (const p of room.players.values()) p.callId = null;
  Object.assign(room, {
    phase: "day",
    elapsed: 0,
    dayLength: BASE_DAY_SECONDS + (room.upgrades.has("coffee") ? 30 : 0),
    earned: 0,
    quota: quotaFor(room),
    bossMood: 60,
    queue: [],
    calls: new Map(),
    nextRingIn: 2,
    nextBossIn: rand(25, 40),
    bossVisit: 0,
    antivirusLeft: room.upgrades.has("antivirus") ? 1 : 0,
    chargebacks: [],
    stats: { scammed: 0, missed: 0, baitersCaught: 0, viruses: 0, card: 0, giftcard: 0 },
    review: null,
  });
  pushEvent(room, { type: "toast", text: `☀️ Tag ${room.day} beginnt. Quote: ${room.quota} €` });
}

function makeCaller(room) {
  const gender = Math.random() < 0.5 ? "f" : "m";
  const cats = Object.keys(CATEGORIES).sort(() => Math.random() - 0.5);
  const isBaiter = Math.random() < Math.min(0.1 + room.day * 0.04, 0.33);
  const skeptical = !isBaiter && Math.random() < 0.25 + room.day * 0.04;
  const patience = (skeptical ? 6 : 7) + (room.upgrades.has("headset") ? 2 : 0);
  return {
    id: id(),
    gender,
    name: `${pick(FIRST_NAMES[gender])} ${pick(LAST_NAMES)}`,
    alias: pick(BAITER_ALIASES[gender]),
    avatar: pick(AVATARS[gender]),
    age: randInt(58, 94),
    city: pick(CITIES),
    quirk: pick(QUIRKS),
    style: pick(SPEECH_STYLES),
    weakness: cats[0],
    resist: cats[1],
    skeptical,
    isBaiter,
    wallet: Math.round(rand(90, 200) * (1 + room.day * 0.15) * (skeptical ? 1.6 : 1)),
    trust: skeptical ? 0 : 10,
    patience,
    maxPatience: patience,
    stage: "ringing",
    owner: null,
    waited: 0,
    busy: false,
    history: [],
    stageTimer: 0,
    deadline: 0,
    card: null,
    cardTries: 0,
  };
}

export function tick(room, dt) {
  // Verlassene Spieler nach 15 Sekunden entfernen
  for (const p of [...room.players.values()]) {
    if (p.goneSince && Date.now() - p.goneSince > 15_000) removePlayer(room, p);
  }
  if (!rooms.has(room.code) || room.phase !== "day") return;

  room.elapsed += dt;

  room.nextRingIn -= dt;
  if (room.nextRingIn <= 0) {
    const ringing = room.queue.length;
    if (ringing < MAX_QUEUE) {
      const c = makeCaller(room);
      room.calls.set(c.id, c);
      room.queue.push(c.id);
      pushEvent(room, { type: "ring" });
    }
    const busy = Math.max(3, 10 - room.day) / Math.pow(Math.max(1, room.players.size), 0.7);
    room.nextRingIn = rand(busy, busy + 6);
  }

  for (const cid of [...room.queue]) {
    const c = room.calls.get(cid);
    c.waited += dt;
    if (c.waited >= RING_TIMEOUT) {
      room.queue = room.queue.filter((x) => x !== cid);
      room.calls.delete(cid);
      room.stats.missed++;
      room.bossMood = clamp(room.bossMood - 5, 0, 100);
      pushEvent(room, { type: "toast", text: "📵 Anruf verpasst!" });
    }
  }

  for (const c of room.calls.values()) {
    if (c.stage === "store") {
      c.stageTimer -= dt;
      if (c.stageTimer <= 0) {
        c.stage = "cashier";
        c.history.push({
          role: "caller",
          text: `So, ich bin an der Kasse. Die Kassiererin fragt, wofür ich ${c.wallet} € in Gutscheinkarten brauche. Sie sagt, das klingt nach Betrug! Was soll ich ihr sagen?`,
        });
      }
    } else if (c.stage === "card" && Date.now() > c.deadline) {
      c.history.push({ role: "caller", text: "Hallo? Sind Sie noch dran? Das dauert mir zu lange, ich leg auf." });
      endCall(room, c, false, "⌛ Zu langsam am Kartenterminal!");
    } else if (c.stage === "codes" && Date.now() > c.deadline + 3000) {
      // Sicherheitsnetz, falls der Client das Minispiel nie meldet
      endCall(room, c, false, "⌛ Fernzugriff abgebrochen.");
    }
  }

  if (room.bossVisit > 0) {
    room.bossVisit -= dt;
    if (room.bossVisit <= 0) bossCheck(room);
  } else {
    room.nextBossIn -= dt;
    if (room.nextBossIn <= 0) {
      room.bossVisit = 4;
      room.nextBossIn = rand(25, 45);
      pushEvent(room, { type: "boss" });
    }
  }

  if (room.elapsed >= room.dayLength) endDay(room);
}

function bossCheck(room) {
  const idle = [...room.players.values()].filter((p) => !p.callId);
  if (idle.length === 0) {
    room.bossMood = clamp(room.bossMood + 5, 0, 100);
    pushEvent(room, { type: "toast", text: "👔 Chef: „So gefällt mir das. Alle am Telefon!“" });
  } else {
    room.bossMood = clamp(room.bossMood - 12 * idle.length, 0, 100);
    pushEvent(room, { type: "toast", text: `👔 Chef: „${idle.map((p) => p.name).join(", ")}, fürs Rumsitzen bezahle ich euch nicht!“`, bad: true });
  }
}

function endDay(room) {
  for (const c of room.calls.values()) {
    if (c.owner) {
      const p = room.players.get(c.owner);
      if (p) p.callId = null;
    }
  }
  room.calls = new Map();
  room.queue = [];

  const chargeback = room.chargebacks.reduce((a, b) => a + b, 0);
  room.earned -= chargeback;
  const met = room.earned >= room.quota;
  const grumpy = room.bossMood < 25;
  const commission = Math.round(Math.max(0, room.earned) * 0.25);
  room.bank += commission;

  let verdict;
  let verdictGood = false;
  if (!met) {
    room.strikes++;
    verdict = `Quote verfehlt. Verwarnung ${room.strikes}/3.`;
  } else if (grumpy) {
    room.strikes++;
    verdict = `Quote geschafft, aber der Chef kann euch nicht leiden. Verwarnung ${room.strikes}/3.`;
  } else {
    verdict = "„Nicht schlecht. Morgen will ich mehr sehen.“";
    verdictGood = true;
  }

  room.review = {
    day: room.day,
    earned: room.earned,
    quota: room.quota,
    chargeback,
    chargebackCount: room.chargebacks.length,
    commission,
    bossMood: room.bossMood,
    stats: room.stats,
    verdict,
    verdictGood,
  };
  room.phase = room.strikes >= 3 ? "gameover" : "review";
}

// ---------------------------------------------------------------------------
// Aktionen der Spieler
// ---------------------------------------------------------------------------

export async function handleAction(room, playerId, action) {
  const player = room.players.get(playerId);
  if (!player) throw new GameError("Unbekannter Spieler.");
  room.lastActive = Date.now();

  switch (action.type) {
    case "start":
      if (room.phase !== "lobby" && room.phase !== "review") throw new GameError("Gerade nicht möglich.");
      if (room.phase === "review") room.day++;
      startDay(room);
      return;
    case "restart":
      if (room.phase !== "gameover") throw new GameError("Gerade nicht möglich.");
      Object.assign(room, { day: 1, strikes: 0, bank: 0, totalEarned: 0, upgrades: new Set(), phase: "lobby", review: null });
      return;
    case "buy":
      return buy(room, action.upgrade);
  }

  if (room.phase !== "day") throw new GameError("Die Schicht läuft gerade nicht.");

  if (action.type === "answer") return answer(room, player, action.callId);

  const call = player.callId && room.calls.get(player.callId);
  if (!call) throw new GameError("Du telefonierst gerade nicht.");

  switch (action.type) {
    case "say": return say(room, player, call, action.text);
    case "hangup": return hangUp(room, call);
    case "pay": return choosePayment(room, call, action.method);
    case "card": return submitCard(room, call, action);
    case "remote": return finishRemote(room, call, !!action.success);
    default: throw new GameError("Unbekannte Aktion.");
  }
}

function buy(room, upgradeId) {
  if (room.phase !== "review") throw new GameError("Der Shop hat nur nach Feierabend offen.");
  const u = UPGRADES.find((x) => x.id === upgradeId);
  if (!u || room.upgrades.has(u.id)) throw new GameError("Nicht verfügbar.");
  if (room.bank < u.cost) throw new GameError("Nicht genug Geld auf dem Konto.");
  room.bank -= u.cost;
  room.upgrades.add(u.id);
}

async function answer(room, player, callId) {
  if (player.callId) throw new GameError("Du bist schon in einem Gespräch.");
  const call = room.calls.get(callId);
  if (!call || call.stage !== "ringing") throw new GameError("Der Anruf ist weg.");
  room.queue = room.queue.filter((x) => x !== callId);
  call.stage = "talk";
  call.owner = player.id;
  player.callId = call.id;
  await runTurn(room, call, "greeting");
}

async function say(room, player, call, rawText) {
  const text = String(rawText || "").trim().slice(0, 300);
  if (!text) throw new GameError("Sag doch was!");
  if (call.busy) throw new GameError("Der Anrufer redet noch.");
  if (call.stage !== "talk" && call.stage !== "cashier") throw new GameError("Gerade nicht der richtige Moment.");

  call.history.push({ role: "player", text, by: player.name });
  const phase = call.stage === "cashier" ? "cashier" : "talk";
  if (phase === "talk") call.patience -= 1;
  await runTurn(room, call, phase);
}

async function runTurn(room, call, phase) {
  call.busy = true;
  let result;
  try {
    result = await callerTurn(call, phase);
  } finally {
    call.busy = false;
  }
  // Der Anruf könnte inzwischen beendet sein (Feierabend, Auflegen, Spieler weg)
  if (room.calls.get(call.id) !== call || call.stage === "done") return;

  call.history.push({ role: "caller", text: result.reply });
  if (phase === "greeting") return;

  if (phase === "cashier") {
    if (result.hangsUp || result.trustDelta < 0) {
      endCall(room, call, false, "🏪 Die Kassiererin hat den Anrufer gewarnt.");
    } else {
      startCodes(room, call);
    }
    return;
  }

  call.trust = clamp(call.trust + result.trustDelta, 0, 100);
  call.lastDelta = result.trustDelta;
  call.lastApproach = result.approach;

  if (result.hangsUp) {
    endCall(room, call, false, "📴 Der Anrufer hat aufgelegt.");
  } else if (call.trust >= 100) {
    call.stage = "choose";
    call.history.push({ role: "sys", text: "Vertrauen gewonnen! Wie soll bezahlt werden?" });
  } else if (call.patience <= 0) {
    call.history.push({ role: "caller", text: "So, ich hab jetzt keine Zeit mehr. Tschüss!" });
    endCall(room, call, false, "📴 Die Geduld war am Ende.");
  }
}

function fakeCardNumber() {
  // Absichtlich ungültige Nummern (0000-Präfix), reine Spielwerte
  const groups = ["0000", ...Array.from({ length: 3 }, () => String(randInt(0, 9999)).padStart(4, "0"))];
  return groups.join(" ");
}

function choosePayment(room, call, method) {
  if (call.stage !== "choose") throw new GameError("Gerade nicht der richtige Moment.");
  const extra = room.upgrades.has("monitor") ? 8 : 0;
  if (method === "card") {
    room.stats.card++;
    call.card = {
      number: fakeCardNumber(),
      expiry: `${String(randInt(1, 12)).padStart(2, "0")}/${randInt(27, 31)}`,
      cvc: String(randInt(0, 999)).padStart(3, "0"),
    };
    call.stage = "card";
    call.deadline = Date.now() + (30 + extra) * 1000;
    call.history.push({
      role: "caller",
      secret: true,
      text: `Ach so, mit Karte, na gut. Moment, ich hol meine Brille … Also: Die Nummer ist ${call.card.number}. Gültig bis ${call.card.expiry}. Und hinten steht ${call.card.cvc}.`,
    });
  } else if (method === "giftcard") {
    room.stats.giftcard++;
    call.stage = "store";
    call.stageTimer = room.upgrades.has("kiosk") ? 6 : 11;
    call.history.push({ role: "caller", text: "Gutscheinkarten? Na gut, ich geh schnell zum Kiosk um die Ecke. Bleiben Sie dran!" });
  } else {
    throw new GameError("Unbekannte Zahlungsart.");
  }
}

function startCodes(room, call) {
  call.stage = "codes";
  call.deadline = Date.now() + (15 + (room.upgrades.has("monitor") ? 4 : 0)) * 1000;
  call.history.push({ role: "sys", text: "Fernzugriff steht! Klick die Pop-ups weg und löse die Gutscheine ein." });
}

function normalize(s) {
  return String(s || "").replace(/\D/g, "");
}

function submitCard(room, call, { number, expiry, cvc }) {
  if (call.stage !== "card") throw new GameError("Gerade nicht der richtige Moment.");
  const ok = normalize(number) === normalize(call.card.number)
    && normalize(expiry) === normalize(call.card.expiry)
    && normalize(cvc) === normalize(call.card.cvc);
  if (ok) {
    const risk = room.upgrades.has("terminal") ? 0.1 : 0.3;
    payout(room, call, call.wallet, "card", !call.isBaiter && Math.random() < risk);
    return;
  }
  call.cardTries++;
  if (call.cardTries >= 3) {
    call.history.push({ role: "caller", text: "Jetzt hat meine Bank angerufen, weil dreimal was Falsches eingegeben wurde. Ich leg auf!" });
    endCall(room, call, false, "💳 Karte gesperrt, zu viele Fehlversuche.");
  } else {
    call.history.push({ role: "caller", secret: true, text: `Nochmal? Also ganz langsam: ${call.card.number.split("").join(" ").replace(/ {3}/g, ", ")}. Gültig bis ${call.card.expiry}, Prüfnummer ${call.card.cvc}.` });
  }
}

function finishRemote(room, call, success) {
  if (call.stage !== "codes") throw new GameError("Gerade nicht der richtige Moment.");
  if (success) {
    payout(room, call, Math.round(call.wallet * 0.9), "giftcard", false);
  } else {
    call.history.push({ role: "caller", text: "Hä? Mein Bildschirm ist ganz voll mit Fenstern. Ich mach den jetzt aus!" });
    endCall(room, call, false, "⌛ Zu langsam beim Fernzugriff!");
  }
}

function payout(room, call, amount, method, chargeback) {
  const owner = room.players.get(call.owner);
  if (call.isBaiter) {
    if (room.antivirusLeft > 0) {
      room.antivirusLeft--;
      pushEvent(room, { type: "toast", text: "🛡️ Antivirus hat einen Virus geblockt. Das war ein Scambaiter!" });
    } else {
      const loss = Math.round(Math.max(0, room.earned) * 0.35);
      room.earned -= loss;
      room.stats.viruses++;
      room.bossMood = clamp(room.bossMood - 20, 0, 100);
      pushEvent(room, { type: "virus", target: call.owner, text: `🦠 ${owner ? owner.name : "Jemand"} ist auf einen Scambaiter reingefallen! Virus kostet ${loss} €. Das Video geht viral …`, bad: true });
    }
    call.history.push({ role: "caller", text: "HAHA! Gruß an meine 2 Millionen Zuschauer! 👋" });
    endCall(room, call, false, null);
    return;
  }
  room.earned += amount;
  room.totalEarned += amount;
  room.stats.scammed++;
  room.bossMood = clamp(room.bossMood + 6, 0, 100);
  if (chargeback && method === "card") room.chargebacks.push(amount);
  pushEvent(room, { type: "cash", text: `💸 ${owner ? owner.name : "Jemand"}: +${amount} € (${method === "card" ? "Kreditkarte" : "Gutscheine"})` });
  call.history.push({ role: "sys", text: `💸 +${amount} €` });
  endCall(room, call, true, null);
}

function hangUp(room, call) {
  if (call.isBaiter) {
    room.stats.baitersCaught++;
    room.bossMood = clamp(room.bossMood + 8, 0, 100);
    endCall(room, call, false, "🕵️ Scambaiter durchschaut! Der Chef nickt anerkennend.");
  } else {
    endCall(room, call, false, null);
  }
}

function endCall(room, call, success, message) {
  call.stage = "done";
  const owner = room.players.get(call.owner);
  if (owner && owner.callId === call.id) owner.callId = null;
  if (message) pushEvent(room, { type: "toast", text: message, target: call.owner, bad: !success });
  // Kurz sichtbar lassen, damit der Spieler die letzte Zeile sieht
  setTimeout(() => room.calls.delete(call.id), 2500);
}

// ---------------------------------------------------------------------------
// Ansicht für die Clients
// ---------------------------------------------------------------------------

export function view(room) {
  const notes = room.upgrades.has("notes");
  const radar = room.upgrades.has("radar");
  const calls = [...(room.calls?.values() || [])].map((c) => ({
    id: c.id,
    stage: c.stage,
    owner: c.owner,
    name: c.isBaiter && c.stage !== "ringing" ? c.alias : c.name,
    avatar: c.avatar,
    gender: c.gender,
    age: c.age,
    city: c.city,
    skeptical: c.skeptical,
    trust: c.trust,
    patience: c.patience,
    maxPatience: c.maxPatience,
    waited: c.waited,
    busy: c.busy,
    history: c.history.slice(-30),
    weakness: notes ? c.weakness : null,
    baiter: radar ? c.isBaiter : null,
    lastDelta: c.lastDelta ?? null,
    lastApproach: c.lastApproach ?? null,
    deadline: c.deadline || 0,
    stageTimer: c.stageTimer,
  }));

  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    day: room.day,
    strikes: room.strikes,
    bank: room.bank,
    totalEarned: room.totalEarned,
    upgrades: [...room.upgrades],
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, avatar: p.avatar, callId: p.callId, online: p.clients.size > 0 })),
    elapsed: room.elapsed || 0,
    dayLength: room.dayLength || BASE_DAY_SECONDS,
    earned: room.earned || 0,
    quota: room.quota || quotaFor(room),
    bossMood: room.bossMood ?? 60,
    bossVisit: room.bossVisit || 0,
    queue: room.queue,
    ringTimeout: RING_TIMEOUT,
    calls,
    events: room.events,
    review: room.review,
    serverTime: Date.now(),
  };
}

export function broadcast(room) {
  const data = `data: ${JSON.stringify(view(room))}\n\n`;
  for (const p of room.players.values()) for (const res of p.clients) res.write(data);
}

export function allRooms() {
  return rooms.values();
}

export function dropIdleRooms() {
  for (const room of rooms.values()) {
    const anyone = [...room.players.values()].some((p) => p.clients.size > 0);
    if (!anyone && Date.now() - room.lastActive > 10 * 60_000) rooms.delete(room.code);
  }
}
