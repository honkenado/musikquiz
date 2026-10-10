"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Guess = { name: string; color: string; x: number; y: number; km?: number };
type RouteData = { type: "FeatureCollection"; features: Array<{ type: "Feature"; geometry: { type: "LineString"; coordinates: Array<[number, number]> }; properties: Record<string, never> }> };
const players: Guess[] = [
  { name: "Maja", color: "#ff6b4a", x: 39, y: 43, km: 118 },
  { name: "Oskar", color: "#64d7ff", x: 47, y: 49, km: 842 },
  { name: "Nora", color: "#f5c451", x: 57, y: 37, km: 1260 },
  { name: "Viktor", color: "#b995ff", x: 33, y: 53, km: 2210 },
];

function Map({ reveal, guesses, onPick, selected, compact = false }: { reveal: number; guesses: Guess[]; onPick?: (x: number, y: number) => void; selected?: { x: number; y: number }; compact?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const answer = { x: 42, y: 45 };
  const toLngLat = (point: { x: number; y: number }) => [point.x * 3.6 - 180, 90 - point.y * 1.8] as [number, number];
  const toPercent = (lng: number, lat: number) => ({ x: Math.round((lng + 180) / 3.6), y: Math.round((90 - lat) / 1.8) });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [0, 18], zoom: 1.15, minZoom: 1, maxZoom: 6,
      attributionControl: false, dragRotate: false, touchPitch: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.once("load", () => map.getStyle().layers?.filter(layer => layer.type === "symbol").forEach(layer => map.setLayoutProperty(layer.id, "visibility", "none")));
    mapRef.current = map;
    if (onPick) map.on("click", event => onPick(...Object.values(toPercent(event.lngLat.lng, event.lngLat.lat)) as [number, number]));
    return () => { markersRef.current.forEach(marker => marker.remove()); map.remove(); mapRef.current = null; };
  }, [onPick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const render = () => {
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
      const addMarker = (point: { x: number; y: number }, className: string, label: string, color?: string) => {
        const element = document.createElement("div");
        element.className = `map-pin ${className}`;
        if (color) element.style.setProperty("--pin-color", color);
        element.innerHTML = `<span>${label}</span>`;
        markersRef.current.push(new maplibregl.Marker({ element, anchor: "bottom" }).setLngLat(toLngLat(point)).addTo(map));
      };
      if (selected) addMarker(selected, "map-pin--selected", "DU");
      if (reveal >= 1) guesses.forEach(guess => addMarker(guess, "map-pin--player", guess.name, guess.color));
      if (reveal >= 2) addMarker(answer, "map-pin--answer", "FACIT");
      const routeData = { type: "FeatureCollection", features: reveal >= 3 ? guesses.map(guess => ({ type: "Feature", geometry: { type: "LineString", coordinates: [toLngLat(guess), toLngLat(answer)] }, properties: {} })) : [] } as RouteData;
      if (map.getSource("routes")) (map.getSource("routes") as maplibregl.GeoJSONSource).setData(routeData);
      else { map.addSource("routes", { type: "geojson", data: routeData }); map.addLayer({ id: "routes", type: "line", source: "routes", paint: { "line-color": "#d9ff78", "line-width": 1.5, "line-opacity": 0.7, "line-dasharray": [2, 2] } }); }
      if (reveal >= 3) { const bounds = new maplibregl.LngLatBounds(toLngLat(answer), toLngLat(answer)); guesses.forEach(guess => bounds.extend(toLngLat(guess))); map.fitBounds(bounds, { padding: 80, maxZoom: 3.2, duration: 700 }); }
    };
    if (map.loaded()) render(); else map.once("load", render);
  }, [reveal, guesses, selected]);

  return <div ref={containerRef} className={`map map--real ${compact ? "map--compact" : ""}`} aria-label="Interaktiv världskarta" />;
}

