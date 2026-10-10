"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { supabase } from "./supabase";
import type { User } from "@supabase/supabase-js";
import countryBorders from "./data/country-borders.json";
import admin1Lines from "./data/admin1-lines.json";
import countries from "./data/countries.json";
import lakes from "./data/lakes.json";
import type QrScanner from "qr-scanner";

type Guess = { name: string; color: string; x: number; y: number };
type QuizQuestion = { id: string; prompt: string; place_label: string; latitude: number; longitude: number; spotify_url: string; spotify_title: string | null; spotify_artist: string | null };
type QuestionBankPanelProps = { questions: QuizQuestion[]; prompt: string; setPrompt: (value: string) => void; place: string; setPlace: (value: string) => void; spotifyUrl: string; setSpotifyUrl: (value: string) => void; point: { latitude: number; longitude: number } | null; setPoint: (value: { latitude: number; longitude: number } | null) => void; preview: { title: string; artist: string } | null; status: string; selectedIds: string[]; setSelectedIds: Dispatch<SetStateAction<string[]>>; findPlace: () => void; save: () => void; useSelected: () => void; showMap?: boolean };
type AppMode = "host" | "player" | "admin" | "tv";
type RouteData = { type: "FeatureCollection"; features: Array<{ type: "Feature"; geometry: { type: "LineString"; coordinates: Array<[number, number]> }; properties: Record<string, never> }> };
type MapRef = { current: maplibregl.Map | null };
const playerColors = ["#ff6b4a", "#64d7ff", "#f5c451", "#b995ff", "#72e4ad", "#ff9ee8", "#8fb8ff", "#ffb86b"];
const initialPlayers: Guess[] = [];
const roomChannelName = "musikquiz-room-nord-7k";
const normalizeRoomCode = (value: string) => value.replace(/\s+/g, "").toUpperCase();
const activeQuestionsStorageKey = "musikquiz-active-questions";
const generateRoomCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
};

const upsertPlayer = (current: Guess[], incoming: Guess) => {
  const existingIndex = current.findIndex(player => player.name.toLowerCase() === incoming.name.toLowerCase());
  if (existingIndex < 0) return [...current, incoming];
  return current.map((player, index) => index === existingIndex ? { ...player, ...incoming } : player);
};

const defaultAnswer = { x: 42, y: 45 };
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

