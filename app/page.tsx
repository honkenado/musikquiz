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

type Guess = { name: string; color: string; x: number; y: number; score?: number; locked?: boolean; followupAnswer?: string; followupLocked?: boolean; followupAwarded?: boolean };
type QuizQuestion = { id: string; prompt: string; place_label: string; latitude: number; longitude: number; content_type: "music" | "sport" | "image" | "other"; image_url: string | null; spotify_url: string; spotify_title: string | null; spotify_artist: string | null };
type FollowUpQuestion = { id: string; owner_id: string; parent_question_id: string; prompt: string; answer_type: "text" | "yes_no" | "choice"; image_url: string | null; spotify_url: string; spotify_title: string | null; spotify_artist: string | null; points: number; sort_order: number };
type QuizOrderItem = { type: "question"; id: string } | { type: "category"; id: string; title: string };
type QuestionBankPanelProps = { questions: QuizQuestion[]; followups: FollowUpQuestion[]; prompt: string; setPrompt: (value: string) => void; place: string; setPlace: (value: string) => void; contentType: QuizQuestion["content_type"]; setContentType: (value: QuizQuestion["content_type"]) => void; imageUrl: string; setImageUrl: (value: string) => void; spotifyUrl: string; setSpotifyUrl: (value: string) => void; followupParentId: string; setFollowupParentId: (value: string) => void; followupPrompt: string; setFollowupPrompt: (value: string) => void; followupImageUrl: string; setFollowupImageUrl: (value: string) => void; followupSpotifyUrl: string; setFollowupSpotifyUrl: (value: string) => void; followupPoints: string; setFollowupPoints: (value: string) => void; followupStatus: string; saveFollowup: () => void; point: { latitude: number; longitude: number } | null; setPoint: (value: { latitude: number; longitude: number } | null) => void; preview: { title: string; artist: string } | null; status: string; selectedIds: string[]; setSelectedIds: Dispatch<SetStateAction<string[]>>; orderItems: QuizOrderItem[]; setOrderItems: Dispatch<SetStateAction<QuizOrderItem[]>>; findPlace: () => void; save: () => void; useSelected: () => void; showMap?: boolean };
type AppMode = "host" | "player" | "admin" | "tv";
type RouteData = { type: "FeatureCollection"; features: Array<{ type: "Feature"; geometry: { type: "LineString"; coordinates: Array<[number, number]> }; properties: Record<string, never> }> };
type MapRef = { current: maplibregl.Map | null };
const playerColors = ["#ff6b4a", "#64d7ff", "#f5c451", "#b995ff", "#72e4ad", "#ff9ee8", "#8fb8ff", "#ffb86b"];
const initialPlayers: Guess[] = [];
const roomChannelName = "musikquiz-room-nord-7k";
const normalizeRoomCode = (value: string) => value.replace(/\s+/g, "").toUpperCase();
const activeQuestionsStorageKey = "musikquiz-active-questions";
const activeQuizOrderStorageKey = "musikquiz-quiz-order";
const spotifyClientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID ?? "989f0e0f03a84ec68946b5fbd43dcef1";
const spotifyTokenStorageKey = "musikquiz-spotify-token";
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
const pointsForRank = (playerCount: number, rank: number) => {
  if (rank === 0 && playerCount <= 2) return 1;
  if (playerCount === 3) return rank === 0 ? 3 : rank === 1 ? 1 : 0;
  if (playerCount >= 4) return rank === 0 ? 3 : rank === 1 ? 2 : rank === 2 ? 1 : 0;
  return 0;
};
const spotifyTrackIdFromUrl = (url: string) => url.match(/open\.spotify\.com\/(?:intl-[^/]+\/)?track\/([A-Za-z0-9]+)/)?.[1] ?? null;
const spotifyTrackUri = (url: string) => {
  const id = spotifyTrackIdFromUrl(url);
  return id ? `spotify:track:${id}` : null;
};
const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
type SpotifyToken = { accessToken?: string; refreshToken?: string; expiresAt?: number };
const readSpotifyToken = (): SpotifyToken | null => {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(spotifyTokenStorageKey) ?? window.sessionStorage.getItem(spotifyTokenStorageKey);
  if (!stored) return null;
  try { return JSON.parse(stored) as SpotifyToken; } catch { return null; }
};
const storeSpotifyToken = (token: SpotifyToken) => {
  window.localStorage.setItem(spotifyTokenStorageKey, JSON.stringify(token));
  window.sessionStorage.setItem(spotifyTokenStorageKey, JSON.stringify(token));
};
const refreshSpotifyAccessToken = async (): Promise<string | null> => {
  const token = readSpotifyToken();
  if (!token) return null;
  if (token.accessToken && (token.expiresAt ?? 0) > Date.now() + 60_000) return token.accessToken;
  if (!token.refreshToken || !spotifyClientId) return null;
  const response = await fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: spotifyClientId, grant_type: "refresh_token", refresh_token: token.refreshToken }) });
  const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!response.ok || !data.access_token) return null;
  storeSpotifyToken({ accessToken: data.access_token, refreshToken: data.refresh_token ?? token.refreshToken, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
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
    {mapReady && reveal >= 2 && guesses.map(guess => <OverlayMarker key={guess.name} mapRef={mapRef} point={guess} className="map-pin--player" label={guess.name} color={guess.color} />)}
    {mapReady && (showAnswer || reveal >= 1) && <OverlayMarker mapRef={mapRef} point={answer} className="map-pin--answer" label="FACIT" />}
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

function QuestionBankPanel({ questions, followups, prompt, setPrompt, setPlace, place, contentType, setContentType, imageUrl, setImageUrl, spotifyUrl, setSpotifyUrl, followupParentId, setFollowupParentId, followupPrompt, setFollowupPrompt, followupImageUrl, setFollowupImageUrl, followupSpotifyUrl, setFollowupSpotifyUrl, followupPoints, setFollowupPoints, followupStatus, saveFollowup, point, setPoint, preview, status, selectedIds, setSelectedIds, orderItems, setOrderItems, findPlace, save, useSelected, showMap = false }: QuestionBankPanelProps) {
  const allSelected = questions.length > 0 && selectedIds.length === questions.length;
  const orderedItems = orderItems.filter(item => item.type === "category" || selectedIds.includes(item.id));
  const orderedSelectedQuestions = orderedItems.filter((item): item is Extract<QuizOrderItem, { type: "question" }> => item.type === "question").map(item => questions.find(question => question.id === item.id)).filter((question): question is QuizQuestion => Boolean(question));
  const orderedSelectedFollowups = orderedSelectedQuestions.flatMap(question => followups.filter(followup => followup.parent_question_id === question.id).sort((a, b) => a.sort_order - b.sort_order));
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [categoryTitle, setCategoryTitle] = useState("");
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [playlistStatus, setPlaylistStatus] = useState("");
  const [playlistUrl, setPlaylistUrl] = useState("");
  useEffect(() => {
    setOrderItems(current => {
      const kept = current.filter(item => item.type === "category" || selectedIds.includes(item.id));
      const existingQuestionIds = new Set(kept.filter(item => item.type === "question").map(item => item.id));
      return [...kept, ...selectedIds.filter(id => !existingQuestionIds.has(id)).map(id => ({ type: "question" as const, id }))];
    });
  }, [selectedIds, setOrderItems]);
  const toggleAll = () => setSelectedIds(allSelected ? [] : questions.map(question => question.id));
  const toggleQuestion = (id: string, checked: boolean) => {
    setSelectedIds(current => checked ? [...current, id] : current.filter(selectedId => selectedId !== id));
  };
  const addCategory = () => {
    const title = categoryTitle.trim();
    if (!title) return;
    setOrderItems(current => [...current, { type: "category", id: crypto.randomUUID(), title }]);
    setCategoryTitle("");
  };
  const removeCategory = (id: string) => setOrderItems(current => current.filter(item => item.id !== id));
  useEffect(() => {
    const stored = readSpotifyToken();
    setSpotifyConnected(Boolean(stored));
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const returnedState = params.get("state");
    if (!code) {
      if (params.get("spotify") === "connect") void connectSpotify();
      return;
    }
    if (!returnedState || returnedState !== window.sessionStorage.getItem("musikquiz-spotify-state")) {
      setPlaylistStatus("Spotify-inloggningen kunde inte verifieras.");
      return;
    }
    const verifier = window.sessionStorage.getItem("musikquiz-spotify-verifier");
    if (!verifier || !spotifyClientId) return;
    void fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: spotifyClientId, grant_type: "authorization_code", code, redirect_uri: window.location.href.split("?")[0], code_verifier: verifier }),
    }).then(async response => {
      const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!response.ok || !data.access_token) throw new Error("Spotify kunde inte godkänna anslutningen.");
      storeSpotifyToken({ accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 });
      setSpotifyConnected(true);
      setPlaylistStatus("Spotify är anslutet. Klicka på knappen igen för att skapa spellistan.");
      window.history.replaceState(null, "", window.location.pathname);
    }).catch(error => setPlaylistStatus(error instanceof Error ? error.message : "Spotify-inloggningen misslyckades."));
  }, []);

  const connectSpotify = async () => {
    if (!spotifyClientId) { setPlaylistStatus("Spotify behöver konfigureras med ett Spotify Client ID först."); return; }
    const verifierBytes = crypto.getRandomValues(new Uint8Array(64));
    const verifier = toBase64Url(verifierBytes);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = toBase64Url(new Uint8Array(digest));
    const state = toBase64Url(crypto.getRandomValues(new Uint8Array(24)));
    const redirectUri = window.location.href.split("?")[0];
    window.sessionStorage.setItem("musikquiz-spotify-verifier", verifier);
    window.sessionStorage.setItem("musikquiz-spotify-state", state);
    const params = new URLSearchParams({ response_type: "code", client_id: spotifyClientId, scope: "playlist-modify-private playlist-read-private playlist-read-collaborative user-read-playback-state user-modify-playback-state", redirect_uri: redirectUri, state, show_dialog: "true", code_challenge_method: "S256", code_challenge: challenge });
    window.location.assign(`https://accounts.spotify.com/authorize?${params.toString()}`);
  };

  const getSpotifyAccessToken = async () => {
    return refreshSpotifyAccessToken();
  };

  const createSpotifyPlaylist = async () => {
    if (!orderedSelectedQuestions.length) return;
    if (!spotifyConnected) { await connectSpotify(); return; }
    const uris = [...orderedSelectedQuestions.map(question => question.spotify_url), ...orderedSelectedFollowups.map(followup => followup.spotify_url)].map(spotifyTrackUri).filter((uri): uri is string => Boolean(uri));
    if (!uris.length) { setPlaylistStatus("De valda frågorna och följdfrågorna saknar giltiga Spotifylåtar."); return; }
    setPlaylistStatus("SKAPAR SPELLISTA...");
    try {
      const accessToken = await getSpotifyAccessToken();
      if (!accessToken) { setSpotifyConnected(false); setPlaylistStatus("Spotifyanslutningen har gått ut. Klicka för att ansluta igen."); return; }
      const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
      const playlistResponse = await fetch("https://api.spotify.com/v1/me/playlists", { method: "POST", headers, body: JSON.stringify({ name: `Världens toner – ${new Date().toLocaleDateString("sv-SE")}`, public: false, collaborative: false, description: "Skapad från Världens toner" }) });
      const playlist = await playlistResponse.json() as { id?: string; external_urls?: { spotify?: string }; error?: { message?: string } };
      if (!playlistResponse.ok || !playlist.id) throw new Error(playlist.error?.message ?? "Kunde inte skapa spellistan.");
      const tracksResponse = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/items`, { method: "POST", headers, body: JSON.stringify({ uris }) });
      if (!tracksResponse.ok) { const error = await tracksResponse.json() as { error?: { message?: string } }; throw new Error(error.error?.message ?? "Kunde inte lägga till låtarna."); }
      setPlaylistUrl(playlist.external_urls?.spotify ?? `https://open.spotify.com/playlist/${playlist.id}`);
      setPlaylistStatus(`${uris.length} låtar lades till i Spotify.`);
    } catch (error) { setPlaylistStatus(error instanceof Error ? error.message : "Kunde inte skapa Spotify-spellistan."); }
  };

  const moveQuestion = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setOrderItems(current => { const next = [...current]; const sourceIndex = next.findIndex(item => item.id === sourceId); const targetIndex = next.findIndex(item => item.id === targetId); if (sourceIndex < 0 || targetIndex < 0) return current; const [moved] = next.splice(sourceIndex, 1); next.splice(targetIndex, 0, moved); return next; });
  };
  const contentTypeLabel = (value: QuizQuestion["content_type"]) => ({ music: "Musik", sport: "Sport", image: "Bild", other: "Annat" })[value];
  const followupPanel = <div className="followup-editor"><div className="eyebrow">FÖLJDFRÅGOR</div><strong>Koppla en följdfråga till en plats</strong><p className="muted">Följdfrågan följer med huvudfrågan i quizordningen och kan ha en egen låt.</p><select value={followupParentId} onChange={event => setFollowupParentId(event.target.value)}><option value="">Välj geografifråga</option>{questions.map(question => <option key={question.id} value={question.id}>{question.place_label} · {question.prompt}</option>)}</select><input value={followupPrompt} onChange={event => setFollowupPrompt(event.target.value)} placeholder="Skriv följdfrågan" /><div className="followup-fields"><input value={followupPoints} onChange={event => setFollowupPoints(event.target.value)} type="number" min="0" max="10" placeholder="Poäng" /><input value={followupImageUrl} onChange={event => setFollowupImageUrl(event.target.value)} placeholder="Bildlänk (valfritt)" type="url" /></div><input value={followupSpotifyUrl} onChange={event => setFollowupSpotifyUrl(event.target.value)} placeholder="Spotifylänk (valfritt)" /><button className="button button--secondary button--wide" disabled={!followupParentId || !followupPrompt.trim()} onClick={saveFollowup}>SPARA FÖLJDFRÅGA</button>{followupStatus && <small>{followupStatus}</small>}<div className="followup-list">{followups.length ? followups.map(followup => <div className="followup-list__item" key={followup.id}><span><b>{questions.find(question => question.id === followup.parent_question_id)?.place_label ?? "Plats"}</b><small>{followup.prompt}</small></span><em>{followup.points} p{followup.spotify_url ? " · ♫" : ""}</em></div>) : <small>Inga följdfrågor ännu.</small>}</div></div>;
  const form = <div className="question-editor-form"><div className="eyebrow">FRÅGEBANK</div><strong>Ny geografifråga</strong><label className="field-label" htmlFor="question-content-type">INNEHÅLLSTYP</label><select id="question-content-type" value={contentType} onChange={e=>setContentType(e.target.value as QuizQuestion["content_type"])}><option value="music">Musik</option><option value="sport">Sport</option><option value="image">Bild</option><option value="other">Annat</option></select><input value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Skriv frågan" /><div className="question-place"><input value={place} onChange={e=>setPlace(e.target.value)} placeholder="Plats, t.ex. New York" /><button className="button button--secondary" onClick={findPlace}>SÖK</button></div>{contentType === "music" ? <><input value={spotifyUrl} onChange={e=>setSpotifyUrl(e.target.value)} placeholder="Klistra in Spotifylänk" />{preview && <small className="spotify-preview">♫ {preview.title} — {preview.artist}</small>}</> : <input value={imageUrl} onChange={e=>setImageUrl(e.target.value)} placeholder="Bildlänk (valfritt)" type="url" />}{point && <small>PLATS VALD ✓</small>}<button className="button button--primary button--wide" disabled={!prompt.trim() || !point || (contentType === "music" && !spotifyUrl.trim())} onClick={save}>SPARA FRÅGA</button>{status && <small>{status}</small>}<div className="question-list__toolbar"><span>{questions.length} frågor · {selectedIds.length} valda</span><button className="button button--outline" disabled={!questions.length} onClick={toggleAll}>{allSelected ? "AVMARKERA ALLA" : "VÄLJ ALLA"}</button></div><div className="question-list">{questions.length ? questions.map(question=><label className="question-list__item" key={question.id}><input type="checkbox" checked={selectedIds.includes(question.id)} onChange={event=>toggleQuestion(question.id, event.target.checked)} /><span className="question-list__text"><span className="question-list__track"><strong>{question.content_type === "music" ? question.spotify_title ?? "Spotifylåt" : question.prompt}</strong><small>{question.content_type === "music" ? question.spotify_artist ?? "Artist saknas" : contentTypeLabel(question.content_type)}</small></span><small className="question-list__prompt">{question.prompt}</small><small className="question-list__place">⌖ {question.place_label}</small></span></label>) : <small>Inga sparade frågor ännu.</small>}</div><button className="button button--outline button--wide" disabled={!selectedIds.length} onClick={useSelected}>ANVÄND VALDA I QUIZET ({selectedIds.length})</button>{followupPanel}</div>;
  if (!showMap) return <div className="question-bank">{form}</div>;
  const previewPoint = point ? toPercent(point.longitude, point.latitude) : defaultAnswer;
  const orderPanel = <div className="quiz-order-panel quiz-order-panel--external"><div className="eyebrow">QUIZORDNING</div><p className="muted">Dra geografifrågorna i den ordning de ska spelas. Följdfrågorna följer automatiskt med.</p><div className="quiz-category-form"><input value={categoryTitle} onChange={event => setCategoryTitle(event.target.value)} onKeyDown={event => event.key === "Enter" && addCategory()} placeholder="Ny kategori, t.ex. Bilar" /><button className="button button--secondary" onClick={addCategory}>LÄGG TILL</button></div><div className="quiz-order-list">{orderedItems.length ? orderedItems.map((item, index) => { const question = item.type === "question" ? questions.find(candidate => candidate.id === item.id) : null; const questionFollowups = question ? followups.filter(followup => followup.parent_question_id === question.id).sort((a, b) => a.sort_order - b.sort_order) : []; if (item.type === "question" && !question) return null; return <div className={`quiz-order-item ${item.type === "category" ? "quiz-order-item--category" : ""} ${draggedId === item.id ? "quiz-order-item--dragging" : ""}`} key={item.id} draggable onDragStart={() => setDraggedId(item.id)} onDragOver={event => event.preventDefault()} onDrop={() => { if (draggedId) moveQuestion(draggedId, item.id); setDraggedId(null); }} onDragEnd={() => setDraggedId(null)}><span className="quiz-order-handle">⠿</span><strong>{String(index + 1).padStart(2, "0")}</strong>{item.type === "category" ? <><span className="quiz-order-title"><b>▰ {item.title}</b><small>KATEGORI</small></span><button className="quiz-order-remove" onClick={event => { event.stopPropagation(); removeCategory(item.id); }} aria-label={`Ta bort kategorin ${item.title}`}>×</button></> : <span className="quiz-order-title"><b>{question?.content_type === "music" ? question?.spotify_title ?? "Spotifylåt" : question?.prompt}</b><small>{question?.content_type === "music" ? question?.spotify_artist ?? question?.place_label : `${contentTypeLabel(question?.content_type ?? "other")} · ${question?.place_label}`}{questionFollowups.length ? ` · ${questionFollowups.length} följdfrågor` : ""}</small></span>}</div>; }) : <small>Välj frågor i frågebanken eller lägg till en kategori.</small>}</div><button className="button button--primary button--wide" disabled={!orderedSelectedQuestions.length || !spotifyClientId} onClick={() => void createSpotifyPlaylist()}>{spotifyConnected ? "SKAPA SPOTIFY-SPELLISTA" : "KOPPLA SPOTIFY"}</button>{!spotifyClientId && <small className="spotify-config-note">Spotify behöver konfigureras innan spellistan kan skapas.</small>}{playlistStatus && <small className="playlist-status">{playlistStatus}</small>}{playlistUrl && <a className="playlist-link" href={playlistUrl} target="_blank" rel="noreferrer">ÖPPNA SPELLISTAN I SPOTIFY ↗</a>}</div>;
  return <><div className="question-bank question-bank--with-map"><div className="question-editor-layout">{form}<div className="question-editor-map"><div className="eyebrow">PLATSKONTROLL</div><p className="muted">Sök fram platsen eller finjustera nålen direkt på kartan.</p><Map reveal={0} guesses={[]} answer={previewPoint} showAnswer={Boolean(point)} onPick={(x, y) => { const [longitude, latitude] = toLngLat({ x, y }); setPoint({ longitude, latitude }); }} /></div></div></div>{orderPanel}</>;
}

