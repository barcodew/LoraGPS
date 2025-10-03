/* eslint-disable no-console */
const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");

const app = express();

// ====== CONFIG ======
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";

// Folder hasil build React (vite build -> dist)
const DIST_DIR = path.join(__dirname, "dist");

// ====== MIDDLEWARES ======
app.disable("x-powered-by");
app.set("etag", false);

// CORS: izinkan dari mana saja (ubah sesuai kebutuhan)
app.use(cors({ origin: true, credentials: false }));

// JSON body (untuk /ingest)
app.use(express.json({ limit: "256kb", strict: true }));

// Static: hanya di production kita serve file React dari dist/
if (IS_PROD) {
  app.use(
    express.static(DIST_DIR, {
      index: false, // biar SPA fallback kita yang kirim index.html
      maxAge: "1h",
      setHeaders(res) {
        // Cache HTML rendah, asset fingerprint bisa tinggi (diatur Vite)
        if (res.req.path.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    })
  );
}

// ====== STATE ======
// id -> {lat, lon, sats, hdop, ts}
const devices = new Map();
// Kumpulan response SSE yang sedang terbuka
const clients = new Set();

// ====== HEALTH ======
app.get("/ping", (req, res) => {
  res.set("Connection", "close");
  res.status(200).type("text/plain").send("pong");
});

// ====== DEBUG REST ======
app.get("/devices", (req, res) => {
  const arr = Array.from(devices, ([id, v]) => ({ id, ...v }));
  res.set("Connection", "close").json(arr);
});

app.get("/device/:id", (req, res) => {
  const v = devices.get(req.params.id);
  if (!v) return res.status(404).json({ error: "not found" });
  res.set("Connection", "close").json({ id: req.params.id, ...v });
});

// ====== SSE STREAM ======
app.get("/events", (req, res) => {
  // Header SSE
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // matikan buffering di proxy seperti nginx
  // CORS khusus SSE (kalau beda origin saat DEV)
  res.setHeader("Access-Control-Allow-Origin", "*");

  res.flushHeaders?.();
  req.socket?.setKeepAlive?.(true, 60_000);

  // Kirim snapshot pertama kali
  const snapshot = Array.from(devices, ([id, v]) => ({ id, ...v }));
  res.write(`event: snapshot\n`);
  res.write(`data: ${JSON.stringify(snapshot)}\n\n`);

  clients.add(res);

  req.on("close", () => {
    clients.delete(res);
    try {
      res.end();
    } catch {}
  });
});

// Broadcast update helper
function broadcastUpdate(id, value) {
  const payload = JSON.stringify({ id, ...value });
  for (const res of clients) {
    try {
      res.write(`event: update\n`);
      res.write(`data: ${payload}\n\n`);
    } catch {}
  }
}

// Heartbeat supaya koneksi tidak diputus idle
setInterval(() => {
  for (const res of clients) {
    try {
      res.write(": keep-alive\n\n");
    } catch {}
  }
}, 15_000);

// ====== INGEST DARI PERANGKAT ======
/*
Body contoh:
{
  "id": "A05A9C8481B0",
  "lat": -3.40,
  "lon": 119.19,
  "sats": 5,
  "hdop": 2.1
}
*/
app.options("/ingest", (_, res) => {
  // preflight CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Device-Id");
  res.status(204).end();
});

app.post("/ingest", (req, res) => {
  try {
    let { id, lat, lon, sats, hdop } = req.body || {};
    if (!id || typeof id !== "string") {
      id =
        req.headers["x-device-id"] ||
        req.ip ||
        req.socket?.remoteAddress ||
        "unknown";
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ error: "lat/lon harus numeric" });
    }

    const item = {
      lat,
      lon,
      sats: Number.isFinite(sats) ? sats : null,
      hdop: Number.isFinite(hdop) ? hdop : null,
      ts: Date.now(),
    };

    devices.set(id, item);
    broadcastUpdate(id, item);

    res.set("Connection", "close").status(200).json({ ok: true });
  } catch (e) {
    res.set("Connection", "close").status(500).json({ ok: false });
  }
});

// ====== SPA FALLBACK (PROD) ======
// Semua route non-API akan dikirimkan ke index.html agar React Router bekerja
if (IS_PROD) {
  app.get("*", (req, res, next) => {
    // Biarkan route API/SSE lewat
    if (
      req.path.startsWith("/ping") ||
      req.path.startsWith("/devices") ||
      req.path.startsWith("/device/") ||
      req.path.startsWith("/events") ||
      req.path.startsWith("/ingest")
    )
      return next();

    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

// ====== HTTP SERVER ======
const server = http.createServer(app);
server.keepAliveTimeout = 60_000; // keep-alive 60s
server.headersTimeout = 65_000;

server.listen(PORT, HOST, () => {
  console.log(
    `GPS server running at http://${HOST}:${PORT} (env: ${NODE_ENV})` +
      (IS_PROD ? " | serving React from /dist" : "")
  );
});
