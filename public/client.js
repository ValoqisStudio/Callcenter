import { createOffice } from "./office3d.js";

// ---------------------------------------------------------------------------
// Grundlagen
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const euro = (n) => `${Math.round(n).toLocaleString("de-DE")} €`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const BOSS_FACES = ["😡", "😠", "😐", "🙂", "😁"];

let config = { ai: { mode: "offline" }, upgrades: [], samples: {}, categories: {} };
let session = null; // { code, playerId }
let state = null;
let prevPhase = null;
let source = null;
let clockOffset = 0;
let lastEventId = -1;
let watchCallId = null;
let lastCall = null; // letztes eigenes Gespräch, bleibt nach dem Auflegen lesbar
let office = null;
let seated = false;

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(sessionStorage.getItem(key) || "null");
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
}

function toast(text, opts = {}) {
  const el = document.createElement("div");
  el.className = `toast${opts.bad ? " bad" : ""}${opts.mine ? " mine" : ""}`;
  el.textContent = text;
  $("toasts").appendChild(el);
  while ($("toasts").children.length > 4) $("toasts").firstChild.remove();
  setTimeout(() => el.remove(), 3500);
}

// ---------------------------------------------------------------------------
// Sound (WebAudio, ohne Dateien)
// ---------------------------------------------------------------------------

let audioCtx;
function beep(freq, duration = 0.12, type = "sine", volume = 0.07) {
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
  } catch {
    // Kein Audio verfügbar
  }
}
const sfx = {
  ring: () => [0, 200, 600, 800].forEach((t) => setTimeout(() => beep(880, 0.15), t)),
  pickup: () => beep(420, 0.08, "square", 0.04),
  bad: () => beep(180, 0.25, "square", 0.05),
  cash: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.12, "triangle"), i * 80)),
  boss: () => { beep(300, 0.3, "square", 0.04); setTimeout(() => beep(250, 0.3, "square", 0.04), 300); },
  virus: () => { for (let i = 0; i < 10; i++) setTimeout(() => beep(100 + Math.random() * 800, 0.08, "sawtooth", 0.05), i * 60); },
  coffee: () => { for (let i = 0; i < 6; i++) setTimeout(() => beep(150 + Math.random() * 60, 0.1, "sawtooth", 0.02), i * 90); },
};

// ---------------------------------------------------------------------------
// Stimmen: Vorlesen (Text-to-Speech) und Spracheingabe (Speech-to-Text)
// ---------------------------------------------------------------------------

