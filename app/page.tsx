"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { supabase } from "./supabase";
import countryBorders from "./data/country-borders.json";
import admin1Lines from "./data/admin1-lines.json";
import countries from "./data/countries.json";
import lakes from "./data/lakes.json";
import type QrScanner from "qr-scanner";

type Guess = { name: string; color: string; x: number; y: number };
type RouteData = { type: "FeatureCollection"; features: Array<{ type: "Feature"; geometry: { type: "LineString"; coordinates: Array<[number, number]> }; properties: Record<string, never> }> };
type MapRef = { current: maplibregl.Map | null };
const playerColors = ["#ff6b4a", "#64d7ff", "#f5c451", "#b995ff", "#72e4ad", "#ff9ee8", "#8fb8ff", "#ffb86b"];
const initialPlayers: Guess[] = [];
const roomChannelName = "musikquiz-room-nord-7k";
const normalizeRoomCode = (value: string) => value.replace(/\s+/g, "").toUpperCase();

const upsertPlayer = (current: Guess[], incoming: Guess) => {
  const existingIndex = current.findIndex(player => player.name.toLowerCase() === incoming.name.toLowerCase());
  if (existingIndex < 0) return [...current, incoming];
  return current.map((player, index) => index === existingIndex ? { ...player, ...incoming } : player);
};

