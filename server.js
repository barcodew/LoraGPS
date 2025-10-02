const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"), { maxAge: 0 }));

let latest = {
  lat: -3.397373456680433, 
  lon: 119.21742844657336,
  sats: null,
  hdop: null,
  ts: Date.now(),
};

const clients = new Set();

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.write("retry: 3000\n\n");

  res.write(`data: ${JSON.stringify(latest)}\n\n`);

  clients.add(res);
  req.on("close", () => clients.delete(res));
});

function broadcastUpdate(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {}
  }
}

// terima data dari receiver/ESP32
app.post("/ingest", (req, res) => {
  const { lat, lon, sats, hdop } = req.body || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: "lat/lon harus numeric" });
  }
  latest = {
    lat,
    lon,
    sats: Number.isFinite(sats) ? sats : null,
    hdop: Number.isFinite(hdop) ? hdop : null,
    ts: Date.now(),
  };
  broadcastUpdate(latest);
  res.json({ status: "ok" });
});

app.get("/latest", (req, res) => res.json(latest));

// heartbeat agar koneksi SSE tidak diputus proxy/router
setInterval(() => {
  for (const res of clients) {
    try {
      res.write(":keep-alive\n\n");
    } catch {}
  }
}, 15000);

// ⏱ kirim snapshot tiap 1 detik (agar UI pasti “segar”)
setInterval(() => {
  broadcastUpdate(latest);
}, 1000);

app.listen(PORT, () => {
  console.log(`GPS server running at http://localhost:${PORT}`);
});
