// Serverseitige Spiellogik. Jeder Raum ist ein gemeinsames Büro;
// Solo-Spiel ist einfach ein Raum mit einem Spieler.

import crypto from "node:crypto";
import {
  FIRST_NAMES, LAST_NAMES, AVATARS, CITIES, QUIRKS, SPEECH_STYLES, BAITER_ALIASES, UPGRADES, CATEGORIES,
} from "./data.js";
import { callerTurn, COMPLY_TRUST } from "./ai.js";
import { prefetchVoice } from "./tts.js";

// Für Tests lässt sich der Arbeitstag per Umgebungsvariable verkürzen
const BASE_DAY_SECONDS = Number(process.env.CALLCENTER_DAY_SECONDS) || 240;
const RING_TIMEOUT = 20;
const MAX_QUEUE = 5;
const BOSS_VISIT_SECONDS = 9;
const PLAYER_COLORS = ["#ffcc33", "#5ab4ff", "#ff7ab6", "#4cd18a", "#b38cff", "#ff8a5c"];

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
  // Freien Schreibtisch suchen (0-5)
  const taken = new Set([...room.players.values()].map((p) => p.desk));
  let desk = 0;
  while (taken.has(desk)) desk++;
  const player = {
    id: id(),
    name: String(name || "").trim().slice(0, 18) || `Agent ${desk + 1}`,
    color: PLAYER_COLORS[desk % PLAYER_COLORS.length],
    desk,
    seated: false,
    pos: { x: 0, z: 7, ry: 0 },
    callId: null,
    pending: [],
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
    if (call) endCall(room, call, null);
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
  return Math.round((300 + (room.day - 1) * 220) * (1 + 0.65 * (n - 1)) / 10) * 10;
}

function startDay(room) {
  for (const p of room.players.values()) {
    p.callId = null;
    p.pending = [];
  }
  Object.assign(room, {
    phase: "day",
    elapsed: 0,
    dayLength: BASE_DAY_SECONDS + (room.upgrades.has("coffee") ? 30 : 0),
    earned: 0,
    quota: quotaFor(room),
    bossMood: 60,
    queue: [],
    calls: new Map(),
    nextRingIn: 4,
    nextBossIn: rand(35, 55),
    bossVisit: 0,
    antivirusLeft: room.upgrades.has("antivirus") ? 1 : 0,
    chargebacks: [],
    stats: { scammed: 0, missed: 0, baitersCaught: 0, viruses: 0, card: 0, giftcard: 0 },
    review: null,
  });
  pushEvent(room, { type: "toast", text: `☀️ Tag ${room.day} beginnt. Quote: ${room.quota} €. Ab an den Platz!` });
}

function makeCaller(room) {
  const gender = Math.random() < 0.5 ? "f" : "m";
  const cats = Object.keys(CATEGORIES).sort(() => Math.random() - 0.5);
  const isBaiter = Math.random() < Math.min(0.1 + room.day * 0.04, 0.33);
  const skeptical = !isBaiter && Math.random() < 0.25 + room.day * 0.04;
  const patience = (skeptical ? 8 : 10) + (room.upgrades.has("headset") ? 2 : 0);
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
    wallet: Math.round(rand(150, 320) * (1 + room.day * 0.15) * (skeptical ? 1.5 : 1) * (room.upgrades.has("leads") ? 1.25 : 1)),
    trust: isBaiter ? 20 : skeptical ? 10 : 25,
    patience,
    maxPatience: patience,
    stage: "ringing",
    owner: null,
    waited: 0,
    busy: false,
    history: [],
    awayUntil: 0,
    awayCalled: false,
    giftcardsGiven: 0,
    cardGiven: false,
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
    if (room.queue.length < MAX_QUEUE) {
      const c = makeCaller(room);
      room.calls.set(c.id, c);
      room.queue.push(c.id);
      pushEvent(room, { type: "ring" });
    }
    const busy = Math.max(4, 12 - room.day) / Math.pow(Math.max(1, room.players.size), 0.7);
    room.nextRingIn = rand(busy, busy + 7);
  }

  for (const cid of [...room.queue]) {
    const c = room.calls.get(cid);
    c.waited += dt;
    if (c.waited >= RING_TIMEOUT) {
      room.queue = room.queue.filter((x) => x !== cid);
      room.calls.delete(cid);
      room.stats.missed++;
      room.bossMood = clamp(room.bossMood - 4, 0, 100);
      pushEvent(room, { type: "toast", text: "📵 Anruf verpasst!" });
    }
  }

  const now = Date.now();
  for (const c of room.calls.values()) {
    if (c.stage !== "away") continue;
    if (!c.awayCalled && now > c.awayUntil + 8000) {
      c.awayCalled = true;
      callerSays(c, "Hallo? Sind Sie noch dran? Ich bin wieder da!");
    } else if (now > c.awayUntil + 35_000) {
      callerSays(c, "Na, dann eben nicht. Ich behalte die Karten!");
      endCall(room, c, "📴 Der Anrufer hat zu lange gewartet.");
    }
  }

  if (room.bossVisit > 0) {
    room.bossVisit -= dt;
    if (room.bossVisit <= 0) bossCheck(room);
  } else {
    room.nextBossIn -= dt;
    if (room.nextBossIn <= 0) {
      room.bossVisit = BOSS_VISIT_SECONDS;
      room.nextBossIn = rand(40, 70);
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
    pushEvent(room, { type: "toast", text: `👔 Chef: „${idle.map((p) => p.name).join(", ")}, fürs Rumstehen bezahle ich euch nicht!“`, bad: true });
  }
}