function Map({ reveal, guesses, answer, onPick, selected, compact = false, showAnswer = false }: { reveal: number; guesses: Guess[]; answer: { x: number; y: number }; onPick?: (x: number, y: number) => void; selected?: { x: number; y: number }; compact?: boolean; showAnswer?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bordersRef = useRef<SVGSVGElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onPickRef = useRef(onPick);
  const [mapReady, setMapReady] = useState(false);
  const answerX = answer.x;
  const answerY = answer.y;

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
      setMapReady(true);
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
    const readyTimer = window.setTimeout(() => setMapReady(true), 500);
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
    return () => { window.clearTimeout(readyTimer); map.off("load", drawBorders); map.off("idle", drawBorders); map.off("move", drawBorders); map.off("resize", drawBorders); map.off("click", handleClick); map.remove(); bordersSvg.remove(); bordersRef.current = null; mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const render = () => {
      const answerPoint = { x: answerX, y: answerY };
      const routeData = { type: "FeatureCollection", features: reveal >= 3 ? guesses.map(guess => ({ type: "Feature", geometry: { type: "LineString", coordinates: [toLngLat(guess), toLngLat(answerPoint)] }, properties: {} })) : [] } as RouteData;
      if (map.getSource("routes")) (map.getSource("routes") as maplibregl.GeoJSONSource).setData(routeData);
      else { map.addSource("routes", { type: "geojson", data: routeData }); map.addLayer({ id: "routes", type: "line", source: "routes", paint: { "line-color": "#d9ff78", "line-width": 1.5, "line-opacity": 0.7, "line-dasharray": [2, 2] } }); }
      if (reveal >= 3) { const bounds = new maplibregl.LngLatBounds(toLngLat(answerPoint), toLngLat(answerPoint)); guesses.forEach(guess => bounds.extend(toLngLat(guess))); map.fitBounds(bounds, { padding: 80, maxZoom: 3.2, duration: 700 }); }
    };
    if (map.loaded()) render(); else map.once("load", render);
  }, [answerX, answerY, reveal, guesses]);

  return <div className={`map-shell ${compact ? "map-shell--compact" : ""}`}>
    <div ref={containerRef} className="map map--real" aria-label="Interaktiv världskarta" />
    {mapReady && selected && <OverlayMarker mapRef={mapRef} point={selected} className="map-pin--selected" label="DU" />}
    {mapReady && reveal >= 1 && guesses.map(guess => <OverlayMarker key={guess.name} mapRef={mapRef} point={guess} className="map-pin--player" label={guess.name} color={guess.color} />)}
    {mapReady && (showAnswer || reveal >= 2) && <OverlayMarker mapRef={mapRef} point={answer} className="map-pin--answer" label="FACIT" />}
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

function QuestionBankPanel({ questions, prompt, setPrompt, place, setPlace, spotifyUrl, setSpotifyUrl, point, setPoint, preview, status, selectedIds, setSelectedIds, findPlace, save, useSelected, showMap = false }: QuestionBankPanelProps) {
  const form = <div className="question-editor-form"><div className="eyebrow">FRÅGEBANK</div><strong>Ny fråga</strong><input value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Skriv frågan" /><div className="question-place"><input value={place} onChange={e=>setPlace(e.target.value)} placeholder="Plats, t.ex. New York" /><button className="button button--secondary" onClick={findPlace}>SÖK</button></div><input value={spotifyUrl} onChange={e=>setSpotifyUrl(e.target.value)} placeholder="Klistra in Spotifylänk" />{preview && <small className="spotify-preview">♫ {preview.title} — {preview.artist}</small>}{point && <small>PLATS VALD ✓</small>}<button className="button button--primary button--wide" disabled={!prompt.trim() || !point || !spotifyUrl.trim()} onClick={save}>SPARA FRÅGA</button>{status && <small>{status}</small>}<div className="question-list">{questions.length ? questions.map(question=><label key={question.id}><input type="checkbox" checked={selectedIds.includes(question.id)} onChange={event=>setSelectedIds(current=>event.target.checked ? [...current, question.id] : current.filter(id=>id !== question.id))} /><span><strong>{question.spotify_title ?? "Spotifylänk"}</strong><small>{question.place_label}</small></span></label>) : <small>Inga sparade frågor ännu.</small>}</div><button className="button button--outline button--wide" disabled={!selectedIds.length} onClick={useSelected}>ANVÄND VALDA I OMGÅNGEN ({selectedIds.length})</button></div>;
  if (!showMap) return <div className="question-bank">{form}</div>;
  const previewPoint = point ? toPercent(point.longitude, point.latitude) : defaultAnswer;
  return <div className="question-bank question-bank--with-map"><div className="question-editor-layout">{form}<div className="question-editor-map"><div className="eyebrow">PLATSKONTROLL</div><p className="muted">Sök fram platsen eller finjustera nålen direkt på kartan.</p><Map reveal={0} guesses={[]} answer={previewPoint} showAnswer={Boolean(point)} onPick={(x, y) => { const [longitude, latitude] = toLngLat({ x, y }); setPoint({ longitude, latitude }); }} /></div></div></div>;
}

function HostSessionPanel({ started, onStart }: { started: boolean; onStart: () => void }) {
    const openTvWindow = () => {
      const tvWindow = window.open(`${window.location.origin}/?tv=1`, "musikquiz-tv", "popup=yes,width=1600,height=1000");
      if (tvWindow) tvWindow.focus();
    };
  return <div className="host-session-panel"><div className="eyebrow">TV-LÄGE</div><p className="muted">Öppna TV-fönstret för rumskod och QR-kod.</p><button className="button button--primary button--wide tv-open-button" onClick={openTvWindow}>SKICKA TILL TV ↗</button><button className="button button--outline button--wide" disabled={started} onClick={onStart}>{started ? "OMGÅNGEN ÄR STARTAD" : "STARTA OMGÅNGEN"}</button><a className="button button--outline button--wide admin-link" href="/admin">ÖPPNA ADMINVY</a></div>;
}

function AdminView({ bank, onBack, onLogout }: { bank: QuestionBankPanelProps; onBack: () => void; onLogout: () => void }) {
  return <main className="shell shell--admin"><header className="topbar"><div className="brand"><span className="brand__mark">✦</span><span>VÄRLDENS TONER</span></div><div className="admin-nav"><button className="ghost" onClick={onBack}>Spelledarvy</button><button className="ghost" onClick={onLogout}>Logga ut</button></div></header><section className="admin-content"><div className="eyebrow">ADMINVY</div><h1>Frågebank</h1><p className="muted">Skapa frågor med plats och Spotifylänk. Välj sedan vilka som ska användas i nästa omgång.</p><QuestionBankPanel {...bank} showMap /></section></main>;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("");
  const submit = async () => {
    setStatus("...");
    const result = creating
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (result.error) { setStatus(result.error.message); return; }
    if (result.data.session?.user) onAuthenticated(result.data.session.user);
    else setStatus("Kontrollera din e-post för att bekräfta kontot och logga sedan in.");
  };
  return <main className="shell shell--auth"><section className="auth-card"><div className="brand"><span className="brand__mark">✦</span><span>VÄRLDENS TONER</span></div><div className="eyebrow">SPELLEDARINLOGGNING</div><h1>{creating ? "Skapa ditt konto" : "Logga in som spelledare"}</h1><p className="muted">Dina frågor och kartplatser sparas privat till ditt konto.</p><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="E-post" type="email" autoComplete="email" /><input value={password} onChange={e=>setPassword(e.target.value)} placeholder="Lösenord" type="password" autoComplete={creating ? "new-password" : "current-password"} onKeyDown={e=>e.key === "Enter" && void submit()} /><button className="button button--primary button--wide" disabled={!email.trim() || password.length < 6} onClick={()=>void submit()}>{creating ? "SKAPA KONTO" : "LOGGA IN"}</button>{status && <small className="auth-status">{status}</small>}<button className="ghost auth-toggle" onClick={()=>{setCreating(value=>!value);setStatus("");}}>{creating ? "Jag har redan ett konto" : "Skapa nytt konto"}</button></section></main>;
}

function TvView({ roomCode, round, prompt, started, reveal, players, answer }: { roomCode: string; round: number; prompt: string; started: boolean; reveal: number; players: Guess[]; answer: { x: number; y: number } }) {
  const qrRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (started || !qrRef.current || !roomCode) return;
    void import("qrcode").then(QRCode => { if (qrRef.current) void QRCode.toCanvas(qrRef.current, `${window.location.origin}/?room=${encodeURIComponent(roomCode)}`, { width: 260, margin: 2, color: { dark: "#081218", light: "#e6e6c4" } }); });
  }, [roomCode, started]);
  const sortedPlayers = [...players].sort((a, b) => distanceKm(a, answer) - distanceKm(b, answer));
  if (!started) return <main className="tv-shell"><header className="tv-header"><div className="brand"><span className="brand__mark">✦</span><span>VÄRLDENS TONER</span></div><div className="tv-round">VÄNTAR PÅ START</div></header><section className="tv-lobby"><div className="eyebrow">ANSLUT TILL OMGÅNGEN</div><h1>Skanna för att delta</h1><canvas ref={qrRef} aria-label={`QR-kod för rum ${roomCode}`} /><div className="tv-room-code">{roomCode}</div><p>eller skriv in rumskoden på mobilen</p><strong>Spelledaren startar omgång {String(round).padStart(2, "0")} när alla är redo.</strong></section></main>;
  return <main className="tv-shell"><header className="tv-header"><div className="brand"><span className="brand__mark">✦</span><span>VÄRLDENS TONER</span></div><div className="tv-round">OMGÅNG {String(round).padStart(2, "0")}</div></header><section className="tv-content"><div className="tv-question">{prompt}</div><div className="tv-grid"><div className="tv-map"><Map reveal={reveal} guesses={players} answer={answer} showAnswer={reveal >= 2} /></div><aside className="tv-scoreboard"><div className="eyebrow">STÄLLNING</div>{sortedPlayers.length ? sortedPlayers.map((player, index) => <div className={`tv-score-row ${index === 0 && reveal >= 3 ? "tv-score-row--winner" : ""}`} key={player.name}><strong>{String(index + 1).padStart(2, "0")}</strong><i style={{ background: player.color }} /><span>{player.name}</span>{reveal >= 3 && <b>{distanceKm(player, answer).toLocaleString("sv-SE")} km</b>}</div>) : <p className="tv-empty">Väntar på spelare…</p>}</aside></div></section></main>;
}