function HostSessionPanel({ started, onStart }: { started: boolean; onStart: () => void }) {
    const openTvWindow = () => {
      const tvWindow = window.open(`${window.location.origin}/?tv=1`, "musikquiz-tv", "popup=yes,width=1600,height=1000");
      if (tvWindow) tvWindow.focus();
    };
  return <div className="host-session-panel"><div className="eyebrow">TV-LÄGE</div><p className="muted">Öppna TV-fönstret för rumskod och QR-kod.</p><button className="button button--primary button--wide tv-open-button" onClick={openTvWindow}>SKICKA TILL TV ↗</button><button className="button button--outline button--wide" disabled={started} onClick={onStart}>{started ? "QUIZET ÄR STARTAT" : "STARTA QUIZ"}</button><a className="button button--outline button--wide admin-link" href="/admin">ÖPPNA ADMINVY</a><SpotifyControlPanel /></div>;
}

  function SpotifyControlPanel() {
    const [connected, setConnected] = useState(false);
    const [track, setTrack] = useState<{ title: string; artist: string; playing: boolean; device: string } | null>(null);
    const [playlist, setPlaylist] = useState<{ id: string; name: string; url: string; tracks: Array<{ title: string; artist: string }> } | null>(null);
    const [playlistOpen, setPlaylistOpen] = useState(false);
    const [status, setStatus] = useState("");
    const playlistIdRef = useRef<string | null>(null);
    const openConnect = () => { window.location.assign("/admin?spotify=connect"); };
    const loadPlaylist = async (accessToken: string, playlistId: string) => {
      if (playlistIdRef.current === playlistId) return;
      const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) { setPlaylist(null); playlistIdRef.current = null; return; }
      const data = await response.json() as {
        id?: string;
        name?: string;
        external_urls?: { spotify?: string };
        items?: { items?: Array<{ item?: { name?: string; artists?: Array<{ name?: string }> }; track?: { name?: string; artists?: Array<{ name?: string }> } }> };
        tracks?: { items?: Array<{ track?: { name?: string; artists?: Array<{ name?: string }> } }> };
      };
      type SpotifyPlaylistTrack = { name?: string; artists?: Array<{ name?: string }> };
      const rows: Array<{ item?: SpotifyPlaylistTrack; track?: SpotifyPlaylistTrack }> = [...(data.items?.items ?? []), ...(data.tracks?.items ?? [])] as Array<{ item?: SpotifyPlaylistTrack; track?: SpotifyPlaylistTrack }>;
      const tracks = rows.map(row => row.item ?? row.track).filter(Boolean).map(item => ({
        title: item?.name ?? "Okänd låt",
        artist: item?.artists?.map(artist => artist.name).filter(Boolean).join(", ") || "Okänd artist",
      }));
      setPlaylist({ id: data.id ?? playlistId, name: data.name ?? "Spotify-spellista", url: data.external_urls?.spotify ?? `https://open.spotify.com/playlist/${playlistId}`, tracks });
      playlistIdRef.current = playlistId;
    };
    const loadPlayback = async () => {
      const accessToken = await refreshSpotifyAccessToken();
      if (!accessToken) { setConnected(false); return; }
      setConnected(true);
      const response = await fetch("https://api.spotify.com/v1/me/player", { headers: { Authorization: `Bearer ${accessToken}` } });
      if (response.status === 204) { setTrack(null); setPlaylist(null); playlistIdRef.current = null; return; }
      if (!response.ok) { setConnected(false); setStatus("Spotify behöver kopplas om med uppspelningsbehörighet."); return; }
      const data = await response.json() as { is_playing?: boolean; device?: { name?: string }; context?: { type?: string; uri?: string }; item?: { name?: string; artists?: Array<{ name?: string }> } };
      const playlistId = data.context?.type === "playlist" ? data.context.uri?.split(":").pop() : null;
      if (playlistId) await loadPlaylist(accessToken, playlistId);
      else { setPlaylist(null); playlistIdRef.current = null; }
      if (!data.item) { setTrack(null); return; }
      setTrack({ title: data.item.name ?? "Okänd låt", artist: data.item.artists?.map(artist => artist.name).filter(Boolean).join(", ") || "Okänd artist", playing: Boolean(data.is_playing), device: data.device?.name ?? "Spotify" });
  };
  useEffect(() => {
    setConnected(Boolean(readSpotifyToken()));
    void loadPlayback();
    const timer = window.setInterval(() => void loadPlayback(), 5000);
    return () => window.clearInterval(timer);
  }, []);
  const control = async (action: "play" | "pause" | "next" | "previous") => {
    const accessToken = await refreshSpotifyAccessToken();
    if (!accessToken) { setConnected(false); setStatus("Spotifyanslutningen saknas. Koppla Spotify igen."); return; }
    const method = action === "play" || action === "pause" ? "PUT" : "POST";
    const endpoint = action === "play" ? "play" : action === "pause" ? "pause" : action;
    const response = await fetch(`https://api.spotify.com/v1/me/player/${endpoint}`, { method, headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) { setStatus("Spotify kunde inte ändra uppspelningen."); return; }
    setStatus("");
    await loadPlayback();
  };
  if (!connected) return <div className="spotify-control spotify-control--disconnected"><div className="eyebrow">SPOTIFY</div><p className="muted">Styr musiken från spelledarvyn.</p><button className="button button--outline button--wide" onClick={openConnect}>KOPPLA SPOTIFY</button></div>;
    return <div className="spotify-control"><div className="eyebrow">SPOTIFY <strong>ANSLUTEN</strong></div>{track ? <><div className="spotify-control__track"><strong>{track.title}</strong><small>{track.artist}</small><small>{track.device}</small></div><div className="spotify-control__actions"><button aria-label="Föregående låt" onClick={() => void control("previous")}>◀◀</button><button aria-label={track.playing ? "Pausa" : "Spela"} onClick={() => void control(track.playing ? "pause" : "play")}>{track.playing ? "Ⅱ" : "▶"}</button><button aria-label="Nästa låt" onClick={() => void control("next")}>▶▶</button></div></> : <p className="muted">Ingen aktiv låt just nu.</p>}{playlist && <div className="spotify-control__playlist"><div className="spotify-control__playlist-head"><a href={playlist.url} target="_blank" rel="noreferrer">{playlist.name} ↗</a><button onClick={() => setPlaylistOpen(value => !value)}>{playlistOpen ? "DÖLJ" : `${playlist.tracks.length} LÅTAR`}</button></div>{playlistOpen && <div className="spotify-control__playlist-list">{playlist.tracks.map((item, index) => <div className="spotify-control__playlist-row" key={`${playlist.id}-${index}`}><strong>{String(index + 1).padStart(2, "0")}</strong><span><b>{item.title}</b><small>{item.artist}</small></span></div>)}</div>}</div>}{status && <small className="playlist-status">{status}</small>}</div>;
  }