function endDay(room) {
  let expired = 0;
  for (const p of room.players.values()) {
    expired += p.pending.length;
    p.pending = [];
    p.callId = null;
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
    expired,
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
    case "pos": return movePlayer(player, action);
    case "sit": return sit(room, player, !!action.seated);
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

  switch (action.type) {
    case "answer": return answer(room, player, action.callId);
    case "redeem": return redeem(room, player, action.code);
    case "card": return chargeCard(room, player, action);
  }

  const call = player.callId && room.calls.get(player.callId);
  if (!call) throw new GameError("Du telefonierst gerade nicht.");

  switch (action.type) {
    case "say": return say(room, player, call, action.text);
    case "hangup": return hangUp(room, call);
    default: throw new GameError("Unbekannte Aktion.");
  }
}

function movePlayer(player, { x, z, ry }) {
  if (![x, z, ry].every(Number.isFinite)) return;
  player.pos = { x: clamp(x, -20, 20), z: clamp(z, -20, 20), ry };
}

function sit(room, player, seated) {
  if (!seated && player.callId) {
    const call = room.calls.get(player.callId);
    // Wer aufsteht, legt auf
    if (call) {
      call.history.push({ role: "sys", text: "Du bist aufgestanden und hast aufgelegt." });
      endCall(room, call, null);
    }
  }
  player.seated = seated;
}

function buy(room, upgradeId) {
  if (room.phase !== "review") throw new GameError("Der Shop hat nur nach Feierabend offen.");
  const u = UPGRADES.find((x) => x.id === upgradeId);
  if (!u || room.upgrades.has(u.id)) throw new GameError("Nicht verfügbar.");
  if (room.bank < u.cost) throw new GameError("Nicht genug Geld auf dem Konto.");
  room.bank -= u.cost;
  room.upgrades.add(u.id);
}

function answer(room, player, callId) {
  if (!player.seated) throw new GameError("Setz dich erst an deinen Platz.");
  if (player.callId) throw new GameError("Du bist schon in einem Gespräch.");
  const call = room.calls.get(callId);
  if (!call || call.stage !== "ringing") throw new GameError("Der Anruf ist weg.");
  room.queue = room.queue.filter((x) => x !== callId);
  call.stage = "talk";
  call.owner = player.id;
  player.callId = call.id;
  const shown = call.isBaiter ? call.alias : call.name;
  callerSays(call, pick(["Ja, hallo?", "Hallo? Bin ich da richtig?", `Hallo, hier ist ${shown.split(" ")[1]}?`, "Ja … hallo? Hört man mich?"]));
}

async function say(room, player, call, rawText) {
  const text = String(rawText || "").trim().slice(0, 300);
  if (!text) throw new GameError("Sag doch was!");
  if (call.busy) throw new GameError("Der Anrufer redet noch.");

  if (call.stage === "away") {
    call.history.push({ role: "player", text, by: player.name });
    if (Date.now() < call.awayUntil) {
      call.history.push({ role: "sys", text: pick(["(Keine Antwort. Im Hintergrund klappert eine Tür.)", "(Stille … der Anrufer ist noch unterwegs.)", "(Nur das Ticken einer Wanduhr.)"]) });
    } else {
      giveGiftcard(room, player, call);
    }
    return;
  }
  if (call.stage !== "talk") throw new GameError("Gerade nicht der richtige Moment.");

  call.history.push({ role: "player", text, by: player.name });
  call.patience -= 1;
  call.busy = true;
  let result;
  try {
    result = await callerTurn(call);
  } finally {
    call.busy = false;
  }
  // Der Anruf könnte inzwischen beendet sein (Feierabend, Auflegen, Spieler weg)
  if (room.calls.get(call.id) !== call || call.stage === "done") return;

  call.trust = clamp(call.trust + result.trustDelta, 0, 100);
  call.lastDelta = result.trustDelta;
  callerSays(call, result.reply);

  if (result.hangsUp) {
    endCall(room, call, "📴 Der Anrufer hat aufgelegt.");
    return;
  }

  // Die KI entscheidet, ob der Anrufer mitmacht; der Server prüft nur grob die Spielregeln
  const allowed = result.complies && call.wallet >= 20 && (call.trust >= COMPLY_TRUST - 15 || call.isBaiter);
  if (allowed && result.request === "giftcard") {
    room.stats.giftcard++;
    call.stage = "away";
    call.awayCalled = false;
    call.awayUntil = Date.now() + (room.upgrades.has("kiosk") ? rand(2, 3) : rand(3, 6)) * 1000;
    call.patience = Math.max(call.patience, 3);
    call.history.push({ role: "sys", text: "(Der Anrufer legt den Hörer weg und geht los …)" });
    return;
  }
  if (allowed && result.request === "card" && !call.cardGiven) {
    room.stats.card++;
    giveCard(player, call);
    return;
  }

  if (call.patience <= 0) {
    callerSays(call, "So, ich hab jetzt keine Zeit mehr. Tschüss!");
    endCall(room, call, "📴 Die Geduld war am Ende.");
  }
}

// Absichtlich offensichtlich unechte Spielwerte
const CODE_CHARS = "ACEFHKMNPRTXY34679";
function fakeGiftCode() {
  return Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => pick(CODE_CHARS.split(""))).join("")).join("-");
}
function fakeCardNumber() {
  return ["0000", ...Array.from({ length: 3 }, () => String(randInt(0, 9999)).padStart(4, "0"))].join(" ");
}