let voiceOn = store("voiceOn") ?? true;
let germanVoices = [];
function loadVoices() {
  if (!("speechSynthesis" in window)) return;
  germanVoices = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith("de"));
}
if ("speechSynthesis" in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

const FEMALE_HINT = /(anna|katja|hedda|petra|marlene|vicki|female|frau|helena|sabine|amala|elke|seraphina|katharina|louisa|gisela|ingrid)/i;
function voiceFor(call) {
  if (!germanVoices.length) return null;
  const female = germanVoices.filter((v) => FEMALE_HINT.test(v.name));
  const male = germanVoices.filter((v) => !FEMALE_HINT.test(v.name));
  const pool = call.gender === "f" ? (female.length ? female : germanVoices) : (male.length ? male : germanVoices);
  const hash = [...call.id].reduce((h, ch) => h + ch.charCodeAt(0), 0);
  return pool[hash % pool.length];
}

const CODE_RE = /\b[A-Z0-9]{4}(?:-[A-Z0-9]{4})+\b/g;

function speak(call, text) {
  if (!voiceOn || !("speechSynthesis" in window)) return;
  const clean = text
    .replace(/\*[^*]*\*/g, " ")
    .replace(/[👋💸🦠]/gu, "")
    // Codes und Kartennummern Zeichen für Zeichen vorlesen
    .replace(CODE_RE, (code) => code.split("-").map((g) => g.split("").join(" ")).join(", Strich, "))
    .replace(/\d{3,}/g, (d) => d.split("").join(" "))
    .trim();
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = "de-DE";
  const v = voiceFor(call);
  if (v) u.voice = v;
  u.pitch = clamp((call.gender === "f" ? 1.15 : 0.8) + (call.age > 80 ? -0.15 : 0), 0.1, 2);
  u.rate = call.age > 80 ? 0.88 : 0.98;
  speechSynthesis.speak(u);
}

function stopSpeaking() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
let listening = false;

function startListening() {
  if (!Recognition || listening) return;
  const call = myCall();
  if (!call || !canTalk(call)) return;
  stopSpeaking();
  recognizer = new Recognition();
  recognizer.lang = "de-DE";
  recognizer.interimResults = true;
  recognizer.continuous = true;
  recognizer.onresult = (e) => {
    let text = "";
    for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
    $("in-say").value = text.trim();
  };
  recognizer.onerror = (e) => {
    if (e.error === "not-allowed") toast("🎤 Mikrofon-Zugriff wurde verweigert.", { bad: true });
  };
  recognizer.onend = () => {
    listening = false;
    $("btn-mic").classList.remove("listening");
    if ($("in-say").value.trim()) sendSay();
  };
  recognizer.start();
  listening = true;
  $("btn-mic").classList.add("listening");
}

function stopListening() {
  if (recognizer && listening) recognizer.stop();
}

// ---------------------------------------------------------------------------
// Server-Kommunikation
// ---------------------------------------------------------------------------

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

async function act(action, { quiet = false } = {}) {
  try {
    await api("/api/action", { code: session.code, playerId: session.playerId, action });
  } catch (err) {
    if (!quiet) toast(err.message, { bad: true });
  }
}

function connect() {
  if (source) source.close();
  source = new EventSource(`/api/events?code=${encodeURIComponent(session.code)}&player=${encodeURIComponent(session.playerId)}`);
  source.onmessage = (e) => {
    state = JSON.parse(e.data);
    clockOffset = state.serverTime - Date.now();
    handleEvents();
    render();
  };
  source.onerror = () => {
    // EventSource verbindet sich selbst neu. Ist der Raum weg, zurück ins Menü.
    setTimeout(() => {
      if (!source || source.readyState !== EventSource.CLOSED) return;
      store("session", null);
      session = null;
      showScreen("screen-menu");
      toast("Verbindung zum Büro verloren.", { bad: true });
    }, 3000);
  };
}

async function enterRoom(promise) {
  try {
    const { code, playerId } = await promise;
    session = { code, playerId };
    store("session", session);
    lastEventId = -1;
    connect();
  } catch (err) {
    toast(err.message, { bad: true });
  }
}

function playerName() {
  const name = $("in-name").value.trim();
  store("name", name);
  return name;
}

// ---------------------------------------------------------------------------
// Zustand auswerten
// ---------------------------------------------------------------------------

const me = () => state && session && state.players.find((p) => p.id === session.playerId);

function myCall() {
  if (!state) return null;
  const p = me();
  const active = p && p.callId && state.calls.find((c) => c.id === p.callId);
  if (active) return active;
  return state.calls.find((c) => c.owner === session.playerId && c.stage === "done") || null;
}

function canTalk(call) {
  return (call.stage === "talk" || call.stage === "away") && !call.busy;
}

function handleEvents() {
  const events = state.events || [];
  if (lastEventId < 0) {
    lastEventId = events.length ? events[events.length - 1].id : 0;
    return;
  }
  for (const ev of events) {
    if (ev.id <= lastEventId) continue;
    lastEventId = ev.id;
    switch (ev.type) {
      case "ring": sfx.ring(); break;
      case "boss": sfx.boss(); break;
      case "cash": sfx.cash(); toast(ev.text); break;
      case "virus":
        toast(ev.text, { bad: true });
        if (ev.target === session.playerId) {
          sfx.virus();
          $("virus").classList.remove("hidden");
          document.body.classList.add("glitch");
          setTimeout(() => { $("virus").classList.add("hidden"); document.body.classList.remove("glitch"); }, 1800);
        }
        break;
      default:
        if (ev.text && (!ev.target || ev.target === session.playerId)) {
          if (ev.bad) sfx.bad();
          toast(ev.text, { bad: ev.bad, mine: ev.target === session.playerId });
        }
    }
  }
}

// ---------------------------------------------------------------------------
// Sitzen & Laufen
// ---------------------------------------------------------------------------

function ensureOffice() {
  if (office) return;
  office = createOffice($("view3d"), {
    canMove: () => state && state.phase === "day" && !seated,
    onSit: () => sitDown(),
    onCoffee: () => { sfx.coffee(); toast("☕ Ahh, frischer Kaffee. Weiter geht's!"); },
    onHint: (text) => toast(text),
    onFocus: (text) => {
      $("focus-hint").textContent = text || "";
      $("focus-hint").classList.toggle("hidden", !text);
    },
    onLockChange: () => renderOverlays(),
  });
  // Position regelmäßig an die anderen melden
  let lastPose = "";
  setInterval(() => {
    if (!state || !office || seated) return;
    const p = office.pose();
    const key = `${p.x.toFixed(2)}|${p.z.toFixed(2)}|${p.ry.toFixed(2)}`;
    if (key === lastPose) return;
    lastPose = key;
    act({ type: "pos", ...p }, { quiet: true });
  }, 150);
}

function sitDown() {
  const p = me();
  if (!p || seated || state.phase !== "day") return;
  seated = true;
  office.sitAt(p.desk);
  act({ type: "sit", seated: true });
  renderOverlays();
  setTimeout(() => $("in-say").focus(), 400);
}

function standUp() {
  if (!seated) return;
  stopListening();
  stopSpeaking();
  seated = false;
  office.stand();
  act({ type: "sit", seated: false });
  document.activeElement?.blur();
  renderOverlays();
}

function goToDesk() {
  const p = me();
  if (!p || state.phase !== "day") return;
  office.placeNear(p.desk);
  sitDown();
}

// ---------------------------------------------------------------------------
// Darstellung
// ---------------------------------------------------------------------------

function render() {
  if (!state) return;
  const phase = state.phase;
  if (phase === "lobby") {
    renderLobby();
    showScreen("screen-lobby");
  } else {
    showScreen("screen-game");
    ensureOffice();
    office.update(state, session.playerId);
    if (phase === "day" && prevPhase !== "day") {
      // Neuer Arbeitstag: vor den eigenen Platz stellen
      seated = false;
      lastCall = null;
      $("notes").value = "";
      office.placeNear(me().desk);
    }
    if (phase !== "day" && seated) {
      seated = false;
      office.stand();
    }
    renderHud();
    if (seated) renderPc();
  }
  renderOverlays();
  $("review").classList.toggle("hidden", phase !== "review");
  $("gameover").classList.toggle("hidden", phase !== "gameover");
  if (phase === "review") renderReview();
  if (phase === "gameover") renderGameOver();
  prevPhase = phase;
}

function renderOverlays() {
  if (!state || state.phase === "lobby") return;
  const day = state.phase === "day";
  const locked = office && office.isLocked();
  $("pc").classList.toggle("hidden", !(day && seated));
  $("click-to-play").classList.toggle("hidden", !day || seated || locked);
  $("crosshair").classList.toggle("hidden", !locked);
  if (!locked) $("focus-hint").classList.add("hidden");
}

function renderLobby() {
  $("lobby-code").textContent = state.code;
  $("lobby-players").innerHTML = state.players
    .map((p) => `<li style="border-color:${p.color}">${escapeHtml(p.name)} · Platz ${p.desk + 1}${p.id === state.hostId ? " 👑" : ""}${p.id === session.playerId ? " (du)" : ""}</li>`)
    .join("");
  $("lobby-ai").textContent = aiText();
}

function aiText() {
  return config.ai.mode === "claude"
    ? `🤖 Anrufer werden von Claude gespielt (${config.ai.model}).`
    : "🤖 Offline-KI aktiv. Für echte KI-Gespräche den Server mit ANTHROPIC_API_KEY starten.";
}

function clockText() {
  const minutes = Math.floor(clamp(state.elapsed / state.dayLength, 0, 1) * 8 * 60);
  return `${String(9 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function renderHud() {
  $("hud-day").textContent = state.day;
  $("hud-clock").textContent = clockText();
  $("hud-quota").textContent = `${euro(state.earned)} / ${euro(state.quota)}`;
  const bar = $("hud-quota-bar");
  bar.style.width = `${clamp((state.earned / state.quota) * 100, 0, 100)}%`;
  bar.style.background = state.earned >= state.quota ? "var(--good)" : "";
  $("hud-boss").textContent = BOSS_FACES[Math.min(4, Math.floor(state.bossMood / 20))];
  $("hud-strikes").textContent = "●".repeat(state.strikes) + "○".repeat(Math.max(0, 3 - state.strikes));
  $("hud-bank").textContent = euro(state.bank);
  $("hud-code").textContent = state.code;
  $("btn-voice").textContent = voiceOn ? "🔊" : "🔇";
  const ringing = state.phase === "day" ? state.queue.length : 0;
  $("hud-ringing").classList.toggle("hidden", !ringing || !!(me() && me().callId));
  $("hud-ring-count").textContent = ringing;
  $("boss-alert").classList.toggle("hidden", !(state.phase === "day" && state.bossVisit > 0));
}

function renderPc() {
  $("pc-desk").textContent = me().desk + 1;
  $("pc-clock").textContent = `${clockText()} Uhr`;
  renderQueue();
  renderCall();
}

function renderQueue() {
  const ul = $("call-queue");
  const busy = !!(me() && me().callId);
  const ringing = state.queue.map((id) => state.calls.find((c) => c.id === id)).filter(Boolean);
  // Nur neu aufbauen, wenn sich die Liste ändert, sonst nur die Balken bewegen
  const key = ringing.map((c) => c.id).join(",") + busy;
  if (ul.dataset.key !== key) {
    ul.dataset.key = key;
    ul.innerHTML = "";
    for (const c of ringing) {
      const li = document.createElement("li");
      li.className = "call-item";
      li.dataset.id = c.id;
      li.innerHTML = `<span>📳</span><div class="who">Anruf aus ${escapeHtml(c.city)}<div class="wait"></div></div>`;
      const btn = document.createElement("button");
      btn.textContent = "Abnehmen";
      btn.disabled = busy;
      btn.onclick = () => {
        btn.disabled = true;
        watchCallId = null;
        lastCall = null;
        sfx.pickup();
        act({ type: "answer", callId: c.id });
        setTimeout(() => $("in-say").focus(), 200);
      };
      li.appendChild(btn);
      ul.appendChild(li);
    }
  }
  for (const li of ul.children) {
    const c = state.calls.find((x) => x.id === li.dataset.id);
    if (c) li.querySelector(".wait").style.width = `${100 - (c.waited / state.ringTimeout) * 100}%`;
  }
  $("queue-empty").classList.toggle("hidden", ringing.length > 0);

  const team = state.calls.filter((c) => c.owner && c.owner !== session.playerId && c.stage !== "done");
  $("team-calls").innerHTML = "";
  for (const c of team) {
    const owner = state.players.find((p) => p.id === c.owner);
    const li = document.createElement("li");
    li.style.borderColor = owner ? owner.color : "";
    li.className = watchCallId === c.id ? "watching" : "";
    li.innerHTML = `${owner ? escapeHtml(owner.name) : "?"} ↔ ${escapeHtml(c.name)} <span class="hint">(mithören)</span>`;
    li.onclick = () => { watchCallId = watchCallId === c.id ? null : c.id; render(); };
    $("team-calls").appendChild(li);
  }
  $("team-empty").classList.toggle("hidden", team.length > 0);
}

let renderedCallId = null;
let renderedHistory = 0;
let spokenUpTo = 0;

function renderCall() {
  let call = myCall();
  let readonly = false;
  if (call) {
    lastCall = call;
  } else if (watchCallId) {
    call = state.calls.find((c) => c.id === watchCallId) || null;
    if (!call) watchCallId = null;
    readonly = !!call;
  }
  // Nach dem Auflegen bleibt das letzte Gespräch lesbar (z. B. um den Code nachzulesen)
  if (!call && lastCall) call = { ...lastCall, stage: "done", busy: false };

  $("caller-box").classList.toggle("hidden", !call);
  $("pc").classList.toggle("readonly", readonly || !call || call.stage === "done");
  if (!call) {
    renderedCallId = null;
    $("dialog").innerHTML = `<p class="hint dialog-empty">Kein Gespräch. Nimm einen Anruf an.</p>`;
    $("talk-row").classList.add("hidden");
    $("cheats").classList.add("hidden");
    return;
  }

  if (call.id !== renderedCallId) {
    renderedCallId = call.id;
    renderedHistory = 0;
    spokenUpTo = readonly ? call.history.length : 0;
    $("dialog").innerHTML = "";
    $("in-say").value = "";
    stopSpeaking();
  }

  $("caller-avatar").textContent = call.avatar;
  $("caller-name").textContent = call.name;
  $("caller-meta").textContent = `${call.age} Jahre · ${call.city}`;
  const tags = [];
  if (call.stage === "away") tags.push(`<span>🚶 unterwegs</span>`);
  if (call.stage === "done") tags.push(`<span>aufgelegt</span>`);
  if (call.skeptical) tags.push(`<span>misstrauisch</span>`);
  if (call.weakness) tags.push(`<span class="weak">Schwäche: ${config.categories[call.weakness]}</span>`);
  if (call.baiter) tags.push(`<span class="baiter">⚠️ Scambaiter!</span>`);
  if (readonly) tags.push(`<span>👂 du hörst mit</span>`);
  $("caller-tags").innerHTML = tags.join("");

  $("trust-bar").style.width = `${call.trust}%`;
  $("patience-bar").style.width = `${(call.patience / call.maxPatience) * 100}%`;
  const d = $("trust-delta");
  if (call.lastDelta) {
    d.textContent = `${call.lastDelta > 0 ? "+" : ""}${call.lastDelta}`;
    d.className = `delta ${call.lastDelta > 0 ? "up" : "down"}`;
  } else {
    d.textContent = "";
  }

  // Neue Nachrichten anhängen
  const dialog = $("dialog");
  dialog.querySelector(".typing")?.remove();
  for (let i = renderedHistory; i < call.history.length; i++) {
    const m = call.history[i];
    const div = document.createElement("div");
    div.className = `msg ${m.role === "player" ? "me" : m.role === "caller" ? "them" : "sys"}`;
    let body = escapeHtml(m.text);
    // Codes und Kartendaten nur vorlesen, nicht anzeigen: Mitschreiben ist Teil des Spiels
    if (m.secret && voiceOn && germanVoices.length && !readonly) {
      body = body
        .replace(CODE_RE, (c) => `<span class="secret" title="Hör genau hin!">${c.replace(/[A-Z0-9]/g, "•")}</span>`)
        .replace(/\d[\d ,/]*\d/g, (x) => `<span class="secret" title="Hör genau hin!">${x.replace(/\d/g, "•")}</span>`)
        + ` <button class="replay" title="Nochmal vorlesen">🔁</button>`;
    }
    div.innerHTML = (m.by && m.role === "player" ? `<span class="by">${escapeHtml(m.by)}</span>` : "") + body;
    const snapshot = call;
    div.querySelector(".replay")?.addEventListener("click", () => speak(snapshot, m.text));
    dialog.appendChild(div);
    if (m.role === "caller" && i >= spokenUpTo) speak(call, m.text);
  }
  spokenUpTo = Math.max(spokenUpTo, call.history.length);
  renderedHistory = call.history.length;
  if (call.busy) {
    const t = document.createElement("div");
    t.className = "msg them typing";
    t.textContent = `${call.name.split(" ")[0]} überlegt …`;
    dialog.appendChild(t);
  }
  dialog.scrollTop = dialog.scrollHeight;

  const talk = canTalk(call) && !readonly;
  $("talk-row").classList.toggle("hidden", call.stage === "done");
  $("cheats").classList.toggle("hidden", call.stage !== "talk");
  $("in-say").disabled = !talk;
  $("btn-say").disabled = !talk;
  $("btn-mic").disabled = !talk || !Recognition;
  $("btn-mic").title = Recognition ? "Sprechen (Taste V gedrückt halten)" : "Spracheingabe wird von diesem Browser nicht unterstützt (Chrome/Edge nutzen)";
  $("in-say").placeholder = call.stage === "away"
    ? "Der Anrufer ist unterwegs … frag gleich, ob er wieder da ist."
    : "Was sagst du? (Enter zum Senden)";
}

function renderCheats() {
  const box = $("cheats");
  box.innerHTML = "";
  const add = (label, cls, lines) => {
    const btn = document.createElement("button");
    if (cls) btn.className = cls;
    btn.textContent = label;
    btn.title = "Spickzettel: fügt einen Beispielsatz ein";
    btn.onclick = () => {
      $("in-say").value = pick(lines);
      $("in-say").focus();
    };
    box.appendChild(btn);
  };
  for (const [cat, label] of Object.entries(config.categories)) add(`📝 ${label}`, `cat-${cat}`, config.samples[cat] || [""]);
  add("🎁 Gutschein verlangen", "ask-gift", [
    "Damit ich Ihnen helfen kann, brauche ich eine Google-Play-Gutscheinkarte. Gehen Sie bitte schnell zum Kiosk.",
    "Holen Sie bitte eine Gutscheinkarte von der Tankstelle, damit bezahlen wir die Reparatur.",
  ]);
  add("💳 Karte verlangen", "ask-card", ["Zur Bestätigung lesen Sie mir bitte Ihre Kreditkartennummer, das Ablaufdatum und die Prüfnummer vor."]);
}

function renderReview() {
  const r = state.review;
  if (!r) return;
  const s = r.stats;
  $("review-title").textContent = `Mitarbeitergespräch, Tag ${r.day}`;
  $("review-body").innerHTML = `
    <div class="stat-line"><span>Eingenommen</span><b>${euro(r.earned)} / ${euro(r.quota)}</b></div>
    ${r.chargeback ? `<div class="stat-line"><span>Rückbuchungen der Bank (${r.chargebackCount}×)</span><b class="bad">−${euro(r.chargeback)}</b></div>` : ""}
    ${r.expired ? `<div class="stat-line"><span>Nicht eingelöste Codes/Karten</span><b class="bad">${r.expired}</b></div>` : ""}
    <div class="stat-line"><span>Erfolgreiche Abbuchungen</span><b>${s.scammed}</b></div>
    <div class="stat-line"><span>Gutschein-Gänge / Karten vorgelesen</span><b>${s.giftcard} / ${s.card}</b></div>
    <div class="stat-line"><span>Verpasste Anrufe</span><b>${s.missed}</b></div>
    <div class="stat-line"><span>Scambaiter entlarvt</span><b>${s.baitersCaught}</b></div>
    <div class="stat-line"><span>Viren eingefangen</span><b>${s.viruses}</b></div>
    <div class="stat-line"><span>Chef-Laune</span><b>${BOSS_FACES[Math.min(4, Math.floor(r.bossMood / 20))]}</b></div>
    <div class="stat-line"><span>Provision fürs Team (25 %)</span><b class="good">+${euro(r.commission)}</b></div>
    <p class="${r.verdictGood ? "good" : "bad"}">${escapeHtml(r.verdict)}</p>`;
  $("shop-bank").textContent = euro(state.bank);

  const key = state.upgrades.join(",") + state.bank;
  const shop = $("shop");
  if (shop.dataset.key === key) return;
  shop.dataset.key = key;
  shop.innerHTML = "";
  for (const u of config.upgrades) {
    const owned = state.upgrades.includes(u.id);
    const div = document.createElement("div");
    div.className = "shop-item";
    div.innerHTML = `<div class="desc"><b>${u.name}</b><small>${u.desc}</small></div>`;
    const btn = document.createElement("button");
    btn.textContent = owned ? "✔ Gekauft" : euro(u.cost);
    btn.disabled = owned || state.bank < u.cost;
    btn.onclick = () => { sfx.cash(); act({ type: "buy", upgrade: u.id }); };
    div.appendChild(btn);
    shop.appendChild(div);
  }
}

function renderGameOver() {
  const days = state.review ? state.review.day : state.day;
  $("gameover-text").innerHTML =
    `Ihr habt ${days} ${days === 1 ? "Tag" : "Tage"} überlebt und insgesamt ${euro(state.totalEarned)} eingenommen.<br><br>` +
    "Die Polizei interessiert sich übrigens auch schon für den Laden …";
}

// ---------------------------------------------------------------------------
// Eingaben
// ---------------------------------------------------------------------------

function sendSay() {
  const text = $("in-say").value.trim();
  const call = myCall();
  if (!text || !call || !canTalk(call)) return;
  $("in-say").value = "";
  act({ type: "say", text });
}

$("btn-solo").onclick = () => enterRoom(api("/api/rooms", { name: playerName() }).then(async (r) => {
  await api("/api/action", { code: r.code, playerId: r.playerId, action: { type: "start" } });
  return r;
}));
$("btn-create").onclick = () => enterRoom(api("/api/rooms", { name: playerName() }));
$("btn-join").onclick = () => enterRoom(api("/api/rooms/join", { code: $("in-code").value.trim(), name: playerName() }));
$("in-code").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-join").click(); });
$("btn-start").onclick = () => act({ type: "start" });
$("btn-next-day").onclick = () => act({ type: "start" });
$("btn-restart").onclick = () => act({ type: "restart" });
$("btn-hangup").onclick = () => { stopSpeaking(); act({ type: "hangup" }); };
$("btn-say").onclick = sendSay;
$("btn-stand").onclick = standUp;
$("btn-goto-desk").onclick = goToDesk;
$("click-to-play").onclick = () => office && office.lock();
$("in-say").addEventListener("keydown", (e) => { if (e.key === "Enter") sendSay(); });
$("btn-voice").onclick = () => {
  voiceOn = !voiceOn;
  store("voiceOn", voiceOn);
  if (!voiceOn) stopSpeaking();
  render();
};

$("redeem-form").onsubmit = (e) => {
  e.preventDefault();
  const code = $("in-gift").value.trim();
  if (!code) return;
  act({ type: "redeem", code });
  $("in-gift").value = "";
};
$("card-form").onsubmit = (e) => {
  e.preventDefault();
  act({ type: "card", number: $("card-number").value, expiry: $("card-expiry").value, cvc: $("card-cvc").value });
};

// Tastatur: Esc = aufstehen, Tab = direkt an den Platz, V gedrückt halten = sprechen
const typingTarget = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
$("btn-mic").onclick = () => (listening ? stopListening() : startListening());
document.addEventListener("keydown", (e) => {
  if (!state || state.phase !== "day") return;
  if (e.key === "Escape" && seated) {
    if (typingTarget(document.activeElement)) document.activeElement.blur();
    else standUp();
    return;
  }
  if (e.key === "Tab" && !seated && !typingTarget(document.activeElement)) {
    e.preventDefault();
    goToDesk();
    return;
  }
  if (e.key.toLowerCase() === "v" && seated && !e.repeat && !typingTarget(document.activeElement)) {
    e.preventDefault();
    startListening();
  }
});
document.addEventListener("keyup", (e) => {
  if (e.key.toLowerCase() === "v" && listening) stopListening();
});

// Lesezugriff für Debugging und automatisierte Tests
window.callcenter = { state: () => state, session: () => session, myCall };

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

(async function init() {
  $("in-name").value = store("name") || "";
  try {
    config = await api("/api/config");
  } catch {
    toast("Server nicht erreichbar. Starte ihn mit „npm start“.", { bad: true });
  }
  $("ai-status").textContent = aiText();
  if (!Recognition) $("ai-status").textContent += " 🎤 Spracheingabe geht nur in Chrome oder Edge.";
  renderCheats();

  // Nach einem Neuladen wieder ins selbe Büro
  const saved = store("session");
  if (saved) {
    session = saved;
    connect();
  }
})();