export default function Home() {
  const [mode, setMode] = useState<AppMode>(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("room") ? "player" : typeof window !== "undefined" && new URLSearchParams(window.location.search).has("tv") ? "tv" : typeof window !== "undefined" && window.location.pathname === "/admin" ? "admin" : "host");
  const [reveal, setReveal] = useState(0);
  const [round, setRound] = useState(1);
  const [started, setStarted] = useState(false);
  const [picked, setPicked] = useState({ x: 45, y: 46 });
  const [locked, setLocked] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [joined, setJoined] = useState(false);
  const [roomCodeInput, setRoomCodeInput] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("room") ?? "");
  const [scanOpen, setScanOpen] = useState(false);
  const [scanError, setScanError] = useState("");
  const [players, setPlayers] = useState<Guess[]>(initialPlayers);
  const [connectionStatus, setConnectionStatus] = useState("ANSLUTER");
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [questionPrompt, setQuestionPrompt] = useState("");
  const [questionPlaceQuery, setQuestionPlaceQuery] = useState("");
  const [questionPoint, setQuestionPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [questionSpotifyUrl, setQuestionSpotifyUrl] = useState("");
  const [spotifyPreview, setSpotifyPreview] = useState<{ title: string; artist: string } | null>(null);
  const [questionStatus, setQuestionStatus] = useState("");
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [activeQuestions, setActiveQuestions] = useState<QuizQuestion[]>([]);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [broadcastPrompt, setBroadcastPrompt] = useState("Var i världen?");
  const sessionId = useState(() => typeof crypto === "undefined" ? Math.random().toString(36).slice(2) : crypto.randomUUID())[0];
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const scanVideoRef = useRef<HTMLVideoElement>(null);
  const qrScannerRef = useRef<QrScanner | null>(null);
  const [roomCode, setRoomCode] = useState(() => {
    if (typeof window === "undefined") return generateRoomCode();
    return normalizeRoomCode(new URLSearchParams(window.location.search).get("room") ?? generateRoomCode());
  });
  const ready = players.length;
  const [answer, setAnswer] = useState(defaultAnswer);
  const [answerLabel, setAnswerLabel] = useState("Välj facitplats");
  const [answerQuery, setAnswerQuery] = useState("");
  const [answerEditing, setAnswerEditing] = useState(false);
  const [answerStatus, setAnswerStatus] = useState("");
  const sorted = useMemo(() => [...players].sort((a, b) => distanceKm(a, answer) - distanceKm(b, answer)), [players, answer]);
  const pickedLngLat = toLngLat(picked);
  const activePrompt = activeQuestions[activeQuestionIndex]?.prompt ?? "Var i världen?";
  const roomStateRef = useRef({ roomCode, round, reveal, started, players, answer, prompt: activePrompt });

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
    let active = true;
    void supabase.auth.getSession().then(({ data }) => { if (active) { setUser(data.session?.user ?? null); setAuthReady(true); } });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { setUser(session?.user ?? null); setAuthReady(true); });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!['host', 'admin'].includes(mode) || !user) return;
    void supabase.from("quiz_questions").select("id,prompt,place_label,latitude,longitude,spotify_url,spotify_title,spotify_artist").order("created_at", { ascending: false }).then(({ data, error }) => {
      if (error || !data) return;
      const loaded = data as QuizQuestion[];
      setQuestions(loaded);
      if (mode === "host" && loaded.length && !activeQuestions.length) {
        let selected = loaded;
        try {
          const stored = JSON.parse(window.localStorage.getItem(activeQuestionsStorageKey) ?? "[]") as QuizQuestion[];
          const storedSelection = Array.isArray(stored) ? stored.filter(question => loaded.some(candidate => candidate.id === question.id)) : [];
          if (storedSelection.length) selected = storedSelection;
        } catch {
          // Use the loaded question list when no local selection is available.
        }
        setActiveQuestions(selected);
        setSelectedQuestionIds(selected.map(question => question.id));
        const first = selected[0];
        if (first) {
          setAnswer(toPercent(first.longitude, first.latitude));
          setAnswerLabel(first.place_label);
          setAnswerQuery(first.place_label);
        }
      }
    });
  }, [mode, user, activeQuestions.length]);

  useEffect(() => {
    if (mode !== "host" || !questions.length) return;
    try {
      const stored = JSON.parse(window.localStorage.getItem(activeQuestionsStorageKey) ?? "[]") as QuizQuestion[];
      if (!Array.isArray(stored) || !stored.length) return;
      const selected = stored.filter(question => questions.some(candidate => candidate.id === question.id));
      if (!selected.length) return;
      setActiveQuestions(selected);
      setSelectedQuestionIds(selected.map(question => question.id));
      const first = selected[0];
      setAnswer(toPercent(first.longitude, first.latitude));
      setAnswerLabel(first.place_label);
      setAnswerQuery(first.place_label);
    } catch {
      // Ignore malformed local question selections.
    }
  }, [mode, questions]);

  useEffect(() => {
    const match = questionSpotifyUrl.match(/open\.spotify\.com\/(?:intl-[^/]+\/)?track\/([A-Za-z0-9]+)/);
    if (!match) { window.setTimeout(() => setSpotifyPreview(null), 0); return; }
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(questionSpotifyUrl.trim())}`);
          if (!response.ok) throw new Error("preview");
          const data = await response.json() as { title?: string; author_name?: string };
          let artist = data.author_name?.trim() || "";
          if (!artist || artist.toLowerCase() === "spotify" || artist.toLowerCase() === "okänd artist") {
            const itunesResponse = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(data.title ?? "")}&entity=song&limit=1`);
            if (itunesResponse.ok) {
              const itunes = await itunesResponse.json() as { results?: Array<{ artistName?: string }> };
              artist = itunes.results?.[0]?.artistName?.trim() || "";
            }
          }
          setSpotifyPreview({ title: data.title ?? "Okänd låt", artist: artist || "Okänd artist" });
        } catch { setSpotifyPreview(null); }
      })();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [questionSpotifyUrl]);

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
    roomStateRef.current = { roomCode, round, reveal, started, players, answer, prompt: activePrompt };
  }, [roomCode, round, reveal, started, players, answer, activePrompt]);

  useEffect(() => {
    const channel = supabase
      .channel(roomChannelName)
      .on("broadcast", { event: "room_request" }, () => {
        if (mode !== "host") return;
        void channel.send({ type: "broadcast", event: "room_state", payload: { ...roomStateRef.current, source: "host" } });
      })
      .on("broadcast", { event: "room_state" }, ({ payload }) => {
        if (mode === "host" || payload?.source !== "host") return;
        if (typeof payload.roomCode === "string") setRoomCode(normalizeRoomCode(payload.roomCode));
        if (Array.isArray(payload.players)) setPlayers(payload.players as Guess[]);
        if (typeof payload.round === "number") setRound(payload.round);
        if (typeof payload.reveal === "number") setReveal(payload.reveal);
        if (typeof payload.started === "boolean") setStarted(payload.started);
        if (typeof payload.prompt === "string") setBroadcastPrompt(payload.prompt);
        if (payload.answer && typeof payload.answer.x === "number" && typeof payload.answer.y === "number") setAnswer(payload.answer as { x: number; y: number });
      })
      .on("broadcast", { event: "active_questions" }, ({ payload }) => {
        if (mode !== "host" || !Array.isArray(payload?.questions)) return;
        const selected = payload.questions as QuizQuestion[];
        setActiveQuestions(selected);
        setSelectedQuestionIds(selected.map(question => question.id));
        const first = selected[0];
        if (first) {
          setAnswer(toPercent(first.longitude, first.latitude));
          setAnswerLabel(first.place_label);
          setAnswerQuery(first.place_label);
        }
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
          if (mode === "player" || mode === "tv") void channel.send({ type: "broadcast", event: "room_request", payload: { sessionId } });
          else if (mode === "host") void channel.send({ type: "broadcast", event: "room_state", payload: { ...roomStateRef.current, source: "host" } });
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
    void channelRef.current.send({ type: "broadcast", event: "room_state", payload: { roomCode, round, reveal, started, players, answer, prompt: activePrompt, source: "host" } });
  }, [mode, roomCode, round, reveal, started, players, answer, activePrompt]);

  const findAnswerPlace = async () => {
    const query = answerQuery.trim();
    if (!query) return;
    setAnswerStatus("SÖKER...");
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=sv&q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error("search failed");
      const results = await response.json() as Array<{ lat: string; lon: string }>;
      const result = results[0];
      if (!result) {
        setAnswerStatus("HITTADE INTE PLATSEN");
        return;
      }
      setAnswer(toPercent(Number(result.lon), Number(result.lat)));
      setAnswerLabel(query);
      setAnswerStatus("FACIT UPPDATERAT");
      setAnswerEditing(false);
    } catch {
      setAnswerStatus("SÖKNINGEN MISSLYCKADES");
    }
  };

  const findQuestionPlace = async () => {
    const query = questionPlaceQuery.trim();
    if (!query) return;
    setQuestionStatus("SÖKER PLATS...");
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=sv&q=${encodeURIComponent(query)}`);
      const results = await response.json() as Array<{ lat: string; lon: string; display_name?: string }>;
      const result = results[0];
      if (!result) { setQuestionStatus("HITTADE INTE PLATSEN"); return; }
      setQuestionPoint({ latitude: Number(result.lat), longitude: Number(result.lon) });
      setQuestionStatus("PLATS VALD");
    } catch { setQuestionStatus("PLATSSÖKNINGEN MISSLYCKADES"); }
  };

  const saveQuestion = async () => {
    if (!questionPrompt.trim() || !questionPoint || !questionSpotifyUrl.trim()) return;
    setQuestionStatus("SPARAR...");
    const { data: sessionData } = await supabase.auth.getSession();
    let currentSession = sessionData.session;
    if (!currentSession) {
      const refreshed = await supabase.auth.refreshSession();
      currentSession = refreshed.data.session;
    }
    const currentUser = currentSession?.user;
    if (!currentUser) { setQuestionStatus("KUNDE INTE SPARA: LOGGA IN IGEN"); return; }
    const spotifyTrackId = questionSpotifyUrl.match(/open\.spotify\.com\/(?:intl-[^/]+\/)?track\/([A-Za-z0-9]+)/)?.[1] ?? null;
    const { error } = await supabase.from("quiz_questions").insert({ owner_id: currentUser.id, prompt: questionPrompt.trim(), place_label: questionPlaceQuery.trim(), latitude: questionPoint.latitude, longitude: questionPoint.longitude, spotify_url: questionSpotifyUrl.trim(), spotify_track_id: spotifyTrackId, spotify_title: spotifyPreview?.title ?? null, spotify_artist: spotifyPreview?.artist ?? null });
    if (error) { setQuestionStatus(`KUNDE INTE SPARA: ${error.message}`); return; }
    const { data: refreshed } = await supabase.from("quiz_questions").select("id,prompt,place_label,latitude,longitude,spotify_url,spotify_title,spotify_artist").order("created_at", { ascending: false });
    if (refreshed) setQuestions(refreshed as QuizQuestion[]);
    setQuestionPrompt(""); setQuestionPlaceQuery(""); setQuestionPoint(null); setQuestionSpotifyUrl(""); setSpotifyPreview(null); setQuestionStatus("FRÅGAN SPARAD");
  };

  const useSelectedQuestions = () => {
    const chosen = selectedQuestionIds.map(id => questions.find(question => question.id === id)).filter((question): question is QuizQuestion => Boolean(question));
    if (!chosen.length) return;
    window.localStorage.setItem(activeQuestionsStorageKey, JSON.stringify(chosen));
    void channelRef.current?.send({ type: "broadcast", event: "active_questions", payload: { questions: chosen } });
    setActiveQuestions(chosen); setActiveQuestionIndex(0); setRound(1); setReveal(0); setPlayers([]); setLocked(false);
    const first = chosen[0]; setAnswer(toPercent(first.longitude, first.latitude)); setAnswerLabel(first.place_label); setAnswerQuery(first.place_label);
  };

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
    const nextIndex = activeQuestionIndex + 1;
    const nextQuestion = activeQuestions[nextIndex];
    if (nextQuestion) { setActiveQuestionIndex(nextIndex); setAnswer(toPercent(nextQuestion.longitude, nextQuestion.latitude)); setAnswerLabel(nextQuestion.place_label); setAnswerQuery(nextQuestion.place_label); }
    setRoomCode(generateRoomCode());
    setStarted(false);
    setRound(current => current + 1);
    setReveal(0);
    setLocked(false);
    setPlayers(current => current.map(player => ({ ...player, x: 45, y: 46 })));
  };

  const bankProps: QuestionBankPanelProps = { questions, prompt: questionPrompt, setPrompt: setQuestionPrompt, place: questionPlaceQuery, setPlace: setQuestionPlaceQuery, spotifyUrl: questionSpotifyUrl, setSpotifyUrl: setQuestionSpotifyUrl, point: questionPoint, setPoint: setQuestionPoint, preview: spotifyPreview, status: questionStatus, selectedIds: selectedQuestionIds, setSelectedIds: setSelectedQuestionIds, findPlace: () => void findQuestionPlace(), save: () => void saveQuestion(), useSelected: useSelectedQuestions };

  if (mode !== "player" && mode !== "tv" && !authReady) return <main className="shell shell--auth"><section className="auth-card"><div className="brand"><span className="brand__mark">✦</span><span>VÄRLDENS TONER</span></div><p className="muted">Laddar spelledarpanelen...</p></section></main>;
  if (mode !== "player" && mode !== "tv" && !user) return <AuthScreen onAuthenticated={setUser} />;
  if (mode === "admin") return <AdminView bank={bankProps} onBack={()=>{ window.history.replaceState(null, "", "/"); setMode("host"); }} onLogout={()=>void supabase.auth.signOut()} />;
  if (mode === "tv") return <TvView roomCode={roomCode} round={round} prompt={broadcastPrompt} started={started} reveal={reveal} players={players} answer={answer} />;
  if (mode === "player") return <main className="shell shell--player"><header className="topbar"><div className="brand"><span className="brand__mark">✦</span><span>VÄRLDENS TONER</span></div><button className="ghost" onClick={() => setMode("host")}>Spelledarvy</button></header><section className="player-card">
    {!joined ? <><div className="eyebrow">DU ÄR INBJUDEN TILL RUMMET</div><h1>Sätt din nål.<br/><em>Hitta rätt plats.</em></h1><p className="muted">Skanna QR-koden från spelledaren eller fyll i rumskoden.</p><input value={roomCodeInput} onChange={e=>setRoomCodeInput(e.target.value)} placeholder="Rumskod" autoFocus /><button className="button button--secondary button--wide" onClick={() => setScanOpen(true)}>SKANNA QR-KOD <span>⌁</span></button><input value={playerName} onChange={e=>setPlayerName(e.target.value)} onKeyDown={e=>e.key === "Enter" && joinRoom()} placeholder="Ditt namn" /><button className="button button--primary button--wide" disabled={!playerName.trim() || normalizeRoomCode(roomCodeInput) !== normalizeRoomCode(roomCode)} onClick={joinRoom}>ANSLUT TILL RUMMET <span>→</span></button><div className="room-pill">RUMSKODEN ÄR ENDAST <strong>{roomCode}</strong></div>{scanOpen && <div className="scan-modal" role="dialog" aria-modal="true" aria-label="Skanna QR-kod"><div className="scan-modal__card"><div className="eyebrow">SKANNA FÖR ATT ANSLUTA</div><h2>Rikta kameran mot QR-koden</h2><video ref={scanVideoRef} muted playsInline />{scanError && <p className="scan-error">{scanError}</p>}<div className="scan-modal__actions"><button className="button button--outline" onClick={() => setScanOpen(false)}>AVBRYT</button></div></div></div>}</> : <><div className="player-status"><span className="live-dot"/> ANSLUTEN SOM <strong>{playerName.toUpperCase()}</strong><span className="round-tag">OMGÅNG {String(round).padStart(2, "0")}</span></div><h2>Var i världen hörde du<br/>den här låten?</h2><p className="muted">Tryck på kartan för att placera din gissning.</p><Map reveal={reveal} guesses={players} answer={answer} selected={picked} compact onPick={(x,y)=>!locked&&setPicked({x,y})}/><div className="player-actions"><div className="guess-readout"><span className="pin-dot"/> DIN GISSNING <strong>{Math.round(pickedLngLat[1])}°N, {Math.round(pickedLngLat[0])}°E</strong></div><button className={`button ${locked ? "button--locked" : "button--primary"}`} disabled={locked || reveal > 0} onClick={lockGuess}>{locked ? "SVAR LÅST ✓" : reveal > 0 ? "OMGÅNGEN ÄR LÅST" : "LÅS SVAR"}</button></div></>}
  </section></main>;

  return <main className="shell"><header className="topbar"><div className="brand"><span className="brand__mark">✦</span><span>VÄRLDENS TONER</span></div><div className="topbar__center"><span className="live-dot"/> LIVEKVÄLL <span className="divider"/> RUM <strong>{roomCode}</strong></div><button className="ghost" onClick={()=>setMode("player")}>Spelarvy ↗</button></header><div className="host-layout"><aside className="sidebar"><div className="eyebrow">SPELLEDARPANEL</div><div className="round-card"><span>NÄSTA OMGÅNG</span><strong>{String(round).padStart(2,"0")}</strong><small>av 10</small></div><div className="progress"><span style={{width:`${Math.min(round*10, 100)}%`}}/></div><div className="players-list"><div className="eyebrow">SPELARE <strong>{ready} ANSLUTNA</strong></div>{players.length ? players.map(p=><div className="player-row" key={p.name}><i style={{background:p.color}}/><span>{p.name}</span><b>KLAR</b></div>) : <small className="players-empty">Inga spelare anslutna ännu</small>}</div><HostSessionPanel started={started} onStart={()=>setStarted(true)} /></aside><section className="stage"><div className="stage-head"><div><div className="eyebrow">KARTA · OMGÅNG {String(round).padStart(2,"0")}</div><h2>{activePrompt}</h2></div><div className="phase"><span className="phase-dot"/> {started ? reveal === 0 ? "SVAR SAMLAS IN" : reveal === 1 ? "GISSNINGAR VISAS" : reveal === 2 ? "FACIT VISAS" : "RESULTAT" : "VÄNTAR PÅ START"}</div></div><Map reveal={reveal} guesses={players} answer={answer} showAnswer/><div className="reveal-controls"><button className="button button--outline" disabled={!started || reveal < 1} onClick={()=>setReveal(0)}>↺ Återställ</button><button className={`button ${reveal >= 1 ? "button--done" : "button--primary"}`} disabled={!started} onClick={()=>setReveal(1)}>{reveal >= 1 ? "GISSNINGAR VISAS ✓" : "VISA SPELARNAS PLATSER"}</button><button className={`button ${reveal >= 2 ? "button--done" : "button--primary"}`} disabled={!started || reveal < 1} onClick={()=>setReveal(2)}>{reveal >= 2 ? "RÄTT PLATS VISAS ✓" : "VISA RÄTT PLATS"}</button><button className={`button ${reveal >= 3 ? "button--done" : "button--accent"}`} disabled={!started || reveal < 2} onClick={()=>setReveal(3)}>{reveal >= 3 ? "AVSTÅND VISAS ✓" : "VISA AVSTÅND"}</button></div>{reveal >= 3 && <div className="results"><div className="results-head"><div><div className="eyebrow">OMGÅNGSRESULTAT</div><h3>Närmast rätt plats</h3></div><button className="button button--primary" onClick={nextRound}>NÄSTA OMGÅNG →</button></div><div className="result-grid">{sorted.map((p,i)=><div className={`result-row ${i===0?"result-row--winner":""}`} key={p.name}><strong>{String(i+1).padStart(2,"0")}</strong><i style={{background:p.color}}/><span>{p.name}{i===0&&<small> ★ VINNARE</small>}</span><b>{distanceKm(p, answer).toLocaleString("sv-SE")} km</b></div>)}</div></div>}</section></div></main>;
}