// Anrufer sagt etwas; die Stimme wird sofort im Hintergrund erzeugt
function callerSays(call, text, extra = {}) {
  call.history.push({ role: "caller", text, ...extra });
  prefetchVoice(call, text);
}

function giveGiftcard(room, player, call) {
  const amount = Math.min(call.wallet, Math.max(20, Math.round((call.wallet * rand(0.4, 0.65)) / 5) * 5));
  call.wallet -= amount;
  call.giftcardsGiven++;
  call.stage = "talk";
  call.patience = Math.max(call.patience, 3);
  const code = fakeGiftCode();
  player.pending.push({ type: "giftcard", code, amount, baiter: call.isBaiter, callId: call.id });
  callerSays(call, `${pick(["Ja, ja, ich bin wieder da! Puh, ganz außer Atem.", "So, da bin ich wieder!", "Ja, hier! Ich hab sie!"])} Ich hab eine Karte über ${amount} Euro. Der Code ist ${code}.`, { secret: true });
}

function giveCard(player, call) {
  call.cardGiven = true;
  const card = {
    number: fakeCardNumber(),
    expiry: `${String(randInt(1, 12)).padStart(2, "0")}/${randInt(27, 31)}`,
    cvc: String(randInt(0, 999)).padStart(3, "0"),
  };
  // Mit der Karte wird abgebucht, was der Anrufer noch hat
  player.pending.push({ type: "card", ...card, amount: call.wallet, baiter: call.isBaiter, callId: call.id });
  call.wallet = 0;
  callerSays(call, `So, Brille auf … Die Nummer ist ${card.number}. Gültig bis ${card.expiry}. Und hinten steht ${card.cvc}.`, { secret: true });
}

const normalize = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function redeem(room, player, rawCode) {
  if (!player.seated) throw new GameError("Das Gutschein-Portal gibt's nur am PC.");
  const code = normalize(rawCode);
  if (!code) throw new GameError("Gib einen Code ein.");
  const item = player.pending.find((p) => p.type === "giftcard" && normalize(p.code) === code);
  if (!item) {
    pushEvent(room, { type: "toast", text: "❌ Ungültiger Gutscheincode.", target: player.id, bad: true });
    return;
  }
  player.pending = player.pending.filter((p) => p !== item);
  payout(room, player, item, "giftcard");
}

