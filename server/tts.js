// Echte Stimmen über ElevenLabs. Die Stimmen kommen aus dem eigenen ElevenLabs-Konto
// (Standard-Stimmen hat jedes Konto, auch im Gratis-Tarif). Ist das Kontingent leer
// oder der Key ungültig, pausiert die Sprachausgabe und der Browser liest vor.

const KEY = process.env.ELEVENLABS_API_KEY || "";
const BASE = process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io";
// Flash ist schnell und verbraucht im Gratis-Tarif nur halb so viele Credits
const MODEL = process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5";

let voices = { f: [], m: [] };
let pausedUntil = 0;
const cache = new Map(); // Text+Stimme -> Buffer
const MAX_CACHE = 150;

export const ttsAvailable = () => !!KEY && (voices.f.length + voices.m.length > 0) && Date.now() > pausedUntil;

export async function initTts() {
  if (!KEY) return;
  try {
    const res = await fetch(`${BASE}/v1/voices`, { headers: { "xi-api-key": KEY }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const all = (data.voices || []).map((v) => ({
      id: v.voice_id,
      name: v.name,
      gender: (v.labels?.gender || "").toLowerCase(),
      age: (v.labels?.age || "").toLowerCase(),
    }));
    // Ältere Stimmen bevorzugen, die Anrufer sind meist Rentner
    const rank = (v) => (v.age.includes("old") ? 0 : v.age.includes("middle") ? 1 : 2);
    voices = {
      f: all.filter((v) => v.gender === "female").sort((a, b) => rank(a) - rank(b)),
      m: all.filter((v) => v.gender === "male").sort((a, b) => rank(a) - rank(b)),
    };
    if (!voices.f.length) voices.f = all.filter((v) => v.gender !== "male");
    if (!voices.m.length) voices.m = all.filter((v) => v.gender !== "female");
    console.log(`[tts] ElevenLabs aktiv: ${voices.f.length} weibliche, ${voices.m.length} männliche Stimmen`);
  } catch (err) {
    console.warn("[tts] ElevenLabs-Stimmen nicht abrufbar, Browser-Stimme wird genutzt:", err.message);
  }
}

// Gleicher Anrufer, gleiche Stimme
function voiceFor(call) {
  const pool = voices[call.gender] && voices[call.gender].length ? voices[call.gender] : [...voices.f, ...voices.m];
  const hash = [...call.id].reduce((h, ch) => h + ch.charCodeAt(0), 0);
  // Nur aus den ersten (ältesten) Stimmen wählen, wenn genug da sind
  const top = pool.slice(0, Math.max(3, Math.ceil(pool.length / 2)));
  return top[hash % top.length];
}

// Codes und Kartennummern Zeichen für Zeichen vorlesen lassen
export function spokenText(text) {
  return text
    .replace(/\*[^*]*\*/g, " ")
    .replace(/[👋💸🦠]/gu, "")
    .replace(/\b[A-Z0-9]{4}(?:-[A-Z0-9]{4})+\b/g, (code) => code.split("-").map((g) => g.split("").join(", ")).join(". Strich. "))
    .replace(/\d{3,}/g, (d) => d.split("").join(", "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

export class TtsUnavailable extends Error {}

export async function synthesize(call, rawText) {
  if (!ttsAvailable()) throw new TtsUnavailable("Sprachausgabe nicht verfügbar");
  const voice = voiceFor(call);
  const text = spokenText(rawText);
  if (!text) throw new TtsUnavailable("Nichts zu sagen");
  const key = `${voice.id}|${text}`;
  if (cache.has(key)) return cache.get(key);

  const res = await fetch(`${BASE}/v1/text-to-speech/${voice.id}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": KEY, Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      language_code: "de",
      voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.3 },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Kontingent leer, Key ungültig oder zu viele Anfragen: eine Weile pausieren
    if ([401, 402, 403, 429].includes(res.status) || /quota|credits/i.test(body)) {
      pausedUntil = Date.now() + (res.status === 429 ? 30_000 : 15 * 60_000);
      console.warn(`[tts] ElevenLabs pausiert (${res.status}): ${body.slice(0, 160)}`);
    }
    throw new TtsUnavailable(`ElevenLabs ${res.status}`);
  }
  const audio = Buffer.from(await res.arrayBuffer());
  cache.set(key, audio);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return audio;
}