const answer = { x: 42, y: 45 };
const toLngLat = (point: { x: number; y: number }) => {
  const longitude = point.x * 3.6 - 180;
  const mercatorY = Math.PI * (1 - point.y / 50);
  const latitude = Math.atan(Math.sinh(mercatorY)) * 180 / Math.PI;
  return [longitude, latitude] as [number, number];
};
const toPercent = (longitude: number, latitude: number) => {
  const clampedLatitude = Math.max(-85.051129, Math.min(85.051129, latitude));
  const latitudeRadians = clampedLatitude * Math.PI / 180;
  const mercatorY = (1 - Math.log(Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)) / Math.PI) * 50;
  return { x: (longitude + 180) / 3.6, y: mercatorY };
};
const distanceKm = (first: { x: number; y: number }, second: { x: number; y: number }) => {
  const [firstLng, firstLat] = toLngLat(first).map(value => value * Math.PI / 180);
  const [secondLng, secondLat] = toLngLat(second).map(value => value * Math.PI / 180);
  const deltaLat = secondLat - firstLat;
  const deltaLng = secondLng - firstLng;
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(deltaLng / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

function Map({ reveal, guesses, onPick, selected, compact = false }: { reveal: number; guesses: Guess[]; onPick?: (x: number, y: number) => void; selected?: { x: number; y: number }; compact?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bordersRef = useRef<SVGSVGElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onPickRef = useRef(onPick);

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [0, 18], zoom: 1.15, minZoom: 1, maxZoom: 6,
      attributionControl: false, dragRotate: false, touchPitch: false,
    });
    const bordersSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    bordersSvg.classList.add("map-borders-overlay");
    bordersSvg.setAttribute("aria-hidden", "true");
    containerRef.current.appendChild(bordersSvg);
    bordersRef.current = bordersSvg;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.once("load", () => {
      map.getStyle().layers?.forEach(layer => {
        if (layer.type === "symbol") map.setLayoutProperty(layer.id, "visibility", "none");
      });
      if (map.getLayer("ne2_shaded")) map.setPaintProperty("ne2_shaded", "raster-opacity", 0.68);
      if (map.getLayer("boundary_2")) {
        map.setLayerZoomRange("boundary_2", 1, 24);
        map.setPaintProperty("boundary_2", "line-color", "#d9ff78");
        map.setPaintProperty("boundary_2", "line-opacity", 0.72);
        map.setPaintProperty("boundary_2", "line-width", ["interpolate", ["linear"], ["zoom"], 1, 0.9, 4, 1.35, 10, 2.2]);
      }
      if (map.getLayer("boundary_3")) {
        map.setLayerZoomRange("boundary_3", 2.8, 24);
        map.setPaintProperty("boundary_3", "line-color", "#64d7ff");
        map.setPaintProperty("boundary_3", "line-opacity", 0.68);
        map.setPaintProperty("boundary_3", "line-width", ["interpolate", ["linear"], ["zoom"], 2.8, 0.9, 8, 1.5, 12, 2.4]);
      }
    });
    mapRef.current = map;
    const drawBorders = () => {
      const svg = bordersRef.current;
      const container = containerRef.current;
      if (!svg || !container) return;
      const project = (coordinate: [number, number]) => {
        const point = map.project(coordinate);
        return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
      };
      const pathFor = (coordinates: unknown, close = false): string => {
        if (!Array.isArray(coordinates) || coordinates.length === 0) return "";
        if (typeof coordinates[0]?.[0] === "number") {
          const points = (coordinates as [number, number][]).map(project).join(" L");
          return `M${points}${close ? " Z" : ""}`;
        }
        return (coordinates as unknown[]).map(item => pathFor(item, close)).join(" ");
      };
      const countryFeatures = Array.isArray((countryBorders as { features?: unknown[] }).features) ? (countryBorders as { features: Array<{ geometry: { coordinates: unknown } }> }).features : [];
      const regionalFeatures = Array.isArray((admin1Lines as { features?: unknown[] }).features)
        ? (admin1Lines as { features: Array<{ geometry: { coordinates: unknown }; properties?: { country?: string } }> }).features
        : [];
      const landFeatures = Array.isArray((countries as { features?: unknown[] }).features) ? (countries as { features: Array<{ geometry: { coordinates: unknown } }> }).features : [];
      const lakeFeatures = Array.isArray((lakes as { features?: unknown[] }).features) ? (lakes as { features: Array<{ geometry: { coordinates: unknown } }> }).features : [];
      const landPaths = landFeatures.map(feature => pathFor(feature.geometry.coordinates, true)).filter(Boolean);
      const lakePaths = lakeFeatures.map(feature => pathFor(feature.geometry.coordinates, true)).filter(Boolean);
      ["water"].forEach(layerId => {
        if (map.getLayer(layerId)) {
          map.setPaintProperty(layerId, "fill-color", "#174b56");
          map.setPaintProperty(layerId, "fill-opacity", 1);
        }
      });
      ["waterway_river", "waterway_other"].forEach(layerId => {
        if (map.getLayer(layerId)) {
          map.setPaintProperty(layerId, "line-color", "#4f9eaa");
          map.setPaintProperty(layerId, "line-opacity", 0.78);
        }
      });
      const zoom = map.getZoom();
      const paths = zoom >= 2.15 ? countryFeatures.map(feature => pathFor(feature.geometry.coordinates)).filter(Boolean) : [];
      const regionalPaths = zoom >= 3.3
        ? regionalFeatures.filter(feature => feature.properties?.country === "SWE").map(feature => pathFor(feature.geometry.coordinates)).filter(Boolean)
        : [];
      const statePaths = zoom >= 2.15
        ? regionalFeatures.filter(feature => feature.properties?.country === "USA").map(feature => pathFor(feature.geometry.coordinates)).filter(Boolean)
        : [];
      svg.setAttribute("data-country-detail", zoom >= 2.15 ? "true" : "false");
      svg.setAttribute("data-regional-detail", zoom >= 3.3 ? "true" : "false");
      svg.setAttribute("data-state-detail", zoom >= 2.15 ? "true" : "false");
      svg.setAttribute("viewBox", `0 0 ${container.clientWidth} ${container.clientHeight}`);
      svg.innerHTML = `<rect class="map-water-overlay" width="100%" height="100%" style="fill:#347b96;opacity:.92"/><g class="map-land-overlay" style="fill:#e6e6c4;opacity:.88">${landPaths.map(path => `<path d="${path}"/>`).join("")}</g><g class="map-lakes-overlay" style="fill:#347b96;opacity:.98">${lakePaths.map(path => `<path d="${path}"/>`).join("")}</g><g class="map-border-lines map-border-lines--country" style="stroke:#58645b;stroke-width:1px;opacity:.86">${paths.map(path => `<path d="${path}"/>`).join("")}</g><g class="map-border-lines map-border-lines--regional" style="stroke:#7b887b;stroke-width:.7px;opacity:.62">${regionalPaths.map(path => `<path d="${path}"/>`).join("")}</g><g class="map-border-lines map-border-lines--state" style="stroke:#6f7d70;stroke-width:.8px;opacity:.68">${statePaths.map(path => `<path d="${path}"/>`).join("")}</g>`;
    };
    map.on("load", drawBorders);
    map.on("idle", drawBorders);
    map.on("move", drawBorders);
    map.on("resize", drawBorders);
    window.setTimeout(drawBorders, 900);
    const handleClick = (event: maplibregl.MapMouseEvent) => {
      const pick = onPickRef.current;
      if (pick) pick(...Object.values(toPercent(event.lngLat.lng, event.lngLat.lat)) as [number, number]);
    };
    map.on("click", handleClick);
    return () => { map.off("load", drawBorders); map.off("idle", drawBorders); map.off("move", drawBorders); map.off("resize", drawBorders); map.off("click", handleClick); map.remove(); bordersSvg.remove(); bordersRef.current = null; mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const render = () => {
      const routeData = { type: "FeatureCollection", features: reveal >= 3 ? guesses.map(guess => ({ type: "Feature", geometry: { type: "LineString", coordinates: [toLngLat(guess), toLngLat(answer)] }, properties: {} })) : [] } as RouteData;
      if (map.getSource("routes")) (map.getSource("routes") as maplibregl.GeoJSONSource).setData(routeData);
      else { map.addSource("routes", { type: "geojson", data: routeData }); map.addLayer({ id: "routes", type: "line", source: "routes", paint: { "line-color": "#d9ff78", "line-width": 1.5, "line-opacity": 0.7, "line-dasharray": [2, 2] } }); }
      if (reveal >= 3) { const bounds = new maplibregl.LngLatBounds(toLngLat(answer), toLngLat(answer)); guesses.forEach(guess => bounds.extend(toLngLat(guess))); map.fitBounds(bounds, { padding: 80, maxZoom: 3.2, duration: 700 }); }
    };
    if (map.loaded()) render(); else map.once("load", render);
  }, [reveal, guesses, selected]);

  return <div className={`map-shell ${compact ? "map-shell--compact" : ""}`}>
    <div ref={containerRef} className="map map--real" aria-label="Interaktiv världskarta" />
    {selected && <OverlayMarker mapRef={mapRef} point={selected} className="map-pin--selected" label="DU" />}
    {reveal >= 1 && guesses.map(guess => <OverlayMarker key={guess.name} mapRef={mapRef} point={guess} className="map-pin--player" label={guess.name} color={guess.color} />)}
    {reveal >= 2 && <OverlayMarker mapRef={mapRef} point={answer} className="map-pin--answer" label="FACIT" />}
  </div>;
}

