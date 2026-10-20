// HTTP-Server: liefert das Spiel aus, hält die Räume und streamt den Zustand per SSE.

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRoom, joinRoom, getRoom, attachClient, handleAction, tick, broadcast, allRooms, dropIdleRooms, callerLine, GameError,
} from "./game.js";
import { initTts, synthesize, ttsAvailable, TtsUnavailable } from "./tts.js";
import { aiStatus, initAi } from "./ai.js";
import { UPGRADES, SAMPLE_LINES, CATEGORIES } from "./data.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(here, "..", "public");
// three.js wird direkt aus node_modules ausgeliefert
const VENDOR_DIRS = {
  "/vendor/three/": path.resolve(here, "..", "node_modules", "three", "build"),
  "/vendor/three-addons/": path.resolve(here, "..", "node_modules", "three", "examples", "jsm"),
};
const PORT = Number(process.env.PORT) || 3000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 10_000) throw new GameError("Anfrage zu groß.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new GameError("Ungültiges JSON.");
  }
}

async function serveStatic(req, res, pathname) {
  let root = PUBLIC_DIR;
  let rel = pathname === "/" ? "/index.html" : pathname;
  for (const [prefix, dir] of Object.entries(VENDOR_DIRS)) {
    if (pathname.startsWith(prefix)) {
      root = dir;
      rel = "/" + pathname.slice(prefix.length);
    }
  }
  const file = path.resolve(root, "." + rel);
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Nicht gefunden");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const { pathname } = url;

  try {
    if (req.method === "GET" && pathname === "/api/config") {
      return sendJson(res, 200, { ai: aiStatus(), tts: ttsAvailable(), upgrades: UPGRADES, samples: SAMPLE_LINES, categories: CATEGORIES });
    }

    if (req.method === "POST" && pathname === "/api/rooms") {
      const body = await readBody(req);
      const { room, player } = createRoom(body.name);
      return sendJson(res, 200, { code: room.code, playerId: player.id });
    }

    if (req.method === "POST" && pathname === "/api/rooms/join") {
      const body = await readBody(req);
      const { room, player } = joinRoom(body.code, body.name);
      broadcast(room);
      return sendJson(res, 200, { code: room.code, playerId: player.id });
    }

    if (req.method === "GET" && pathname === "/api/events") {
      const room = getRoom(url.searchParams.get("code"));
      if (!room) return sendJson(res, 404, { error: "Raum nicht gefunden." });
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const detach = attachClient(room, url.searchParams.get("player"), res);
      req.on("close", detach);
      return;
    }

    if (req.method === "POST" && pathname === "/api/tts") {
      const body = await readBody(req);
      const room = getRoom(body.code);
      if (!room) return sendJson(res, 404, { error: "Raum nicht gefunden." });
      const { call, text } = callerLine(room, body.playerId, body.callId, body.index);
      try {
        const audio = await synthesize(call, text);
        res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
        return res.end(audio);
      } catch (err) {
        if (err instanceof TtsUnavailable) return sendJson(res, 503, { error: err.message });
        throw err;
      }
    }

    if (req.method === "POST" && pathname === "/api/action") {
      const body = await readBody(req);
      const room = getRoom(body.code);
      if (!room) return sendJson(res, 404, { error: "Raum nicht gefunden." });
      // Positionsupdates kommen oft; die Spielschleife sendet sie ohnehin mit
      if (body.action?.type === "pos") {
        await handleAction(room, body.playerId, body.action);
        return sendJson(res, 200, { ok: true });
      }
      const pending = handleAction(room, body.playerId, body.action || {});
      // Sofort senden, damit z. B. „Anrufer tippt …“ ohne Verzögerung erscheint
      broadcast(room);
      await pending;
      broadcast(room);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET") return serveStatic(req, res, pathname);
    res.writeHead(405).end();
  } catch (err) {
    if (err instanceof GameError) return sendJson(res, 400, { error: err.message });
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: "Interner Fehler." });
  }
});

// Spielschleife: 5 Ticks pro Sekunde
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - last) / 1000;
  last = now;
  for (const room of allRooms()) {
    tick(room, dt);
    broadcast(room);
  }
}, 200);
setInterval(dropIdleRooms, 60_000);

await Promise.all([initAi(), initTts()]);
server.listen(PORT, () => {
  const ai = aiStatus();
  console.log(`☎️  Call Center läuft auf http://localhost:${PORT}`);
  console.log(ai.mode === "offline"
    ? "🤖 KI-Anrufer: Offline-KI (für echte KI GEMINI_API_KEY oder ANTHROPIC_API_KEY setzen)"
    : `🤖 KI-Anrufer: ${ai.mode === "claude" ? "Claude" : "Gemini"} (${ai.model})`);
  console.log(ttsAvailable() ? "🔊 Stimmen: ElevenLabs" : "🔊 Stimmen: Browser (für echte Stimmen ELEVENLABS_API_KEY setzen)");
});