export default function Home() {
  const [mode, setMode] = useState<"host" | "player">("host");
  const [reveal, setReveal] = useState(0);
  const [round, setRound] = useState(4);
  const [picked, setPicked] = useState({ x: 45, y: 46 });
  const [locked, setLocked] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [joined, setJoined] = useState(false);
  const ready = mode === "host" ? 4 : 1;
  const sorted = useMemo(() => [...players].sort((a,b) => (a.km ?? 0) - (b.km ?? 0)), []);
  const nextRound = () => { setRound(r => r + 1); setReveal(0); };

  if (mode === "player") return <main className="shell shell--player"><header className="topbar"><div className="brand"><span className="brand__mark">✦</span><span>VÄRLDENS TONER</span></div><button className="ghost" onClick={() => setMode("host")}>Spelledarvy</button></header><section className="player-card">
    {!joined ? <><div className="eyebrow">DU ÄR INBJUDEN TILL RUMMET</div><h1>Sätt din nål.<br/><em>Hitta rätt plats.</em></h1><p className="muted">Skriv ditt namn för att ansluta till quizet.</p><input value={playerName} onChange={e=>setPlayerName(e.target.value)} placeholder="Ditt namn" autoFocus /><button className="button button--primary button--wide" disabled={!playerName.trim()} onClick={()=>setJoined(true)}>ANSLUT TILL RUMMET <span>→</span></button><div className="room-pill">RUMSKOD <strong>NORD 7K</strong></div></> : <><div className="player-status"><span className="live-dot"/> ANSLUTEN SOM <strong>{playerName.toUpperCase()}</strong><span className="round-tag">OMGÅNG 04</span></div><h2>Var i världen hörde du<br/>den här låten?</h2><p className="muted">Tryck på kartan för att placera din gissning.</p><Map reveal={0} guesses={[]} selected={picked} compact onPick={(x,y)=>!locked&&setPicked({x,y})}/><div className="player-actions"><div className="guess-readout"><span className="pin-dot"/> DIN GISSNING <strong>{picked.x}°N, {picked.y}°E</strong></div><button className={`button ${locked ? "button--locked" : "button--primary"}`} onClick={()=>setLocked(v=>!v)}>{locked ? "SVAR LÅST ✓" : "LÅS SVAR"}</button></div></>}
  </section></main>;

  return <main className="shell"><header className="topbar"><div className="brand"><span className="brand__mark">✦</span><span>VÄRLDENS TONER</span></div><div className="topbar__center"><span className="live-dot"/> LIVEKVÄLL <span className="divider"/> RUM <strong>NORD 7K</strong></div><button className="ghost" onClick={()=>setMode("player")}>Spelarvy ↗</button></header><div className="host-layout"><aside className="sidebar"><div className="eyebrow">SPELLEDARPANEL</div><h1>AW<br/><em>Geografisk</em><br/>edition</h1><div className="round-card"><span>AKTIV OMGÅNG</span><strong>{String(round).padStart(2,"0")}</strong><small>av 10</small></div><div className="progress"><span style={{width:`${round*10}%`}}/></div><div className="players-list"><div className="eyebrow">SPELARE <strong>{ready}/4 KLARA</strong></div>{players.map(p=><div className="player-row" key={p.name}><i style={{background:p.color}}/><span>{p.name}</span><b>{p.km ? "KLAR" : "VÄNTAR"}</b></div>)}</div><div className="host-tip"><span>♫</span><div><strong>Spela musiken</strong><small>Frågan ställs utanför appen.</small></div></div></aside><section className="stage"><div className="stage-head"><div><div className="eyebrow">KARTA · OMGÅNG {String(round).padStart(2,"0")}</div><h2>Var i världen?</h2></div><div className="phase"><span className="phase-dot"/> {reveal === 0 ? "SVAR SAMLAS IN" : reveal === 1 ? "GISSNINGAR VISAS" : reveal === 2 ? "FACIT VISAS" : "RESULTAT"}</div></div><Map reveal={reveal} guesses={players}/><div className="reveal-controls"><button className="button button--outline" disabled={reveal < 1} onClick={()=>setReveal(0)}>↺ Återställ</button><button className={`button ${reveal >= 1 ? "button--done" : "button--primary"}`} onClick={()=>setReveal(1)}>{reveal >= 1 ? "GISSNINGAR VISAS ✓" : "VISA SPELARNAS PLATSER"}</button><button className={`button ${reveal >= 2 ? "button--done" : "button--primary"}`} disabled={reveal < 1} onClick={()=>setReveal(2)}>{reveal >= 2 ? "RÄTT PLATS VISAS ✓" : "VISA RÄTT PLATS"}</button><button className={`button ${reveal >= 3 ? "button--done" : "button--accent"}`} disabled={reveal < 2} onClick={()=>setReveal(3)}>{reveal >= 3 ? "AVSTÅND VISAS ✓" : "VISA AVSTÅND"}</button></div>{reveal >= 3 && <div className="results"><div className="results-head"><div><div className="eyebrow">OMGÅNGSRESULTAT</div><h3>Närmast rätt plats</h3></div><button className="button button--primary" onClick={nextRound}>NÄSTA OMGÅNG →</button></div><div className="result-grid">{sorted.map((p,i)=><div className={`result-row ${i===0?"result-row--winner":""}`} key={p.name}><strong>{String(i+1).padStart(2,"0")}</strong><i style={{background:p.color}}/><span>{p.name}{i===0&&<small> ★ VINNARE</small>}</span><b>{p.km?.toLocaleString("sv-SE")} km</b></div>)}</div></div>}</section></div></main>;
}
