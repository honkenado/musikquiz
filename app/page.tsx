"use client";

import { useMemo, useState } from "react";

type Guess = { name: string; color: string; x: number; y: number; km?: number };
const players: Guess[] = [
  { name: "Maja", color: "#ff6b4a", x: 39, y: 43, km: 118 },
  { name: "Oskar", color: "#64d7ff", x: 47, y: 49, km: 842 },
  { name: "Nora", color: "#f5c451", x: 57, y: 37, km: 1260 },
  { name: "Viktor", color: "#b995ff", x: 33, y: 53, km: 2210 },
];

function Map({ reveal, guesses, onPick, selected, compact = false }: { reveal: number; guesses: Guess[]; onPick?: (x: number, y: number) => void; selected?: { x: number; y: number }; compact?: boolean }) {
  const answer = { x: 42, y: 45 };
  return <div className={`map ${compact ? "map--compact" : ""}`} onClick={e => { if (!onPick) return; const r = e.currentTarget.getBoundingClientRect(); onPick(Math.round(((e.clientX-r.left)/r.width)*100), Math.round(((e.clientY-r.top)/r.height)*100)); }}>
    <svg viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true" className="map__art">
      <defs><pattern id="grid" width="58" height="58" patternUnits="userSpaceOnUse"><path d="M58 0H0V58" fill="none" stroke="#ffffff" strokeOpacity=".055" /></pattern></defs>
      <rect width="1000" height="560" fill="url(#grid)" />
      <g fill="#173b46" stroke="#2b6470" strokeWidth="2">
        <path d="M85 155l70-55 87 12 35 51-32 47-66 12-30 57-50-33-25-55z"/><path d="M262 306l70-35 66 33-12 75-42 41-28 81-42-15-10-88-29-37z"/>
        <path d="M463 130l52-31 58 19 24 45-30 33-28 2-15 64-38-22-8-54-35-24z"/><path d="M570 230l64-20 75 31 53-12 85 51-39 44-63-9-35 40-84-12-35-45z"/>
        <path d="M744 370l79-17 66 50-28 45-80 14-52-38z"/><path d="M820 122l45-26 58 20 18 47-46 17-46-17z"/>
      </g>
    </svg>
    <div className="map__labels"><span>ATLANTEN</span><span>STILLA HAVET</span><span>INDISKA OCEANEN</span></div>
    {selected && <div className="pin pin--selected" style={{ left: `${selected.x}%`, top: `${selected.y}%` }}><span>DU</span></div>}
    {reveal >= 1 && guesses.map(g => <div key={g.name} className="pin pin--player" style={{ left: `${g.x}%`, top: `${g.y}%`, background: g.color }} title={g.name}><span>{g.name}</span></div>)}
    {reveal >= 2 && <div className="pin pin--answer" style={{ left: `${answer.x}%`, top: `${answer.y}%` }}><span>FACIT</span></div>}
    {reveal >= 3 && guesses.map(g => <div className="route" key={`route-${g.name}`} style={{ left: `${g.x}%`, top: `${g.y}%`, width: `${Math.hypot((answer.x-g.x)*.93, (answer.y-g.y))*1.05}%`, transform: `rotate(${Math.atan2(answer.y-g.y, answer.x-g.x)*180/Math.PI}deg)` }} />)}
  </div>;
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