function chargeCard(room, player, { number, expiry, cvc }) {
  if (!player.seated) throw new GameError("Das Kartenterminal gibt's nur am PC.");
  const item = player.pending.find((p) => p.type === "card"
    && normalize(p.number) === normalize(number)
    && normalize(p.expiry) === normalize(expiry)
    && normalize(p.cvc) === normalize(cvc));
  if (!item) {
    pushEvent(room, { type: "toast", text: "❌ Zahlung abgelehnt. Kartendaten falsch.", target: player.id, bad: true });
    return;
  }
  player.pending = player.pending.filter((p) => p !== item);
  const risk = room.upgrades.has("terminal") ? 0.1 : 0.3;
  if (!item.baiter && Math.random() < risk) room.chargebacks.push(item.amount);
  payout(room, player, item, "card");
}

function payout(room, player, item, method) {
  const call = room.calls.get(item.callId);
  if (item.baiter) {
    if (room.antivirusLeft > 0) {
      room.antivirusLeft--;
      pushEvent(room, { type: "toast", text: "🛡️ Antivirus hat einen Virus geblockt. Das war ein Scambaiter!" });
    } else {
      const loss = Math.round(Math.max(0, room.earned) * 0.35);
      room.earned -= loss;
      room.stats.viruses++;
      room.bossMood = clamp(room.bossMood - 20, 0, 100);
      pushEvent(room, { type: "virus", target: player.id, text: `🦠 ${player.name} ist auf einen Scambaiter reingefallen! Virus kostet ${loss} €. Das Video geht viral …`, bad: true });
    }
    if (call && call.stage !== "done") {
      callerSays(call, "HAHA! Gruß an meine 2 Millionen Zuschauer! 👋");
      endCall(room, call, null);
    }
    return;
  }
  room.earned += item.amount;
  room.totalEarned += item.amount;
  room.stats.scammed++;
  room.bossMood = clamp(room.bossMood + 5, 0, 100);
  pushEvent(room, { type: "cash", text: `💸 ${player.name}: +${item.amount} € (${method === "card" ? "Kreditkarte" : "Gutschein"})` });
}

function hangUp(room, call) {
  if (call.isBaiter) {
    room.stats.baitersCaught++;
    room.bossMood = clamp(room.bossMood + 8, 0, 100);
    endCall(room, call, "🕵️ Scambaiter durchschaut! Der Chef nickt anerkennend.");
  } else {
    endCall(room, call, null);
  }
}

function endCall(room, call, message) {
  call.stage = "done";
  const owner = room.players.get(call.owner);
  if (owner && owner.callId === call.id) owner.callId = null;
  if (message) pushEvent(room, { type: "toast", text: message, target: call.owner, bad: true });
  // Kurz sichtbar lassen, damit der Spieler die letzte Zeile sieht
  setTimeout(() => room.calls.delete(call.id), 3000);
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
    history: c.history.slice(-40),
    weakness: notes ? c.weakness : null,
    baiter: radar ? c.isBaiter : null,
    lastDelta: c.lastDelta ?? null,
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
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, color: p.color, desk: p.desk, seated: p.seated, pos: p.pos,
      callId: p.callId, online: p.clients.size > 0,
    })),
    elapsed: room.elapsed || 0,
    dayLength: room.dayLength || BASE_DAY_SECONDS,
    earned: room.earned || 0,
    quota: room.quota || quotaFor(room),
    bossMood: room.bossMood ?? 60,
    bossVisit: room.bossVisit || 0,
    bossVisitLength: BOSS_VISIT_SECONDS,
    queue: room.queue,
    ringTimeout: RING_TIMEOUT,
    calls,
    events: room.events,
    review: room.review,
    serverTime: Date.now(),
  };
}

// Für die Sprachausgabe: nur Sätze, die ein Anrufer in diesem Büro wirklich gesagt hat
export function callerLine(room, playerId, callId, index) {
  if (!room.players.has(playerId)) throw new GameError("Unbekannter Spieler.");
  const call = room.calls.get(callId);
  // Die Ansicht schickt nur die letzten 40 Zeilen, der Index bezieht sich darauf
  const offset = call ? Math.max(0, call.history.length - 40) : 0;
  const line = call && call.history[offset + Number(index)];
  if (!line || line.role !== "caller") throw new GameError("Diese Zeile gibt es nicht.");
  return { call, text: line.text };
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
