// server.js
const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3000;

// ---- middlewares
app.disable("x-powered-by");
app.set("etag", false);
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "128kb", strict: true }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: 0 }));

// ---- state per-device: id -> {lat,lon,sats,hdop,ts}
const devices = new Map();
const clients = new Set();

// ---- health
app.get("/ping", (req, res) => {
  res.set("Connection", "close");
  res.status(200).type("text").send("pong");
});

// ---- REST helpers (optional, berguna buat debug)
app.get("/devices", (req, res) => {
  const arr = Array.from(devices, ([id, v]) => ({ id, ...v }));
  res.set("Connection", "close");
  res.json(arr);
});
app.get("/device/:id", (req, res) => {
  const v = devices.get(req.params.id);
  res.set("Connection", "close");
  if (!v) return res.status(404).json({ error: "not found" });
  res.json({ id: req.params.id, ...v });
});

// ---- SSE stream: kirim snapshot awal + update real-time
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();               // flush segera
  req.socket.setKeepAlive?.(true, 60_000);

  // kirim snapshot semua device sekali di awal
  const snapshot = Array.from(devices, ([id, v]) => ({ id, ...v }));
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);

  clients.add(res);
  req.on("close", () => {
    clients.delete(res);
    try { res.end(); } catch {}
  });
});

// broadcast update untuk satu device
function broadcastUpdate(id, value) {
  const payload = JSON.stringify({ id, ...value });
  for (const res of clients) {
    try { res.write(`event: update\ndata: ${payload}\n\n`); } catch {}
  }
}

// heartbeat supaya koneksi SSE tidak di-cut oleh proxy/router
setInterval(() => {
  for (const res of clients) {
    try { res.write(":keep-alive\n\n"); } catch {}
  }
}, 15_000);

// ---- ingest dari receiver/ESP32
// Body contoh: { id: "A05A9C8481B0", lat: -3.40, lon: 119.19, sats: 5, hdop: 2.1 }
app.post("/ingest", (req, res) => {
  try {
    let { id, lat, lon, sats, hdop } = req.body || {};
    // fallback id jika belum ada (sebaiknya receiver mengirim 'id')
    if (!id || typeof id !== "string") {
      id = req.headers["x-device-id"] || req.ip || req.socket?.remoteAddress || "unknown";
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      res.set("Connection", "close");
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
    broadcastUpdate(id, item);        // kirim ke semua klien SSE

    res.set("Connection", "close");
    res.status(200).json({ ok: true });
  } catch (e) {
    res.set("Connection", "close");
    res.status(500).json({ ok: false });
  }
});

// ---- HTTP server & timeouts
const server = http.createServer(app);
server.keepAliveTimeout = 60_000;
server.headersTimeout   = 65_000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`GPS server running at http://0.0.0.0:${PORT}`);
});