function AdminView({ bank, onBack, onLogout }: { bank: QuestionBankPanelProps; onBack: () => void; onLogout: () => void }) {
  return <main className="shell shell--admin"><header className="topbar"><div className="brand"><span className="brand__mark">✦</span><span>VÄRLDENS TONER</span></div><div className="admin-nav"><button className="ghost" onClick={onBack}>Spelledarvy</button><button className="ghost" onClick={onLogout}>Logga ut</button></div></header><section className="admin-content"><div className="eyebrow">ADMINVY</div><h1>Frågebank</h1><p className="muted">Skapa frågor med plats och Spotifylänk. Välj sedan vilka frågor som ska användas i quizet.</p><QuestionBankPanel {...bank} showMap /></section></main>;
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

function FinalPodium({ players }: { players: Guess[] }) {
  return <div className="final-podium">{players.map((player, index) => <div className={`final-podium-row final-podium-row--${index + 1}`} key={player.name}><strong>{String(index + 1).padStart(2, "0")}</strong><i style={{ background: player.color }} /><span>{player.name}</span><b>{player.score ?? 0} p</b></div>)}</div>;
}

function MobileFinalView({ players, playerName }: { players: Guess[]; playerName: string }) {
  const sortedPlayers = [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const currentPlayer = sortedPlayers.find(player => player.name.toLowerCase() === playerName.toLowerCase());
  return <main className="shell shell--player"><header className="topbar"><div className="brand"><span className="brand__mark">✦</span><span>VÄRLDENS TONER</span></div><div className="tv-round">QUIZET ÄR KLART</div></header><section className="player-card player-card--finished"><div className="eyebrow">SLUTRESULTAT</div><h1>Prispall</h1>{currentPlayer && <p className="muted player-final-score">{currentPlayer.name}, du fick <strong>{currentPlayer.score ?? 0} poäng</strong>.</p>}<FinalPodium players={sortedPlayers} /></section></main>;
}

function TvView({ roomCode, round, totalRounds, prompt, category, imageUrl, followup, started, finished, reveal, players, answer }: { roomCode: string; round: number; totalRounds: number; prompt: string; category: string; imageUrl: string; followup: FollowUpQuestion | null; started: boolean; finished: boolean; reveal: number; players: Guess[]; answer: { x: number; y: number } }) {
  const qrRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (started || !qrRef.current || !roomCode) return;
    void import("qrcode").then(QRCode => { if (qrRef.current) void QRCode.toCanvas(qrRef.current, `${window.location.origin}/?room=${encodeURIComponent(roomCode)}`, { width: 260, margin: 2, color: { dark: "#081218", light: "#e6e6c4" } }); });
  }, [roomCode, started]);
  const sortedPlayers = [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || distanceKm(a, answer) - distanceKm(b, answer));
  if (!started) return <main className="tv-shell"><header className="tv-header"><div className="brand"><span className="brand__mark">✦</span><span>VÄRLDENS TONER</span></div><div className="tv-round">VÄNTAR PÅ START</div></header><section className="tv-lobby"><div className="eyebrow">ANSLUT TILL QUIZET</div><h1>Skanna för att delta</h1><canvas ref={qrRef} aria-label={`QR-kod för rum ${roomCode}`} /><div className="tv-room-code">{roomCode}</div><p>eller skriv in rumskoden på mobilen</p><strong>Spelledaren startar första frågan när alla är redo.</strong></section></main>;
  if (finished) return <main className="tv-shell"><header className="tv-header"><div className="brand"><span className="brand__mark">✦</span><span>VÄRLDENS TONER</span></div><div className="tv-round">QUIZET ÄR KLART</div></header><section className="tv-content tv-content--finished"><div className="eyebrow">SLUTRESULTAT</div><h1>Prispall</h1><FinalPodium players={sortedPlayers} /></section></main>;
  const displayedPrompt = followup?.prompt ?? prompt;
  const displayedImage = followup?.image_url ?? imageUrl;
  return <main className="tv-shell"><header className="tv-header"><div className="brand"><span className="brand__mark">✦</span><span>VÄRLDENS TONER</span></div><div className="tv-round">FRÅGA {String(round).padStart(2, "0")} AV {totalRounds}</div></header><section className="tv-content"><div className="tv-question">{followup ? <small className="tv-category">FÖLJDFRÅGA · {followup.points} P</small> : category && <small className="tv-category">{category}</small>}{displayedPrompt}{displayedImage && <img className="question-image question-image--tv" src={displayedImage} alt="Bild till frågan" />}</div><div className="tv-grid"><div className="tv-map"><Map reveal={reveal} guesses={players} answer={answer} showAnswer={reveal >= 1} /></div><aside className="tv-scoreboard"><div className="eyebrow">STÄLLNING</div>{sortedPlayers.length ? sortedPlayers.map((player, index) => <div className={`tv-score-row ${index === 0 && reveal >= 3 ? "tv-score-row--winner" : ""}`} key={player.name}><strong>{String(index + 1).padStart(2, "0")}</strong><i style={{ background: player.color }} /><span>{player.name}</span><small className={(followup ? player.followupLocked : player.locked) ? "player-ready" : "player-waiting"}>{(followup ? player.followupLocked : player.locked) ? "KLAR" : "VÄNTAR"}</small><b>{player.score ?? 0} p</b></div>) : <p className="tv-empty">Väntar på spelare…</p>}</aside></div></section></main>;
}

