import { createOffice, IS_TOUCH } from "./office3d.js";

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

// Echte Stimmen kommen vom Server (ElevenLabs); klappt das nicht, liest der Browser vor
let ttsRetryAt = 0;
const audioQueue = [];
let currentAudio = null;

function speak(call, text, index) {
  if (!voiceOn) return;
  if (listening && !heardSomething) stopListening();
  if (config.tts && index != null && Date.now() > ttsRetryAt && session) {
    const job = { call, text, audio: fetchVoice(call, index) };
    audioQueue.push(job);
    if (!currentAudio) playNext();
    return;
  }
  browserSpeak(call, text);
}

async function fetchVoice(call, index) {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: session.code, playerId: session.playerId, callId: call.id, index }),
  });
  if (res.status === 503) ttsRetryAt = Date.now() + 5 * 60_000;
  if (!res.ok) throw new Error(`TTS ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

async function playNext() {
  const job = audioQueue.shift();
  if (!job) {
    currentAudio = null;
    setTimeout(micTick, 250);
    return;
  }
  currentAudio = job;
  try {
    const url = await job.audio;
    if (currentAudio !== job) return; // inzwischen abgebrochen
    const audio = new Audio(url);
    job.el = audio;
    await new Promise((resolve) => {
      audio.onended = resolve;
      audio.onerror = resolve;
      audio.play().catch(resolve);
    });
    URL.revokeObjectURL(url);
  } catch {
    if (currentAudio === job) browserSpeak(job.call, job.text);
  }
  if (currentAudio === job) playNext();
}

function browserSpeak(call, text) {
  if (!("speechSynthesis" in window)) return;
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
  u.onend = () => setTimeout(micTick, 250);
  speechSynthesis.speak(u);
}

function stopSpeaking() {
  audioQueue.length = 0;
  if (currentAudio && currentAudio.el) currentAudio.el.pause();
  currentAudio = null;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
let listening = false;
let heardSomething = false;
let sendTimer = null;
// Freisprechen: Mikro hört im Gespräch automatisch zu und sendet nach einer kurzen Pause
let handsFree = !!Recognition && (store("handsFree") ?? true);

function isSpeaking() {
  return !!currentAudio || audioQueue.length > 0 || ("speechSynthesis" in window && speechSynthesis.speaking);
}

function updateMicButton() {
  const btn = $("btn-mic");
  btn.classList.toggle("listening", listening);
  btn.classList.toggle("on", handsFree);
  if (!Recognition) return;
  btn.title = handsFree ? "Freisprechen ist an (klicken zum Ausschalten)" : "Freisprechen einschalten";
  const call = myCall();
  if (listening) $("in-say").placeholder = "🎤 Ich höre zu … sprich einfach.";
  else if (call && call.stage === "away") $("in-say").placeholder = "Der Anrufer ist unterwegs … frag gleich, ob er wieder da ist.";
  else $("in-say").placeholder = handsFree ? "🎤 Freisprechen an · oder tippen" : IS_TOUCH ? "Was sagst du?" : "Was sagst du? (Enter zum Senden)";
}

function startListening() {
  if (!Recognition || listening || !seated) return;
  const call = myCall();
  if (!call || !canTalk(call)) return;
  heardSomething = false;
  recognizer = new Recognition();
  recognizer.lang = "de-DE";
  recognizer.interimResults = true;
  recognizer.continuous = true;
  recognizer.onresult = (e) => {
    let finalText = "";
    let interim = "";
    for (let i = 0; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript + " ";
      else interim += e.results[i][0].transcript;
    }
    const text = (finalText + interim).trim();
    if (!text) return;
    heardSomething = true;
    $("in-say").value = text;
    $("my-line").textContent = `🎤 ${text}`;
    clearTimeout(sendTimer);
    // Kurze Pause nach dem Sprechen = fertig, dann automatisch senden
    sendTimer = setTimeout(stopListening, interim.trim() ? 1400 : 700);
  };
  recognizer.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      handsFree = false;
      store("handsFree", false);
      toast("🎤 Mikrofon-Zugriff wurde verweigert. Erlaube ihn in den Browser-Einstellungen.", { bad: true });
    }
  };
  recognizer.onend = () => {
    listening = false;
    recognizer = null;
    clearTimeout(sendTimer);
    if (heardSomething && $("in-say").value.trim()) sendSay();
    heardSomething = false;
    updateMicButton();
    setTimeout(micTick, 400);
  };
  try {
    recognizer.start();
  } catch {
    recognizer = null;
    return;
  }
  listening = true;
  updateMicButton();
}

function stopListening() {
  clearTimeout(sendTimer);
  if (recognizer && listening) recognizer.stop();
}

// Mikro automatisch (wieder) einschalten, wenn man dran ist und der Anrufer nicht spricht
function micTick() {
  if (!handsFree || listening || !seated) return;
  // Wer gerade tippt, wird nicht vom Mikro überschrieben
  if (document.activeElement === $("in-say") && $("in-say").value.trim()) return;
  const call = myCall();
  if (!call || !canTalk(call) || isSpeaking()) return;
  startListening();
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

let pcOpen = false;
let pcApp = "gift";
let keyboardOpen = !Recognition; // ohne Spracheingabe gleich tippen
const callStart = new Map();

function sitDown() {
  const p = me();
  if (!p || seated || state.phase !== "day") return;
  seated = true;
  office.sitAt(p.desk);
  act({ type: "sit", seated: true });
  renderOverlays();
  renderSeat();
}

function openPc(app) {
  pcOpen = true;
  if (app) pcApp = app;
  renderPcApps();
  renderOverlays();
}

function closePc() {
  pcOpen = false;
  document.activeElement?.blur();
  renderOverlays();
}

function standUp() {
  if (!seated) return;
  stopListening();
  stopSpeaking();
  seated = false;
  pcOpen = false;
  office.stand();
  act({ type: "sit", seated: false });
  document.activeElement?.blur();
  // Am Handy direkt weiterlaufen können
  if (IS_TOUCH) office.activate();
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
      pcOpen = false;
      office.stand();
    }
    renderHud();
    if (seated) renderSeat();
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
  const locked = office && office.isActive();
  $("pc").classList.toggle("hidden", !(day && seated && pcOpen));
  $("phone").classList.toggle("hidden", !(day && seated));
  $("seat-bar").classList.toggle("hidden", !(day && seated));
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
  const ai = config.ai.mode === "offline"
    ? "🤖 Offline-KI aktiv (für echte KI-Gespräche GEMINI_API_KEY setzen)."
    : `🤖 Anrufer werden von ${config.ai.mode === "claude" ? "Claude" : "Gemini"} gespielt (${config.ai.model}).`;
  return `${ai} ${config.tts ? "🔊 Echte Stimmen (ElevenLabs)." : ""}`.trim();
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

function renderSeat() {
  renderPhone();
  if (pcOpen) renderPcApps();
}

function ringingCalls() {
  return state.queue.map((id) => state.calls.find((c) => c.id === id)).filter(Boolean);
}

let renderedCallId = null;
let spokenUpTo = 0;

function renderPhone() {
  const time = clockText();
  $("phone-time").textContent = time;
  $("phone-big-time").textContent = time;

  const active = myCall();
  if (active) lastCall = active;
  const ringing = ringingCalls();
  const inCall = active && active.stage !== "done";
  const mode = inCall ? "call" : ringing.length ? "ringing" : active ? "call" : "idle";

  $("phone-idle").classList.toggle("hidden", mode !== "idle");
  $("phone-ringing").classList.toggle("hidden", mode !== "ringing");
  $("phone-call").classList.toggle("hidden", mode !== "call");
  $("phone").classList.toggle("ringing", mode === "ringing");

  if (mode === "ringing") {
    $("ring-name").textContent = "Unbekannte Nummer";
    $("ring-city").textContent = `aus ${ringing[0].city}`;
    $("ring-more").textContent = ringing.length > 1 ? `+${ringing.length - 1} weitere in der Leitung` : "";
    return;
  }
  if (mode !== "call") {
    renderedCallId = null;
    return;
  }
  renderCall(active);
}

function lastOf(call, role) {
  for (let i = call.history.length - 1; i >= 0; i--) if (call.history[i].role === role) return { m: call.history[i], i };
  return null;
}

function maskSecret(text) {
  const body = escapeHtml(text);
  if (!(voiceOn && (config.tts || germanVoices.length))) return body;
  // Codes und Nummern nur vorlesen, nicht anzeigen: Mitschreiben ist Teil des Spiels
  return body
    .replace(CODE_RE, (c) => `<span class="secret">${c.replace(/[A-Z0-9]/g, "•")}</span>`)
    .replace(/\d[\d ,/]*\d/g, (x) => `<span class="secret">${x.replace(/\d/g, "•")}</span>`);
}

function renderCall(call) {
  if (call.id !== renderedCallId) {
    renderedCallId = call.id;
    spokenUpTo = 0;
    $("in-say").value = "";
    $("my-line").textContent = "";
    stopSpeaking();
  }
  if (!callStart.has(call.id)) callStart.set(call.id, Date.now());

  // Neue Sätze des Anrufers vorlesen
  for (let i = spokenUpTo; i < call.history.length; i++) {
    if (call.history[i].role === "caller") speak(call, call.history[i].text, i);
  }
  spokenUpTo = call.history.length;

  $("caller-avatar").textContent = call.avatar;
  $("caller-name").textContent = call.name;
  const secs = Math.floor((Date.now() - callStart.get(call.id)) / 1000);
  $("call-timer").textContent = call.stage === "done" ? "Anruf beendet" : `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  $("trust-bar").style.width = `${call.trust}%`;

  const tags = [];
  if (call.skeptical) tags.push(`<span>misstrauisch</span>`);
  if (call.weakness) tags.push(`<span class="weak">Schwäche: ${config.categories[call.weakness]}</span>`);
  if (call.baiter) tags.push(`<span class="baiter">⚠️ Scambaiter!</span>`);
  $("caller-tags").innerHTML = tags.join("");

  let status = "";
  if (call.stage === "done") status = "📴 aufgelegt";
  else if (call.stage === "away") status = "🚶 ist unterwegs … frag gleich, ob er wieder da ist";
  else if (call.busy) status = "💭 überlegt …";
  else if (currentAudio || ("speechSynthesis" in window && speechSynthesis.speaking)) status = `<span class="wave"><i></i><i></i><i></i><i></i></span> spricht`;
  else if (listening) status = "🎤 hört dir zu …";
  $("call-status").innerHTML = status;

  // Untertitel: nur der aktuelle Satz (oder ein Hinweis wie "keine Antwort")
  const lastMsg = call.history[call.history.length - 1];
  const lastCaller = lastOf(call, "caller");
  if (lastMsg && lastMsg.role === "sys") $("subtitle").innerHTML = `<i>${escapeHtml(lastMsg.text)}</i>`;
  else $("subtitle").innerHTML = lastCaller ? maskSecret(lastCaller.m.text) : "";
  if (!listening) {
    const mine = lastOf(call, "player");
    $("my-line").textContent = mine ? `Du: ${mine.m.text}` : "";
  }

  const talk = canTalk(call);
  $("chat-form").classList.toggle("hidden", !keyboardOpen || call.stage === "done");
  $("cheats").classList.toggle("hidden", !keyboardOpen || call.stage !== "talk");
  $("btn-keyboard").classList.toggle("on", keyboardOpen);
  $("phone").classList.toggle("typing", keyboardOpen);
  $("in-say").disabled = !talk;
  $("btn-say").disabled = !talk;
  $("btn-hangup").disabled = call.stage === "done";
  $("btn-replay").disabled = !lastCaller;
  $("btn-mic").disabled = !Recognition;
  if (!Recognition) $("btn-mic").title = "Spracheingabe wird von diesem Browser nicht unterstützt (Chrome/Edge nutzen)";
  if (!talk && listening) stopListening();
  updateMicButton();
  micTick();
}

