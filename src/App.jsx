import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

export default function App() {
  const [devices, setDevices] = useState(new Map());
  const [focusId, setFocusId] = useState(null);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(
    () => window.matchMedia("(min-width: 1024px)").matches
  );

  const mapRef = useRef(null);
  const mapElRef = useRef(null);
  const markersRef = useRef(new Map());
  const focusLayerRef = useRef(null);
  const sidebarRef = useRef(null);

  const isDesktop = () => window.matchMedia("(min-width: 1024px)").matches;

  // Sinkronkan state -> <body class="drawer-open">
  useEffect(() => {
    document.body.classList.toggle("drawer-open", open);
  }, [open]);

  // Invalidate map setelah animasi panel selesai
  useEffect(() => {
    const el = sidebarRef.current;
    const map = mapRef.current;
    if (!el || !map) return;
    const onEnd = () => map.invalidateSize();
    el.addEventListener("transitionend", onEnd);
    return () => el.removeEventListener("transitionend", onEnd);
  }, []);

  // Init map
  useEffect(() => {
    if (!mapElRef.current) return;
    const map = L.map(mapElRef.current, { zoomControl: true }).setView(
      [-3.55, 118.9],
      6
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // SSE subscribe
  useEffect(() => {
    const es = new EventSource("/events");
    es.addEventListener("snapshot", (e) => {
      const arr = JSON.parse(e.data);
      setDevices(new Map(arr.map((d) => [d.id, d])));
    });
    es.addEventListener("update", (e) => {
      const d = JSON.parse(e.data);
      setDevices((prev) => {
        const n = new Map(prev);
        n.set(d.id, d);
        return n;
      });
    });
    return () => es.close();
  }, []);

  // Keep markers in sync
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    devices.forEach((v, id) => {
      let m = markersRef.current.get(id);
      const focused = id === focusId;
      const icon = L.divIcon({
        html: `<div class="marker ${focused ? "" : "dim"}"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      if (!m) {
        m = L.marker([v.lat, v.lon], { icon }).addTo(map).bindTooltip(id);
        markersRef.current.set(id, m);
      } else {
        m.setLatLng([v.lat, v.lon]);
        m.setIcon(icon);
      }
    });

    // Remove markers that no longer exist
    markersRef.current.forEach((m, id) => {
      if (!devices.has(id)) {
        map.removeLayer(m);
        markersRef.current.delete(id);
      }
    });

    // Focus pulse
    if (focusLayerRef.current) {
      map.removeLayer(focusLayerRef.current);
      focusLayerRef.current = null;
    }
    if (focusId && devices.has(focusId)) {
      const v = devices.get(focusId);
      const icon = L.divIcon({
        html: '<div class="pulse"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      focusLayerRef.current = L.marker([v.lat, v.lon], {
        icon,
        interactive: false,
      }).addTo(map);
    }
  }, [devices, focusId]);

  const list = useMemo(() => {
    const arr = Array.from(devices, ([id, v]) => ({ id, ...v }));
    arr.sort((a, b) => a.id.localeCompare(b.id));
    if (!filter) return arr;
    const f = filter.toLowerCase();
    return arr.filter((d) => d.id.toLowerCase().includes(f));
  }, [devices, filter]);

  function centerOnFocus() {
    if (!focusId || !devices.has(focusId)) return;
    const v = devices.get(focusId);
    mapRef.current.setView(
      [v.lat, v.lon],
      Math.max(15, mapRef.current.getZoom())
    );
    if (!isDesktop()) setOpen(false);
  }

  return (
    <div className="app">
      <div className="backdrop" onClick={() => setOpen(false)} />
      <aside className="sidebar-panel" ref={sidebarRef}>
        <div className="header">
          <div className="title">Devices</div>
          <button className="btn" onClick={centerOnFocus} disabled={!focusId}>
            Center on focus
          </button>
        </div>

        <input
          className="search"
          placeholder="Cari ID…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />

        {list.length === 0 ? (
          <div className="muted" style={{ marginTop: 16 }}>
            Belum ada data perangkat
          </div>
        ) : (
          list.map((d) => (
            <div
              key={d.id}
              className={`card ${focusId === d.id ? "active" : ""}`}
              onClick={() => setFocusId(d.id)}
            >
              <div className="row">
                <div>
                  <div>{d.id}</div>
                  <div className="muted">
                    LAT {d.lat.toFixed(6)} | LON {d.lon.toFixed(6)}
                  </div>
                </div>
                <div className="muted">
                  SATS {d.sats ?? 0} • HDOP {d.hdop ?? 0}
                </div>
              </div>
              <div className="muted">
                Updated: {new Date(d.ts).toLocaleTimeString()}
              </div>
            </div>
          ))
        )}
      </aside>

      <div className="map">
        <button
          className="toggle"
          onClick={() => {
            document.activeElement?.blur();
            setOpen((v) => !v);
          }}
          aria-label={open ? "Tutup sidebar" : "Buka sidebar"}
          aria-pressed={open}
        >
          {open ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>
        <div id="map" ref={mapElRef} />
      </div>
    </div>
  );
}
