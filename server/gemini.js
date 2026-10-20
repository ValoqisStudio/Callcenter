// Google Gemini als kostenlose Alternative für die Anrufer-KI.
// Welche Modelle im Gratis-Tarif verfügbar sind, ändert Google häufig. Deshalb fragt
// der Server beim Start ab, was der Key darf, und nimmt das beste Flash-Modell.
// Ist dessen Limit erreicht, wird das nächste probiert.

const KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const BASE = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
const PINNED = process.env.GEMINI_MODEL || "";

let models = PINNED ? [PINNED] : [];
const cooldownUntil = new Map(); // Modell -> Zeitpunkt, ab dem es wieder probiert wird

export const geminiAvailable = () => !!KEY;
export const geminiModel = () => models.find((m) => !(cooldownUntil.get(m) > Date.now())) || models[0] || null;

class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new GeminiError(data.error?.message || `HTTP ${res.status}`, res.status);
  return data;
}

// Höhere Version zuerst, volle Flash-Modelle vor Lite, stabile vor Vorschau-Versionen
function score(name) {
  const version = Number((name.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  let s = version * 10;
  if (/lite/.test(name)) s -= 5;
  if (/preview|exp/.test(name)) s -= 1;
  return s;
}

export async function initGemini() {
  if (!KEY || PINNED) return;
  try {
    const data = await request("/v1beta/models?pageSize=1000");
    models = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/(image|tts|live|audio|embedding|native|thinking)/.test(n))
      .sort((a, b) => score(b) - score(a));
    if (!models.length) models = ["gemini-2.5-flash"];
    console.log(`[gemini] Verfügbare Modelle: ${models.slice(0, 4).join(", ")}${models.length > 4 ? " …" : ""}`);
  } catch (err) {
    console.warn("[gemini] Modellliste nicht abrufbar, nutze gemini-2.5-flash:", err.message);
    models = ["gemini-2.5-flash"];
  }
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    trust_delta: { type: "INTEGER" },
    hangs_up: { type: "BOOLEAN" },
    approach: { type: "STRING", enum: ["charme", "druck", "amt", "technik", "andere"] },
    request: { type: "STRING", enum: ["none", "giftcard", "card"] },
    complies: { type: "BOOLEAN" },
  },
  required: ["reply", "trust_delta", "hangs_up", "approach", "request", "complies"],
  propertyOrdering: ["reply", "trust_delta", "hangs_up", "approach", "request", "complies"],
};

// Liefert das rohe JSON-Objekt der Antwort; wirft bei Fehlern (der Aufrufer fällt dann auf offline zurück)
export async function geminiTurn(system, prompt) {
  const tried = [];
  for (const model of models) {
    if (cooldownUntil.get(model) > Date.now()) continue;
    tried.push(model);
    try {
      const data = await request(`/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
          temperature: 0.9,
          maxOutputTokens: 4096,
        },
      });
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts || []).map((p) => p.text || "").join("");
      if (!text) throw new GeminiError(`Leere Antwort (${data.promptFeedback?.blockReason || cand?.finishReason || "unbekannt"})`, 200);
      return JSON.parse(text);
    } catch (err) {
      // Limit erreicht, Modell weg oder gesperrt: kurz pausieren und das nächste nehmen
      if ([429, 403, 404, 503].includes(err.status)) {
        const perDay = /per.?day|daily/i.test(err.message);
        cooldownUntil.set(model, Date.now() + (err.status === 404 ? 3_600_000 : perDay ? 1_800_000 : 60_000));
        console.warn(`[gemini] ${model}: ${err.status} ${err.message.slice(0, 120)}`);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Kein Gemini-Modell verfügbar (probiert: ${tried.join(", ") || "keins"})`);
}
