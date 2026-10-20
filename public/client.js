"use strict";

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
let source = null;
let clockOffset = 0;
let lastEventId = -1;
let watchCallId = null;

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
  ring: () => { beep(880, 0.15); setTimeout(() => beep(880, 0.15), 200); },
  bad: () => beep(180, 0.25, "square", 0.05),
  cash: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.12, "triangle"), i * 80)),
  boss: () => { beep(300, 0.3, "square", 0.04); setTimeout(() => beep(250, 0.3, "square", 0.04), 300); },
  virus: () => { for (let i = 0; i < 10; i++) setTimeout(() => beep(100 + Math.random() * 800, 0.08, "sawtooth", 0.05), i * 60); },
  click: () => beep(600 + Math.random() * 200, 0.04),
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

const FEMALE_HINT = /(anna|katja|hedda|petra|marlene|vicki|female|frau|helena|sabine|amala|conrad?a|elke|seraphina|katharina|louisa|gisela|ingrid)/i;
function voiceFor(call) {
  if (!germanVoices.length) return null;
  const female = germanVoices.filter((v) => FEMALE_HINT.test(v.name));
  const male = germanVoices.filter((v) => !FEMALE_HINT.test(v.name));
  const pool = call.gender === "f" ? (female.length ? female : germanVoices) : (male.length ? male : germanVoices);
  // Gleicher Anrufer, gleiche Stimme
  const hash = [...call.id].reduce((h, ch) => h + ch.charCodeAt(0), 0);
  return pool[hash % pool.length];
}

function speak(call, text) {
  if (!voiceOn || !("speechSynthesis" in window)) return;
  const clean = text
    .replace(/\*[^*]*\*/g, " ")
    .replace(/[👋💸🦠]/gu, "")
    .replace(/\d{3,}/g, (d) => d.split("").join(" ")) // Kartennummern Ziffer für Ziffer
    .trim();
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = "de-DE";
  const v = voiceFor(call);
  if (v) u.voice = v;
  const agePitch = call.age > 80 ? -0.15 : 0;
  u.pitch = clamp((call.gender === "f" ? 1.15 : 0.8) + agePitch, 0.1, 2);
  u.rate = call.age > 80 ? 0.88 : 0.98;
  speechSynthesis.speak(u);
}

function stopSpeaking() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
let listening = false;
let heard = "";