function renderPcApps() {
  document.querySelectorAll(".pc-apps button").forEach((b) => b.classList.toggle("active", b.dataset.app === pcApp));
  document.querySelectorAll(".app-window").forEach((w) => w.classList.toggle("active", w.dataset.app === pcApp));
  const r = me() && me().remote;
  $("remote-connect").classList.toggle("hidden", !!r);
  $("remote-desktop").classList.toggle("hidden", !r);
  if (r) {
    $("remote-owner").textContent = r.owner;
    $("bank-name").textContent = r.bank;
    $("bank-balance").textContent = euro(r.balance);
  } else {
    $("bank-window").classList.add("hidden");
  }
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
  add("🖱️ Fernzugriff", "ask-remote", ["Damit ich den Virus entfernen kann, installieren Sie bitte das Programm FernViewer und lesen mir Ihre ID vor."]);
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
  clearTimeout(sendTimer);
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
$("btn-stand").onclick = standUp;
$("btn-goto-desk").onclick = goToDesk;
$("click-to-play").onclick = () => office && office.activate();
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
$("btn-mic").onclick = () => {
  handsFree = !handsFree;
  store("handsFree", handsFree);
  if (handsFree) {
    toast("🎤 Freisprechen an: Einfach reden, nach einer kurzen Pause wird gesendet.");
    micTick();
  } else {
    stopListening();
  }
  updateMicButton();
};
document.addEventListener("keydown", (e) => {
  if (!state || state.phase !== "day") return;
  if (e.key === "Escape" && seated) {
    if (typingTarget(document.activeElement)) document.activeElement.blur();
    else if (pcOpen) closePc();
    else standUp();
    return;
  }
  if (e.key.toLowerCase() === "q" && seated && !typingTarget(document.activeElement)) {
    e.preventDefault();
    if (pcOpen) closePc();
    else openPc();
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
window.callcenter = {
  state: () => state,
  session: () => session,
  myCall,
  mic: () => ({ handsFree, listening, seated, speaking: isSpeaking(), audio: !!currentAudio, queue: audioQueue.length, synth: "speechSynthesis" in window && speechSynthesis.speaking }),
};

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

$("chat-form").onsubmit = (e) => {
  e.preventDefault();
  sendSay();
};
$("btn-accept").onclick = () => {
  const c = ringingCalls()[0];
  if (!c) return;
  sfx.pickup();
  watchCallId = null;
  act({ type: "answer", callId: c.id });
  if (keyboardOpen && !IS_TOUCH) setTimeout(() => $("in-say").focus(), 200);
};
$("btn-decline").onclick = () => {
  const c = ringingCalls()[0];
  if (c) act({ type: "decline", callId: c.id });
};
$("btn-keyboard").onclick = () => {
  keyboardOpen = !keyboardOpen;
  renderSeat();
  if (keyboardOpen) $("in-say").focus();
};
$("btn-replay").onclick = () => {
  const c = myCall() || lastCall;
  const last = c && lastOf(c, "caller");
  if (last) {
    stopSpeaking();
    speak(c, last.m.text, last.i);
  }
};
$("btn-open-pc").onclick = () => (pcOpen ? closePc() : openPc());
$("btn-close-pc").onclick = closePc;
document.querySelectorAll(".pc-apps button").forEach((b) => { b.onclick = () => openPc(b.dataset.app); });
$("connect-form").onsubmit = (e) => {
  e.preventDefault();
  const code = $("in-remote").value.trim();
  if (!code) return;
  act({ type: "connect", code });
  $("in-remote").value = "";
};
$("btn-disconnect").onclick = () => act({ type: "disconnect" });
document.querySelectorAll(".desk-icon[data-open]").forEach((b) => { b.onclick = () => $("bank-window").classList.remove("hidden"); });
$("btn-bank-close").onclick = () => $("bank-window").classList.add("hidden");
const JOKES = {
  photos: "🖼️ 412 Fotos von Kürbissen. Und eins vom Enkel.",
  recipes: "📄 „Omas Streuselkuchen – streng geheim!“",
  trash: "🗑️ Der Papierkorb ist voll mit Kettenbriefen.",
  solitaire: "🃏 Highscore: 3 Punkte.",
};
document.querySelectorAll(".desk-icon[data-joke]").forEach((b) => { b.onclick = () => toast(JOKES[b.dataset.joke]); });
$("transfer-form").onsubmit = (e) => {
  e.preventDefault();
  const amount = Number($("in-amount").value.replace(/[^\d]/g, ""));
  if (!amount) return;
  act({ type: "transfer", amount });
  $("in-amount").value = "";
};

(async function init() {
  if (IS_TOUCH) {
    $("ctp-title").textContent = "👆 Tippen zum Spielen";
    $("ctp-keys").innerHTML = "Links mit dem <b>Joystick</b> laufen · rechts <b>wischen</b> zum Umsehen · <b>✋</b> zum Benutzen · <b>🪑</b> oben springt direkt an deinen Platz";
    $("crosshair").textContent = "•";
    $("btn-stand").textContent = "🚶 Aufstehen";
    $("btn-open-pc").textContent = "🖥️ PC";
  }
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