function OverlayMarker({ mapRef, point, className, label, color }: { mapRef: MapRef; point: { x: number; y: number }; className: string; label: string; color?: string }) {
  const markerRef = useRef<HTMLDivElement>(null);
  const { x, y } = point;

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    if (color) marker.style.setProperty("--pin-color", color);
    const positionMarker = () => {
      const projected = map.project(toLngLat({ x, y }));
      marker.style.left = `${projected.x}px`;
      marker.style.top = `${projected.y}px`;
    };
    positionMarker();
    map.on("load", positionMarker);
    map.on("move", positionMarker);
    map.on("resize", positionMarker);
    map.on("zoom", positionMarker);
    return () => {
      map.off("load", positionMarker);
      map.off("move", positionMarker);
      map.off("resize", positionMarker);
      map.off("zoom", positionMarker);
    };
  }, [color, mapRef, x, y]);

  return <div ref={markerRef} className={`map-pin ${className}`} aria-hidden="true"><span>{label}</span></div>;
}

export default function Home() {
  const [mode, setMode] = useState<"host" | "player">(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("room") ? "player" : "host");
  const [reveal, setReveal] = useState(0);
  const [round, setRound] = useState(4);
  const [picked, setPicked] = useState({ x: 45, y: 46 });
  const [locked, setLocked] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [joined, setJoined] = useState(false);
  const [roomCodeInput, setRoomCodeInput] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("room") ?? "");
  const [scanOpen, setScanOpen] = useState(false);
  const [scanError, setScanError] = useState("");
  const [players, setPlayers] = useState<Guess[]>(initialPlayers);
  const [connectionStatus, setConnectionStatus] = useState("ANSLUTER");
  const sessionId = useState(() => typeof crypto === "undefined" ? Math.random().toString(36).slice(2) : crypto.randomUUID())[0];
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const hostQrRef = useRef<HTMLCanvasElement>(null);
  const scanVideoRef = useRef<HTMLVideoElement>(null);
  const qrScannerRef = useRef<QrScanner | null>(null);
  const roomCode = "NORD 7K";
  const ready = players.length;
  const sorted = useMemo(() => [...players].sort((a, b) => distanceKm(a, answer) - distanceKm(b, answer)), [players]);
  const pickedLngLat = toLngLat(picked);
  const roomStateRef = useRef({ round, reveal, players });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const scannedRoom = new URLSearchParams(window.location.search).get("room");
      if (!scannedRoom) return;
      setRoomCodeInput(scannedRoom);
      setMode("player");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (mode !== "host" || !hostQrRef.current) return;
    let active = true;
    void import("qrcode").then(QRCode => {
      if (!active || !hostQrRef.current) return;
      void QRCode.toCanvas(hostQrRef.current, `${window.location.origin}/?room=${encodeURIComponent(roomCode)}`, {
        width: 156,
        margin: 1,
        color: { dark: "#081218", light: "#e6e6c4" },
      });
    });
    return () => { active = false; };
  }, [mode, roomCode]);

  useEffect(() => {
    if (!scanOpen || !scanVideoRef.current) return;
    let cancelled = false;
    let scanner: QrScanner | null = null;
    setScanError("");
    void import("qr-scanner").then(({ default: QrScanner }) => {
      if (cancelled || !scanVideoRef.current) return;
      scanner = new QrScanner(scanVideoRef.current, result => {
        const scannedValue = result.data;
        let scannedRoom = scannedValue;
        try {
          scannedRoom = new URL(scannedValue, window.location.href).searchParams.get("room") ?? scannedValue;
        } catch {
          // A plain room code is also accepted.
        }
        if (normalizeRoomCode(scannedRoom) !== normalizeRoomCode(roomCode)) {
          setScanError("QR-koden hör till ett annat rum.");
          return;
        }
        setRoomCodeInput(roomCode);
        setScanOpen(false);
      }, { highlightScanRegion: true, highlightCodeOutline: true, returnDetailedScanResult: true });
      qrScannerRef.current = scanner;
      void scanner.start().catch(() => setScanError("Kameran kunde inte starta. Kontrollera kamerabehörigheten."));
    });
    return () => {
      cancelled = true;
      scanner?.destroy();
      qrScannerRef.current = null;
    };
  }, [scanOpen, roomCode]);

  useEffect(() => {
    roomStateRef.current = { round, reveal, players };
  }, [round, reveal, players]);

  useEffect(() => {
    const channel = supabase
      .channel(roomChannelName)
      .on("broadcast", { event: "room_request" }, () => {
        if (mode !== "host") return;
        void channel.send({ type: "broadcast", event: "room_state", payload: { ...roomStateRef.current, source: "host" } });
      })
      .on("broadcast", { event: "room_state" }, ({ payload }) => {
        if (mode === "host" || payload?.source !== "host") return;
        if (Array.isArray(payload.players)) setPlayers(payload.players as Guess[]);
        if (typeof payload.round === "number") setRound(payload.round);
        if (typeof payload.reveal === "number") setReveal(payload.reveal);
      })
      .on("broadcast", { event: "player_joined" }, ({ payload }) => {
        if (payload?.player?.name) setPlayers(current => upsertPlayer(current, payload.player as Guess));
      })
      .on("broadcast", { event: "guess_submitted" }, ({ payload }) => {
        if (payload?.player?.name) setPlayers(current => upsertPlayer(current, payload.player as Guess));
      })
      .subscribe(status => {
        if (status === "SUBSCRIBED") {
          setConnectionStatus("ANSLUTEN");
          if (mode === "player") void channel.send({ type: "broadcast", event: "room_request", payload: { sessionId } });
          else void channel.send({ type: "broadcast", event: "room_state", payload: { ...roomStateRef.current, source: "host" } });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnectionStatus("OFFLINE");
        }
      });
    channelRef.current = channel;
    return () => {
      if (channelRef.current === channel) channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [mode, roomCode, sessionId]);

  useEffect(() => {
    if (mode !== "host" || !channelRef.current) return;
    void channelRef.current.send({ type: "broadcast", event: "room_state", payload: { round, reveal, players, source: "host" } });
  }, [mode, round, reveal, players]);

  const joinRoom = () => {
    const baseName = playerName.trim().slice(0, 24);
    if (!baseName || normalizeRoomCode(roomCodeInput) !== normalizeRoomCode(roomCode) || connectionStatus === "OFFLINE") return;
    let uniqueName = baseName;
    let suffix = 2;
    while (players.some(player => player.name.toLowerCase() === uniqueName.toLowerCase())) uniqueName = `${baseName} ${suffix++}`;
    setPlayerName(uniqueName);
    const player = { name: uniqueName, color: playerColors[players.length % playerColors.length], x: picked.x, y: picked.y };
    setPlayers(current => upsertPlayer(current, player));
    void channelRef.current?.send({ type: "broadcast", event: "player_joined", payload: { player, sessionId } });
    setJoined(true);
  };

  const lockGuess = () => {
    const player = players.find(candidate => candidate.name === playerName);
    if (!player) return;
    const updatedPlayer = { ...player, x: picked.x, y: picked.y };
    setPlayers(current => upsertPlayer(current, updatedPlayer));
    void channelRef.current?.send({ type: "broadcast", event: "guess_submitted", payload: { player: updatedPlayer, sessionId } });
    setLocked(true);
  };

  const nextRound = () => {
    setRound(current => current + 1);
    setReveal(0);
    setLocked(false);
    setPlayers(current => current.map(player => ({ ...player, x: 45, y: 46 })));
  };

  if (mode === "player") return <main className="shell shell--player"><header className="topbar"><div className="brand"><span className="brand__mark">✦</span><span>VÄRLDENS TONER</span></div><button className="ghost" onClick={() => setMode("host")}>Spelledarvy</button></header><section className="player-card">
    {!joined ? <><div className="eyebrow">DU ÄR INBJUDEN TILL RUMMET</div><h1>Sätt din nål.<br/><em>Hitta rätt plats.</em></h1><p className="muted">Skanna QR-koden från spelledaren eller fyll i rumskoden.</p><input value={roomCodeInput} onChange={e=>setRoomCodeInput(e.target.value)} placeholder="Rumskod" autoFocus /><button className="button button--secondary button--wide" onClick={() => setScanOpen(true)}>SKANNA QR-KOD <span>⌁</span></button><input value={playerName} onChange={e=>setPlayerName(e.target.value)} onKeyDown={e=>e.key === "Enter" && joinRoom()} placeholder="Ditt namn" /><button className="button button--primary button--wide" disabled={!playerName.trim() || normalizeRoomCode(roomCodeInput) !== normalizeRoomCode(roomCode)} onClick={joinRoom}>ANSLUT TILL RUMMET <span>→</span></button><div className="room-pill">RUMSKODEN ÄR ENDAST <strong>{roomCode}</strong></div>{scanOpen && <div className="scan-modal" role="dialog" aria-modal="true" aria-label="Skanna QR-kod"><div className="scan-modal__card"><div className="eyebrow">SKANNA FÖR ATT ANSLUTA</div><h2>Rikta kameran mot QR-koden</h2><video ref={scanVideoRef} muted playsInline />{scanError && <p className="scan-error">{scanError}</p>}<div className="scan-modal__actions"><button className="button button--outline" onClick={() => setScanOpen(false)}>AVBRYT</button></div></div></div>}</> : <><div className="player-status"><span className="live-dot"/> ANSLUTEN SOM <strong>{playerName.toUpperCase()}</strong><span className="round-tag">OMGÅNG {String(round).padStart(2, "0")}</span></div><h2>Var i världen hörde du<br/>den här låten?</h2><p className="muted">Tryck på kartan för att placera din gissning.</p><Map reveal={reveal} guesses={players} selected={picked} compact onPick={(x,y)=>!locked&&setPicked({x,y})}/><div className="player-actions"><div className="guess-readout"><span className="pin-dot"/> DIN GISSNING <strong>{Math.round(pickedLngLat[1])}°N, {Math.round(pickedLngLat[0])}°E</strong></div><button className={`button ${locked ? "button--locked" : "button--primary"}`} disabled={locked || reveal > 0} onClick={lockGuess}>{locked ? "SVAR LÅST ✓" : reveal > 0 ? "OMGÅNGEN ÄR LÅST" : "LÅS SVAR"}</button></div></>}
  </section></main>;

  return <main className="shell"><header className="topbar"><div className="brand"><span className="brand__mark">✦</span><span>VÄRLDENS TONER</span></div><div className="topbar__center"><span className="live-dot"/> LIVEKVÄLL <span className="divider"/> RUM <strong>{roomCode}</strong></div><button className="ghost" onClick={()=>setMode("player")}>Spelarvy ↗</button></header><div className="host-layout"><aside className="sidebar"><div className="eyebrow">SPELLEDARPANEL</div><h1>AW<br/><em>Geografisk</em><br/>edition</h1><div className="round-card"><span>AKTIV OMGÅNG</span><strong>{String(round).padStart(2,"0")}</strong><small>av 10</small></div><div className="progress"><span style={{width:`${Math.min(round*10, 100)}%`}}/></div><div className="players-list"><div className="eyebrow">SPELARE <strong>{ready} ANSLUTNA</strong></div>{players.map(p=><div className="player-row" key={p.name}><i style={{background:p.color}}/><span>{p.name}</span><b>KLAR</b></div>)}</div><div className="room-qr"><canvas ref={hostQrRef} aria-label={`QR-kod för rum ${roomCode}`} /><div><strong>SKANNA FÖR ATT DELTA</strong><small>Öppna mobilkameran och rikta mot koden.</small></div></div><div className="host-tip"><span>♫</span><div><strong>Spela musiken</strong><small>Frågan ställs utanför appen.</small></div></div></aside><section className="stage"><div className="stage-head"><div><div className="eyebrow">KARTA · OMGÅNG {String(round).padStart(2,"0")}</div><h2>Var i världen?</h2></div><div className="phase"><span className="phase-dot"/> {reveal === 0 ? "SVAR SAMLAS IN" : reveal === 1 ? "GISSNINGAR VISAS" : reveal === 2 ? "FACIT VISAS" : "RESULTAT"}</div></div><Map reveal={reveal} guesses={players}/><div className="reveal-controls"><button className="button button--outline" disabled={reveal < 1} onClick={()=>setReveal(0)}>↺ Återställ</button><button className={`button ${reveal >= 1 ? "button--done" : "button--primary"}`} onClick={()=>setReveal(1)}>{reveal >= 1 ? "GISSNINGAR VISAS ✓" : "VISA SPELARNAS PLATSER"}</button><button className={`button ${reveal >= 2 ? "button--done" : "button--primary"}`} disabled={reveal < 1} onClick={()=>setReveal(2)}>{reveal >= 2 ? "RÄTT PLATS VISAS ✓" : "VISA RÄTT PLATS"}</button><button className={`button ${reveal >= 3 ? "button--done" : "button--accent"}`} disabled={reveal < 2} onClick={()=>setReveal(3)}>{reveal >= 3 ? "AVSTÅND VISAS ✓" : "VISA AVSTÅND"}</button></div>{reveal >= 3 && <div className="results"><div className="results-head"><div><div className="eyebrow">OMGÅNGSRESULTAT</div><h3>Närmast rätt plats</h3></div><button className="button button--primary" onClick={nextRound}>NÄSTA OMGÅNG →</button></div><div className="result-grid">{sorted.map((p,i)=><div className={`result-row ${i===0?"result-row--winner":""}`} key={p.name}><strong>{String(i+1).padStart(2,"0")}</strong><i style={{background:p.color}}/><span>{p.name}{i===0&&<small> ★ VINNARE</small>}</span><b>{distanceKm(p, answer).toLocaleString("sv-SE")} km</b></div>)}</div></div>}</section></div></main>;
}