function startListening() {
  if (!Recognition || listening) return;
  const call = myCall();
  if (!call || !canTalk(call)) return;
  stopSpeaking();
  recognizer = new Recognition();
  recognizer.lang = "de-DE";
  recognizer.interimResults = true;
  recognizer.continuous = true;
  heard = "";
  recognizer.onresult = (e) => {
    let finalText = "";
    let interim = "";
    for (let i = 0; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    heard = (finalText + " " + interim).trim();
    $("in-say").value = heard;
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

async function act(action) {
  try {
    await api("/api/action", { code: session.code, playerId: session.playerId, action });
  } catch (err) {
    toast(err.message, { bad: true });
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
    setTimeout(async () => {
      if (source.readyState !== EventSource.CLOSED) return;
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

const me = () => state && state.players.find((p) => p.id === session.playerId);
const serverNow = () => Date.now() + clockOffset;

function myCall() {
  if (!state) return null;
  const p = me();
  const active = p && p.callId && state.calls.find((c) => c.id === p.callId);
  if (active) return active;
  return state.calls.find((c) => c.owner === session.playerId && c.stage === "done") || null;
}

function canTalk(call) {
  return (call.stage === "talk" || call.stage === "cashier") && !call.busy;
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
    const mine = !ev.target || ev.target === session.playerId;
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
        if (ev.text && (mine || !ev.target)) {
          if (ev.bad) sfx.bad();
          toast(ev.text, { bad: ev.bad, mine: ev.target === session.playerId });
        }
    }
  }
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
    renderHud();
    renderDesks();
    renderQueue();
    renderDesk();
  }
  $("review").classList.toggle("hidden", phase !== "review");
  $("gameover").classList.toggle("hidden", phase !== "gameover");
  if (phase === "review") renderReview();
  if (phase === "gameover") renderGameOver();
  if (phase !== "day") closeRemote(false);
}

function renderLobby() {
  $("lobby-code").textContent = state.code;
  $("lobby-players").innerHTML = state.players
    .map((p) => `<li style="border-color:${p.color}">${p.avatar} ${escapeHtml(p.name)}${p.id === state.hostId ? " 👑" : ""}${p.id === session.playerId ? " (du)" : ""}</li>`)
    .join("");
  $("lobby-ai").textContent = aiText();
}

function aiText() {
  return config.ai.mode === "claude"
    ? `🤖 Anrufer werden von Claude gespielt (${config.ai.model}).`
    : "🤖 Offline-KI aktiv. Für echte KI-Gespräche den Server mit ANTHROPIC_API_KEY starten.";
}

function renderHud() {
  $("hud-day").textContent = state.day;
  const minutes = Math.floor(clamp(state.elapsed / state.dayLength, 0, 1) * 8 * 60);
  $("hud-clock").textContent = `${String(9 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  $("hud-quota").textContent = `${euro(state.earned)} / ${euro(state.quota)}`;
  const bar = $("hud-quota-bar");
  bar.style.width = `${clamp((state.earned / state.quota) * 100, 0, 100)}%`;
  bar.style.background = state.earned >= state.quota ? "var(--good)" : "";
  $("hud-boss").textContent = BOSS_FACES[Math.min(4, Math.floor(state.bossMood / 20))];
  $("hud-strikes").textContent = "●".repeat(state.strikes) + "○".repeat(Math.max(0, 3 - state.strikes));
  $("hud-bank").textContent = euro(state.bank);
  $("hud-code").textContent = state.code;
  $("btn-voice").textContent = voiceOn ? "🔊" : "🔇";

  const bossHere = state.phase === "day" && state.bossVisit > 0;
  $("boss-alert").classList.toggle("hidden", !bossHere);
  const walker = $("boss-walker");
  if (bossHere && walker.classList.contains("hidden")) {
    walker.classList.remove("hidden");
    walker.style.animation = "none";
    void walker.offsetWidth; // Animation neu starten
    walker.style.animation = "";
  } else if (!bossHere) {
    walker.classList.add("hidden");
  }
}

function renderDesks() {
  $("desks").innerHTML = state.players.map((p) => {
    const call = p.callId && state.calls.find((c) => c.id === p.callId);
    const status = call ? `📞 ${escapeHtml(call.name)}` : "💤 frei";
    return `<div class="desk-tile${call ? " talking" : ""}${p.online ? "" : " offline"}" style="border-color:${p.color}">
      <span class="emoji">${p.avatar}</span>
      <div><b>${escapeHtml(p.name)}${p.id === session.playerId ? " (du)" : ""}</b><br><span class="hint">${status}</span></div>
    </div>`;
  }).join("");
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
      li.innerHTML = `<span>📳</span><div class="who">${escapeHtml(c.city)}<div class="wait"></div></div>`;
      const btn = document.createElement("button");
      btn.textContent = "Annehmen";
      btn.disabled = busy;
      btn.onclick = () => {
        btn.disabled = true;
        watchCallId = null;
        act({ type: "answer", callId: c.id });
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
    li.innerHTML = `${owner ? escapeHtml(owner.name) : "?"} ↔ ${escapeHtml(c.name)} · ${c.trust}% <span class="hint">(mithören)</span>`;
    li.onclick = () => { watchCallId = watchCallId === c.id ? null : c.id; render(); };
    $("team-calls").appendChild(li);
  }
  $("team-empty").classList.toggle("hidden", team.length > 0);
}

let renderedCallId = null;
let renderedHistory = 0;
let renderedStageKey = "";
let spokenUpTo = 0;

function renderDesk() {
  let call = myCall();
  let readonly = false;
  if (!call && watchCallId) {
    call = state.calls.find((c) => c.id === watchCallId) || null;
    if (!call) watchCallId = null;
    readonly = !!call;
  }

  $("desk-idle").classList.toggle("hidden", !!call);
  $("desk-call").classList.toggle("hidden", !call);
  $("desk-call").classList.toggle("readonly", readonly);
  if (!call) {
    renderedCallId = null;
    return;
  }

  if (call.id !== renderedCallId) {
    renderedCallId = call.id;
    renderedHistory = 0;
    renderedStageKey = "";
    spokenUpTo = readonly ? call.history.length : 0;
    $("dialog").innerHTML = "";
    $("in-say").value = "";
    stopSpeaking();
  }

  $("caller-avatar").textContent = call.avatar;
  $("caller-name").textContent = call.name;
  $("caller-meta").textContent = `${call.age} Jahre · ${call.city}`;
  const tags = [];
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
    // Kartendaten nur vorlesen, nicht anzeigen: Mitschreiben ist Teil des Spiels
    if (m.secret && voiceOn && germanVoices.length && !readonly) {
      body = body.replace(/\d[\d ,/]*\d/g, (d) => `<span class="secret" title="Hör genau hin!">${d.replace(/\d/g, "•")}</span>`)
        + ` <button class="replay" title="Nochmal vorlesen">🔁</button>`;
    }
    div.innerHTML = (m.by && m.role === "player" ? `<span class="by">${escapeHtml(m.by)}</span>` : "") + body;
    div.querySelector(".replay")?.addEventListener("click", () => speak(call, m.text));
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
  $("in-say").disabled = !talk;
  $("btn-say").disabled = !talk;
  $("btn-mic").disabled = !talk || !Recognition;
  $("btn-mic").title = Recognition ? "Sprechen (Taste V gedrückt halten)" : "Spracheingabe wird von diesem Browser nicht unterstützt (Chrome/Edge nutzen)";
  $("in-say").placeholder = call.stage === "cashier"
    ? "Was soll der Anrufer der Kassiererin sagen?"
    : "Was sagst du? (Enter zum Senden)";
  $("btn-hangup").classList.toggle("hidden", call.stage === "done");
  $("talk-row").classList.toggle("hidden", !(call.stage === "talk" || call.stage === "cashier"));
  $("cheats").classList.toggle("hidden", call.stage !== "talk");

  renderStage(call, readonly);
}

function renderStage(call, readonly) {
  const panel = $("stage-panel");
  const key = `${call.id}:${call.stage}:${readonly}`;
  if (key !== renderedStageKey) {
    renderedStageKey = key;
    panel.innerHTML = "";
    if (call.stage === "choose") {
      panel.innerHTML = `<p><b>Vertrauen gewonnen!</b> Wie soll bezahlt werden?</p>
        <div class="pay-options">
          <button id="pay-card"><b>💳 Kreditkarte</b><small>Sofort und volle Summe. Schreib die Nummer mit, die vorgelesen wird. Bis Feierabend kann die Bank zurückbuchen.</small></button>
          <button id="pay-gift"><b>🎁 Gutscheinkarten</b><small>Sicher, aber 90 % Wert. Der Anrufer muss erst zum Kiosk, und die Kassiererin wird misstrauisch.</small></button>
        </div>`;
      $("pay-card").onclick = () => act({ type: "pay", method: "card" });
      $("pay-gift").onclick = () => act({ type: "pay", method: "giftcard" });
    } else if (call.stage === "card") {
      panel.innerHTML = `<p>💳 <b>Kartenterminal</b>: Tipp die vorgelesenen Daten ein. Noch <span id="card-countdown" class="countdown"></span></p>
        <form id="terminal" class="terminal">
          <label>Kartennummer<input id="card-number" inputmode="numeric" placeholder="0000 0000 0000 0000" autocomplete="off"></label>
          <label>Gültig bis<input id="card-expiry" placeholder="MM/JJ" autocomplete="off"></label>
          <label>Prüfnummer<input id="card-cvc" inputmode="numeric" placeholder="123" autocomplete="off"></label>
          <button type="submit">Abbuchen</button>
        </form>`;
      $("terminal").onsubmit = (e) => {
        e.preventDefault();
        act({ type: "card", number: $("card-number").value, expiry: $("card-expiry").value, cvc: $("card-cvc").value });
      };
      if (!readonly) setTimeout(() => $("card-number")?.focus(), 50);
    } else if (call.stage === "store") {
      panel.innerHTML = `<p>🏪 ${escapeHtml(call.name.split(" ")[0])} ist auf dem Weg zum Kiosk … Bleib dran!</p><div class="progress"><div id="store-progress"></div></div>`;
    } else if (call.stage === "cashier") {
      panel.innerHTML = `<p>🧾 <b>Die Kassiererin wird misstrauisch!</b> Erklär dem Anrufer, was er sagen soll.</p>`;
    } else if (call.stage === "codes") {
      panel.innerHTML = `<p>🎁 Der Anrufer hat die Karten. Übernimm seinen Bildschirm und löse die Codes ein!</p><button id="btn-remote" class="big">🖱️ Fernzugriff starten</button>`;
      $("btn-remote").onclick = () => openRemote(call);
    } else if (call.stage === "done") {
      panel.innerHTML = `<p class="hint">Gespräch beendet.</p>`;
    }
  }

  if (call.stage === "card" && $("card-countdown")) {
    $("card-countdown").textContent = `${Math.max(0, (call.deadline - serverNow()) / 1000).toFixed(0)} s`;
  }
  if (call.stage === "store" && $("store-progress")) {
    const total = (state.upgrades.includes("kiosk") ? 6 : 11);
    $("store-progress").style.width = `${clamp(100 - (call.stageTimer / total) * 100, 0, 100)}%`;
  }
}

function renderCheats() {
  const box = $("cheats");
  box.innerHTML = "";
  for (const [cat, label] of Object.entries(config.categories)) {
    const btn = document.createElement("button");
    btn.className = `cat-${cat}`;
    btn.textContent = `📝 ${label}`;
    btn.title = "Spickzettel: fügt einen Beispielsatz ein";
    btn.onclick = () => {
      $("in-say").value = pick(config.samples[cat]);
      $("in-say").focus();
    };
    box.appendChild(btn);
  }
}

function renderReview() {
  const r = state.review;
  if (!r) return;
  const s = r.stats;
  $("review-title").textContent = `Mitarbeitergespräch, Tag ${r.day}`;
  $("review-body").innerHTML = `
    <div class="stat-line"><span>Eingenommen</span><b>${euro(r.earned)} / ${euro(r.quota)}</b></div>
    ${r.chargeback ? `<div class="stat-line"><span>Rückbuchungen der Bank (${r.chargebackCount}×)</span><b class="bad">−${euro(r.chargeback)}</b></div>` : ""}
    <div class="stat-line"><span>Erfolgreiche Anrufe</span><b>${s.scammed}</b></div>
    <div class="stat-line"><span>Kreditkarte / Gutscheine gewählt</span><b>${s.card} / ${s.giftcard}</b></div>
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
  $("gameover-text").innerHTML =
    `Ihr habt ${state.review ? state.review.day : state.day} ${state.day === 1 ? "Tag" : "Tage"} überlebt und insgesamt ${euro(state.totalEarned)} eingenommen.<br><br>` +
    "Die Polizei interessiert sich übrigens auch schon für den Laden …";
}

// ---------------------------------------------------------------------------
// Fernzugriff-Minispiel (Gutscheine einlösen)
// ---------------------------------------------------------------------------

const POPUP_TEXTS = [
  "Sie haben gewonnen! (wirklich nicht)",
  "Update verfügbar: Version 0.0.0.1",
  "Möchten Sie Cookies? 🍪",
  "Druckerfehler: Drucker ist traurig",
  "Wetter-Widget: Regen in Ordner C:",
  "Toolbar 'SuperSuche 3000' installieren?",
  "Ihr Solitär vermisst Sie.",
  "Bitte bewerten Sie Windows 98!",
  "Enkel-Foto-Diashow wird geladen …",
  "Kürbis-Forum: 47 neue Beiträge",
];

let remoteTimer = null;
let remoteCallId = null;

function openRemote(call) {
  remoteCallId = call.id;
  const desk = $("remote-desktop");
  desk.querySelectorAll(".popup").forEach((p) => p.remove());
  $("remote-victim").textContent = call.name;
  $("remote").classList.remove("hidden");

  const w = desk.clientWidth;
  const h = desk.clientHeight;
  const target = $("remote-target");
  const tx = 20 + Math.random() * Math.max(1, w - 240);
  const ty = 20 + Math.random() * (h - 70);
  target.style.left = `${tx}px`;
  target.style.top = `${ty}px`;
  target.disabled = false;

  const count = 4 + Math.min(state.day, 6) + (call.skeptical ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    p.className = "popup";
    const over = i < 3; // ein paar liegen garantiert über dem Knopf
    const x = over ? tx + (Math.random() * 60 - 40) : Math.random() * (w - 190);
    const y = over ? ty + (Math.random() * 50 - 40) : Math.random() * (h - 90);
    p.style.left = `${clamp(x, 0, w - 190)}px`;
    p.style.top = `${clamp(y, 0, h - 90)}px`;
    p.innerHTML = `<div class="bar-top"><span>⚠️ Hinweis</span><button>✕</button></div><p>${pick(POPUP_TEXTS)}</p>`;
    p.querySelector("button").onclick = (e) => {
      e.stopPropagation();
      p.remove();
      sfx.click();
    };
    desk.appendChild(p);
  }

  clearInterval(remoteTimer);
  remoteTimer = setInterval(() => {
    const left = (call.deadline - serverNow()) / 1000;
    $("remote-timer").textContent = `${Math.max(0, left).toFixed(1)}s`;
    if (left <= 0) closeRemote(true, false);
  }, 100);
  target.onclick = () => closeRemote(true, true);
}

function closeRemote(report, success) {
  if (!remoteCallId) return;
  clearInterval(remoteTimer);
  $("remote").classList.add("hidden");
  const id = remoteCallId;
  remoteCallId = null;
  if (report && myCall() && myCall().id === id) act({ type: "remote", success });
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
$("in-say").addEventListener("keydown", (e) => { if (e.key === "Enter") sendSay(); });
$("btn-voice").onclick = () => {
  voiceOn = !voiceOn;
  store("voiceOn", voiceOn);
  if (!voiceOn) stopSpeaking();
  render();
};

// Mikrofon: Klick schaltet um, Taste V gedrückt halten = Push-to-Talk
$("btn-mic").onclick = () => (listening ? stopListening() : startListening());
const typingTarget = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "v" && !e.repeat && !typingTarget(document.activeElement)) {
    e.preventDefault();
    startListening();
  }
});
document.addEventListener("keyup", (e) => {
  if (e.key.toLowerCase() === "v" && listening) stopListening();
});

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