export default function Home() {
  const [mode, setMode] = useState<AppMode>(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("room") ? "player" : typeof window !== "undefined" && new URLSearchParams(window.location.search).has("tv") ? "tv" : typeof window !== "undefined" && window.location.pathname === "/admin" ? "admin" : "host");
  const [reveal, setReveal] = useState(0);
  const [round, setRound] = useState(1);
  const [started, setStarted] = useState(false);
  const [quizFinished, setQuizFinished] = useState(false);
    const [picked, setPicked] = useState({ x: 45, y: 46 });
    const [followupAnswer, setFollowupAnswer] = useState("");
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
    const [followups, setFollowups] = useState<FollowUpQuestion[]>([]);
    const [questionPrompt, setQuestionPrompt] = useState("");
    const [questionPlaceQuery, setQuestionPlaceQuery] = useState("");
    const [questionPoint, setQuestionPoint] = useState<{ latitude: number; longitude: number } | null>(null);
    const [questionContentType, setQuestionContentType] = useState<QuizQuestion["content_type"]>("music");
    const [questionImageUrl, setQuestionImageUrl] = useState("");
    const [followupParentId, setFollowupParentId] = useState("");
    const [followupPrompt, setFollowupPrompt] = useState("");
    const [followupImageUrl, setFollowupImageUrl] = useState("");
    const [followupSpotifyUrl, setFollowupSpotifyUrl] = useState("");
    const [followupPoints, setFollowupPoints] = useState("1");
    const [followupStatus, setFollowupStatus] = useState("");
    const [questionSpotifyUrl, setQuestionSpotifyUrl] = useState("");
  const [spotifyPreview, setSpotifyPreview] = useState<{ title: string; artist: string } | null>(null);
  const [questionStatus, setQuestionStatus] = useState("");
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [quizOrderItems, setQuizOrderItems] = useState<QuizOrderItem[]>([]);
  const [activeQuestions, setActiveQuestions] = useState<QuizQuestion[]>([]);
  const [activeQuizOrder, setActiveQuizOrder] = useState<QuizOrderItem[]>([]);
    const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
    const [activeFollowupIndex, setActiveFollowupIndex] = useState(-1);
    const [broadcastPrompt, setBroadcastPrompt] = useState("Var i världen?");
    const [broadcastCategory, setBroadcastCategory] = useState("");
    const [broadcastImageUrl, setBroadcastImageUrl] = useState("");
    const [broadcastFollowup, setBroadcastFollowup] = useState<FollowUpQuestion | null>(null);
  const [broadcastTotalRounds, setBroadcastTotalRounds] = useState(1);
  const sessionId = useState(() => typeof crypto === "undefined" ? Math.random().toString(36).slice(2) : crypto.randomUUID())[0];
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const scanVideoRef = useRef<HTMLVideoElement>(null);
  const qrScannerRef = useRef<QrScanner | null>(null);
  const scoredRoundRef = useRef<number | null>(null);
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
  const scoreSorted = useMemo(() => [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || distanceKm(a, answer) - distanceKm(b, answer)), [players, answer]);
  const pickedLngLat = toLngLat(picked);
    const activePrompt = activeQuestions[activeQuestionIndex]?.prompt ?? "Var i världen?";
    const activeImageUrl = activeQuestions[activeQuestionIndex]?.image_url ?? "";
    const activeFollowups = useMemo(() => {
      const parentId = activeQuestions[activeQuestionIndex]?.id;
      return followups.filter(followup => followup.parent_question_id === parentId).sort((a, b) => a.sort_order - b.sort_order);
    }, [activeQuestions, activeQuestionIndex, followups]);
    const currentFollowup = activeFollowupIndex >= 0 ? activeFollowups[activeFollowupIndex] ?? null : null;
  const activeCategory = useMemo(() => {
    let category = "";
    let questionIndex = -1;
    for (const item of activeQuizOrder) {
      if (item.type === "category") category = item.title;
      else { questionIndex += 1; if (questionIndex === activeQuestionIndex) return category; }
    }
    return "";
  }, [activeQuizOrder, activeQuestionIndex]);
  const roundTotal = Math.max(activeQuestions.length, 1);
    const roomStateRef = useRef({ roomCode, round, totalRounds: roundTotal, reveal, started, finished: quizFinished, players, answer, prompt: activePrompt, category: activeCategory, imageUrl: activeImageUrl, followup: currentFollowup });

  useEffect(() => {
    if (mode !== "player") return;
    setLocked(false);
    setFollowupAnswer("");
    setPicked({ x: 45, y: 46 });
  }, [mode, round, broadcastFollowup?.id]);

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
      void supabase.from("quiz_questions").select("id,prompt,place_label,latitude,longitude,content_type,image_url,spotify_url,spotify_title,spotify_artist").order("created_at", { ascending: false }).then(({ data, error }) => {
      if (error || !data) return;
      const loaded = data as QuizQuestion[];
      setQuestions(loaded);
      if (mode === "host" && loaded.length && !activeQuestions.length) {
        let selected = loaded;
        let selectedOrder: QuizOrderItem[] = loaded.map(question => ({ type: "question", id: question.id }));
        try {
          const stored = JSON.parse(window.localStorage.getItem(activeQuestionsStorageKey) ?? "[]") as QuizQuestion[];
          const storedSelection = Array.isArray(stored) ? stored.filter(question => loaded.some(candidate => candidate.id === question.id)) : [];
          if (storedSelection.length) selected = storedSelection;
          const storedOrder = JSON.parse(window.localStorage.getItem(activeQuizOrderStorageKey) ?? "[]") as QuizOrderItem[];
          if (Array.isArray(storedOrder) && storedOrder.length) selectedOrder = storedOrder.filter(item => item.type === "category" || (item.type === "question" && loaded.some(candidate => candidate.id === item.id)));
        } catch {
          // Use the loaded question list when no local selection is available.
        }
        setActiveQuestions(selected);
        setActiveQuizOrder(selectedOrder.filter(item => item.type === "category" || selected.some(question => question.id === item.id)));
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
    if (!['host', 'admin'].includes(mode) || !user) return;
    void supabase.from("quiz_followups").select("id,owner_id,parent_question_id,prompt,answer_type,image_url,spotify_url,spotify_title,spotify_artist,points,sort_order").order("sort_order", { ascending: true }).then(({ data }) => {
      if (data) setFollowups(data as FollowUpQuestion[]);
    });
  }, [mode, user]);

  useEffect(() => {
    if (mode !== "admin" || !questions.length) return;
    try {
      const storedOrder = JSON.parse(window.localStorage.getItem(activeQuizOrderStorageKey) ?? "[]") as QuizOrderItem[];
      if (!Array.isArray(storedOrder) || !storedOrder.length) return;
      const validOrder = storedOrder.filter(item => item.type === "category" || (item.type === "question" && questions.some(question => question.id === item.id)));
      const ids = validOrder.filter((item): item is Extract<QuizOrderItem, { type: "question" }> => item.type === "question").map(item => item.id);
      setQuizOrderItems(validOrder);
      setSelectedQuestionIds(ids);
    } catch {
      // Ignore malformed quiz order data.
    }
  }, [mode, questions]);

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
    if (mode !== "admin" || !questions.length) return;
    const selected = selectedQuestionIds.map(id => questions.find(question => question.id === id)).filter((question): question is QuizQuestion => Boolean(question));
    if (selected.length) window.localStorage.setItem(activeQuestionsStorageKey, JSON.stringify(selected));
    else window.localStorage.removeItem(activeQuestionsStorageKey);
    if (quizOrderItems.length) window.localStorage.setItem(activeQuizOrderStorageKey, JSON.stringify(quizOrderItems));
    else window.localStorage.removeItem(activeQuizOrderStorageKey);
    void channelRef.current?.send({ type: "broadcast", event: "active_questions", payload: { questions: selected, items: quizOrderItems } });
  }, [mode, questions, selectedQuestionIds, quizOrderItems]);

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
    roomStateRef.current = { roomCode, round, totalRounds: roundTotal, reveal, started, finished: quizFinished, players, answer, prompt: activePrompt, category: activeCategory, imageUrl: activeImageUrl, followup: currentFollowup };
  }, [roomCode, round, roundTotal, reveal, started, quizFinished, players, answer, activePrompt, activeCategory, activeImageUrl, currentFollowup]);

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
        if (typeof payload.totalRounds === "number") setBroadcastTotalRounds(payload.totalRounds);
        if (typeof payload.reveal === "number") setReveal(payload.reveal);
        if (typeof payload.started === "boolean") setStarted(payload.started);
        if (typeof payload.finished === "boolean") setQuizFinished(payload.finished);
        if (typeof payload.prompt === "string") setBroadcastPrompt(payload.prompt);
        if (typeof payload.category === "string") setBroadcastCategory(payload.category);
        if (typeof payload.imageUrl === "string") setBroadcastImageUrl(payload.imageUrl);
        setBroadcastFollowup(payload.followup && typeof payload.followup.prompt === "string" ? payload.followup as FollowUpQuestion : null);
        if (payload.answer && typeof payload.answer.x === "number" && typeof payload.answer.y === "number") setAnswer(payload.answer as { x: number; y: number });
      })
      .on("broadcast", { event: "active_questions" }, ({ payload }) => {
        if (mode !== "host" || !Array.isArray(payload?.questions)) return;
        const selected = payload.questions as QuizQuestion[];
        const items = Array.isArray(payload.items) ? payload.items as QuizOrderItem[] : selected.map(question => ({ type: "question" as const, id: question.id }));
        setActiveQuestions(selected);
        setActiveQuizOrder(items);
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
    void channelRef.current.send({ type: "broadcast", event: "room_state", payload: { roomCode, round, totalRounds: roundTotal, reveal, started, finished: quizFinished, players, answer, prompt: activePrompt, category: activeCategory, imageUrl: activeImageUrl, followup: currentFollowup, source: "host" } });
  }, [mode, roomCode, round, roundTotal, reveal, started, quizFinished, players, answer, activePrompt, activeCategory, activeImageUrl, currentFollowup]);

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
    if (!questionPrompt.trim() || !questionPoint || (questionContentType === "music" && !questionSpotifyUrl.trim())) return;
    setQuestionStatus("SPARAR...");
    const { data: sessionData } = await supabase.auth.getSession();
    let currentSession = sessionData.session;
    if (!currentSession) {
      const refreshed = await supabase.auth.refreshSession();
      currentSession = refreshed.data.session;
    }
    const currentUser = currentSession?.user;
    if (!currentUser) { setQuestionStatus("KUNDE INTE SPARA: LOGGA IN IGEN"); return; }
    const spotifyTrackId = questionContentType === "music" ? questionSpotifyUrl.match(/open\.spotify\.com\/(?:intl-[^/]+\/)?track\/([A-Za-z0-9]+)/)?.[1] ?? null : null;
    const { error } = await supabase.from("quiz_questions").insert({ owner_id: currentUser.id, prompt: questionPrompt.trim(), place_label: questionPlaceQuery.trim(), latitude: questionPoint.latitude, longitude: questionPoint.longitude, content_type: questionContentType, image_url: questionImageUrl.trim() || null, spotify_url: questionContentType === "music" ? questionSpotifyUrl.trim() : "", spotify_track_id: spotifyTrackId, spotify_title: questionContentType === "music" ? spotifyPreview?.title ?? null : null, spotify_artist: questionContentType === "music" ? spotifyPreview?.artist ?? null : null });
    if (error) { setQuestionStatus(`KUNDE INTE SPARA: ${error.message}`); return; }
    const { data: refreshed } = await supabase.from("quiz_questions").select("id,prompt,place_label,latitude,longitude,content_type,image_url,spotify_url,spotify_title,spotify_artist").order("created_at", { ascending: false });
    if (refreshed) setQuestions(refreshed as QuizQuestion[]);
    setQuestionPrompt(""); setQuestionPlaceQuery(""); setQuestionPoint(null); setQuestionContentType("music"); setQuestionImageUrl(""); setQuestionSpotifyUrl(""); setSpotifyPreview(null); setQuestionStatus("FRÅGAN SPARAD");
  };

  const saveFollowup = async () => {
    if (!followupParentId || !followupPrompt.trim()) return;
    setFollowupStatus("SPARAR...");
    const { data: sessionData } = await supabase.auth.getSession();
    const currentUser = sessionData.session?.user;
    if (!currentUser) { setFollowupStatus("KUNDE INTE SPARA: LOGGA IN IGEN"); return; }
    const spotifyTrackId = followupSpotifyUrl.match(/open\.spotify\.com\/(?:intl-[^/]+\/)?track\/([A-Za-z0-9]+)/)?.[1] ?? null;
    const sortOrder = followups.filter(followup => followup.parent_question_id === followupParentId).length;
    const { data, error } = await supabase.from("quiz_followups").insert({ owner_id: currentUser.id, parent_question_id: followupParentId, prompt: followupPrompt.trim(), image_url: followupImageUrl.trim() || null, spotify_url: followupSpotifyUrl.trim(), spotify_track_id: spotifyTrackId, points: Math.max(0, Math.min(10, Number(followupPoints) || 1)), sort_order: sortOrder }).select("id,owner_id,parent_question_id,prompt,answer_type,image_url,spotify_url,spotify_title,spotify_artist,points,sort_order").single();
    if (error) { setFollowupStatus(`KUNDE INTE SPARA: ${error.message}`); return; }
    if (data) setFollowups(current => [...current, data as FollowUpQuestion]);
    setFollowupPrompt(""); setFollowupImageUrl(""); setFollowupSpotifyUrl(""); setFollowupPoints("1"); setFollowupStatus("FÖLJDFRÅGAN SPARAD");
  };

  const useSelectedQuestions = () => {
    const chosen = quizOrderItems.filter((item): item is Extract<QuizOrderItem, { type: "question" }> => item.type === "question").map(item => questions.find(question => question.id === item.id)).filter((question): question is QuizQuestion => Boolean(question));
    if (!chosen.length) return;
    window.localStorage.setItem(activeQuestionsStorageKey, JSON.stringify(chosen));
    window.localStorage.setItem(activeQuizOrderStorageKey, JSON.stringify(quizOrderItems));
    void channelRef.current?.send({ type: "broadcast", event: "active_questions", payload: { questions: chosen, items: quizOrderItems } });
    setActiveQuestions(chosen); setActiveQuizOrder(quizOrderItems); setActiveQuestionIndex(0); setActiveFollowupIndex(-1); setRound(1); setReveal(0); setQuizFinished(false); setPlayers([]); setLocked(false);
    const first = chosen[0]; setAnswer(toPercent(first.longitude, first.latitude)); setAnswerLabel(first.place_label); setAnswerQuery(first.place_label);
  };

  const joinRoom = () => {
    const baseName = playerName.trim().slice(0, 24);
    if (!baseName || normalizeRoomCode(roomCodeInput) !== normalizeRoomCode(roomCode) || connectionStatus === "OFFLINE") return;
    let uniqueName = baseName;
    let suffix = 2;
    while (players.some(player => player.name.toLowerCase() === uniqueName.toLowerCase())) uniqueName = `${baseName} ${suffix++}`;
    setPlayerName(uniqueName);
    const player = { name: uniqueName, color: playerColors[players.length % playerColors.length], x: picked.x, y: picked.y, score: 0, locked: false };
    setPlayers(current => upsertPlayer(current, player));
    void channelRef.current?.send({ type: "broadcast", event: "player_joined", payload: { player, sessionId } });
    setJoined(true);
  };

  const lockGuess = () => {
    const player = players.find(candidate => candidate.name === playerName);
    if (!player) return;
    if (mode === "player" && broadcastFollowup) {
      if (!followupAnswer.trim()) return;
      const updatedPlayer = { ...player, followupAnswer: followupAnswer.trim(), followupLocked: true };
      setPlayers(current => upsertPlayer(current, updatedPlayer));
      void channelRef.current?.send({ type: "broadcast", event: "guess_submitted", payload: { player: updatedPlayer, sessionId } });
      setLocked(true);
      return;
    }
    const updatedPlayer = { ...player, x: picked.x, y: picked.y, locked: true };
    setPlayers(current => upsertPlayer(current, updatedPlayer));
    void channelRef.current?.send({ type: "broadcast", event: "guess_submitted", payload: { player: updatedPlayer, sessionId } });
    setLocked(true);
  };

  const nextRound = () => {
    if (quizFinished) return;
    const nextIndex = activeQuestionIndex + 1;
    const nextQuestion = activeQuestions[nextIndex];
    if (!nextQuestion) { setQuizFinished(true); return; }
    setActiveQuestionIndex(nextIndex); setActiveFollowupIndex(-1); setAnswer(toPercent(nextQuestion.longitude, nextQuestion.latitude)); setAnswerLabel(nextQuestion.place_label); setAnswerQuery(nextQuestion.place_label);
    setRound(current => current + 1);
    setReveal(0);
    setLocked(false);
    scoredRoundRef.current = null;
    setPlayers(current => current.map(player => ({ ...player, x: 45, y: 46, locked: false, followupAnswer: "", followupLocked: false, followupAwarded: false })));
  };

  const nextQuizStep = () => {
    if (activeFollowupIndex >= 0 && activeFollowupIndex + 1 < activeFollowups.length) {
      setActiveFollowupIndex(index => index + 1);
      setPlayers(current => current.map(player => ({ ...player, followupAnswer: "", followupLocked: false, followupAwarded: false })));
      return;
    }
    if (activeFollowupIndex >= 0) setActiveFollowupIndex(-1);
    nextRound();
  };

  const awardFollowupPoints = (playerNameToAward: string, points: number) => {
    setPlayers(current => current.map(player => player.name === playerNameToAward ? { ...player, score: (player.score ?? 0) + points, followupAwarded: true } : player));
  };

  const showDistanceAndAwardPoints = () => {
    setReveal(3);
    if (scoredRoundRef.current === round) return;
    scoredRoundRef.current = round;
    setPlayers(current => {
      const ranked = [...current].sort((a, b) => distanceKm(a, answer) - distanceKm(b, answer));
      return current.map(player => {
        const rank = ranked.findIndex(candidate => candidate.name === player.name);
        return { ...player, score: (player.score ?? 0) + pointsForRank(current.length, rank) };
      });
    });
    if (activeFollowups.length) setActiveFollowupIndex(0);
    else if (round >= roundTotal) setQuizFinished(true);
  };

  const bankProps: QuestionBankPanelProps = { questions, followups, prompt: questionPrompt, setPrompt: setQuestionPrompt, place: questionPlaceQuery, setPlace: setQuestionPlaceQuery, contentType: questionContentType, setContentType: setQuestionContentType, imageUrl: questionImageUrl, setImageUrl: setQuestionImageUrl, spotifyUrl: questionSpotifyUrl, setSpotifyUrl: setQuestionSpotifyUrl, followupParentId, setFollowupParentId, followupPrompt, setFollowupPrompt, followupImageUrl, setFollowupImageUrl, followupSpotifyUrl, setFollowupSpotifyUrl, followupPoints, setFollowupPoints, followupStatus, saveFollowup: () => void saveFollowup(), point: questionPoint, setPoint: setQuestionPoint, preview: spotifyPreview, status: questionStatus, selectedIds: selectedQuestionIds, setSelectedIds: setSelectedQuestionIds, orderItems: quizOrderItems, setOrderItems: setQuizOrderItems, findPlace: () => void findQuestionPlace(), save: () => void saveQuestion(), useSelected: useSelectedQuestions };

  if (mode !== "player" && mode !== "tv" && !authReady) return <main className="shell shell--auth"><section className="auth-card"><div className="brand"><span className="brand__mark">✦</span><span>VÄRLDENS TONER</span></div><p className="muted">Laddar spelledarpanelen...</p></section></main>;
  if (mode !== "player" && mode !== "tv" && !user) return <AuthScreen onAuthenticated={setUser} />;
  if (mode === "admin") return <AdminView bank={bankProps} onBack={()=>{ window.history.replaceState(null, "", "/"); setMode("host"); }} onLogout={()=>{ window.localStorage.removeItem(spotifyTokenStorageKey); window.sessionStorage.removeItem(spotifyTokenStorageKey); void supabase.auth.signOut(); }} />;
  if (mode === "tv") return <TvView roomCode={roomCode} round={round} totalRounds={broadcastTotalRounds} prompt={broadcastPrompt} category={broadcastCategory} imageUrl={broadcastImageUrl} followup={broadcastFollowup} started={started} finished={quizFinished} reveal={reveal} players={players} answer={answer} />;
  if (mode === "player" && joined && quizFinished) return <MobileFinalView players={scoreSorted} playerName={playerName} />;
  if (mode === "player") return <main className="shell shell--player"><header className="topbar"><div className="brand"><span className="brand__mark">✦</span><span>VÄRLDENS TONER</span></div><button className="ghost" onClick={() => setMode("host")}>Spelledarvy</button></header><section className="player-card">
    {!joined ? <><div className="eyebrow">DU ÄR INBJUDEN TILL RUMMET</div><h1>Sätt din nål.<br/><em>Hitta rätt plats.</em></h1><p className="muted">Skanna QR-koden från spelledaren eller fyll i rumskoden.</p><input value={roomCodeInput} onChange={e=>setRoomCodeInput(e.target.value)} placeholder="Rumskod" autoFocus /><button className="button button--secondary button--wide" onClick={() => setScanOpen(true)}>SKANNA QR-KOD <span>⌁</span></button><input value={playerName} onChange={e=>setPlayerName(e.target.value)} onKeyDown={e=>e.key === "Enter" && joinRoom()} placeholder="Ditt namn" /><button className="button button--primary button--wide" disabled={!playerName.trim() || normalizeRoomCode(roomCodeInput) !== normalizeRoomCode(roomCode)} onClick={joinRoom}>ANSLUT TILL RUMMET <span>→</span></button><div className="room-pill">RUMSKODEN ÄR ENDAST <strong>{roomCode}</strong></div>{scanOpen && <div className="scan-modal" role="dialog" aria-modal="true" aria-label="Skanna QR-kod"><div className="scan-modal__card"><div className="eyebrow">SKANNA FÖR ATT ANSLUTA</div><h2>Rikta kameran mot QR-koden</h2><video ref={scanVideoRef} muted playsInline />{scanError && <p className="scan-error">{scanError}</p>}<div className="scan-modal__actions"><button className="button button--outline" onClick={() => setScanOpen(false)}>AVBRYT</button></div></div></div>}</> : <><div className="player-status"><span className="live-dot"/> ANSLUTEN SOM <strong>{playerName.toUpperCase()}</strong><span className="round-tag">FRÅGA {String(round).padStart(2, "0")} AV {broadcastTotalRounds}</span></div>{broadcastFollowup ? <><div className="player-category">FÖLJDFRÅGA · {broadcastFollowup.points} P</div><h2>{broadcastFollowup.prompt}</h2>{broadcastFollowup.image_url && <img className="question-image question-image--player" src={broadcastFollowup.image_url} alt="Bild till följdfrågan" />}<p className="muted">Skriv ditt svar och lås in det.</p><input value={followupAnswer} onChange={event => setFollowupAnswer(event.target.value)} placeholder="Ditt svar" disabled={locked} /><button className={`button ${locked ? "button--locked" : "button--primary"}`} disabled={locked || !followupAnswer.trim()} onClick={lockGuess}>{locked ? "SVAR LÅST ✓" : "LÅS SVAR"}</button></> : <>{broadcastCategory && <div className="player-category">{broadcastCategory}</div>}<h2>{broadcastPrompt}</h2>{broadcastImageUrl && <img className="question-image question-image--player" src={broadcastImageUrl} alt="Bild till frågan" />}<p className="muted">Tryck på kartan för att placera din gissning.</p><Map reveal={reveal} guesses={[]} answer={answer} selected={picked} compact onPick={(x,y)=>!locked&&setPicked({x,y})}/><div className="player-actions"><div className="guess-readout"><span className="pin-dot"/> DIN GISSNING <strong>{Math.round(pickedLngLat[1])}°N, {Math.round(pickedLngLat[0])}°E</strong></div><button className={`button ${locked ? "button--locked" : "button--primary"}`} disabled={locked || reveal > 0} onClick={lockGuess}>{locked ? "SVAR LÅST ✓" : reveal > 0 ? "QUIZET ÄR LÅST" : "LÅS SVAR"}</button></div></>}</>}
  </section></main>;

  return <main className="shell"><header className="topbar"><div className="brand"><span className="brand__mark">✦</span><span>VÄRLDENS TONER</span></div><div className="topbar__center"><span className="live-dot"/> LIVEKVÄLL <span className="divider"/> RUM <strong>{roomCode}</strong></div><button className="ghost" onClick={()=>setMode("player")}>Spelarvy ↗</button></header><div className="host-layout"><aside className="sidebar"><div className="eyebrow">SPELLEDARPANEL</div><div className="round-card"><span>ANTAL FRÅGOR</span><strong>{roundTotal}</strong><small>frågor valda</small></div><div className="progress"><span style={{width:`${Math.min((round / roundTotal) * 100, 100)}%`}}/></div><div className="players-list"><div className="eyebrow">SPELARE <strong>{ready} ANSLUTNA</strong></div>{players.length ? players.map(p=><div className="player-row" key={p.name}><i style={{background:p.color}}/><span>{p.name}</span><em className={p.locked ? "player-ready" : "player-waiting"}>{p.locked ? "KLAR" : "VÄNTAR"}</em><b>{p.score ?? 0} P</b></div>) : <small className="players-empty">Inga spelare anslutna ännu</small>}</div><HostSessionPanel started={started} onStart={()=>{ setStarted(true); setQuizFinished(false); }} /></aside><section className="stage"><div className="stage-head"><div><div className="eyebrow">KARTA · FRÅGA {String(round).padStart(2,"0")} AV {roundTotal}</div>{currentFollowup ? <div className="host-category">FÖLJDFRÅGA · {currentFollowup.points} P</div> : activeCategory && <div className="host-category">{activeCategory}</div>}<h2>{currentFollowup?.prompt ?? activePrompt}</h2>{(currentFollowup?.image_url ?? activeImageUrl) && <img className="question-image question-image--host" src={currentFollowup?.image_url ?? activeImageUrl} alt="Bild till frågan" />}</div><div className="phase"><span className="phase-dot"/> {quizFinished ? "QUIZET ÄR KLART" : currentFollowup ? "FÖLJDFRÅGA" : started ? reveal === 0 ? "SVAR SAMLAS IN" : reveal === 1 ? "FACIT VISAS" : reveal === 2 ? "GISSNINGAR VISAS" : "RESULTAT" : "VÄNTAR PÅ START"}</div></div><Map reveal={reveal} guesses={players} answer={answer}/>{currentFollowup && <div className="followup-host-panel"><div className="eyebrow">MANUELL POÄNGSÄTTNING</div><p className="muted">Spelarnas svar visas här. Dela ut poäng manuellt.</p>{players.length ? players.map(player => <div className="followup-score-row" key={player.name}><span><b>{player.name}</b><small>{player.followupAnswer || "Väntar på svar…"}</small></span><div>{[0, 1, 2, 3, 5].map(points => <button key={points} className={player.followupAwarded && points === 0 ? "button button--done" : "button button--outline"} disabled={player.followupAwarded} onClick={() => awardFollowupPoints(player.name, points)}>+{points}</button>)}</div></div>) : <p className="muted">Inga spelare anslutna.</p>}<button className="button button--primary" onClick={nextQuizStep}>NÄSTA STEG →</button></div>}{!currentFollowup && <div className="reveal-controls"><button className="button button--outline" disabled={!started || quizFinished || reveal < 1} onClick={()=>setReveal(0)}>↺ Återställ</button><button className={`button ${reveal >= 1 ? "button--done" : "button--primary"}`} disabled={!started || quizFinished} onClick={()=>setReveal(1)}>{reveal >= 1 ? "SVAR VISAS ✓" : "VISA SVAR"}</button><button className={`button ${reveal >= 2 ? "button--done" : "button--primary"}`} disabled={!started || quizFinished || reveal < 1} onClick={()=>setReveal(2)}>{reveal >= 2 ? "GISSNINGAR VISAS ✓" : "VISA SPELARNAS PLATSER"}</button><button className={`button ${reveal >= 3 ? "button--done" : "button--accent"}`} disabled={!started || quizFinished || reveal < 2} onClick={showDistanceAndAwardPoints}>{reveal >= 3 ? "AVSTÅND VISAS ✓" : "VISA AVSTÅND"}</button></div>}{reveal >= 3 && !currentFollowup && <div className="results"><div className="results-head"><div><div className="eyebrow">{quizFinished ? "SLUTRESULTAT" : "FRÅGERESULTAT"}</div><h3>{quizFinished ? "Prispall" : "Närmast rätt plats"}</h3></div>{!quizFinished && <button className="button button--primary" onClick={nextRound}>NÄSTA FRÅGA →</button>}</div>{quizFinished ? <FinalPodium players={scoreSorted} /> : <div className="result-grid">{sorted.map((p,i)=><div className={`result-row ${i===0?"result-row--winner":""}`} key={p.name}><strong>{String(i+1).padStart(2,"0")}</strong><i style={{background:p.color}}/><span>{p.name}{i===0&&<small> ★ VINNARE</small>}</span><b>{p.score ?? 0} P · {distanceKm(p, answer).toLocaleString("sv-SE")} km</b></div>)}</div>}</div>}</section></div></main>;
}
