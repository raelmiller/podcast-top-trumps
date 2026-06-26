import { useReducer, useRef, useState } from 'react'
import { initializeApp } from 'firebase/app'
import { getDatabase, ref, push, onChildAdded } from 'firebase/database'
import cards from '../data/cards.json'
import './TopTrumps.css'

// ── Firebase config ───────────────────────────────────────────────────────────
// Replace with your config from:
// console.firebase.google.com → Project Settings → Your apps → SDK setup and configuration
const firebaseConfig = {
  apiKey:            "AIzaSyALomVZcPbp3hWHCVyGNb-LXo04QqcNx74",
  authDomain:        "wdydy-abc65.firebaseapp.com",
  databaseURL:       "https://wdydy-abc65-default-rtdb.firebaseio.com",
  projectId:         "wdydy-abc65",
  storageBucket:     "wdydy-abc65.firebasestorage.app",
  messagingSenderId: "1098296030845",
  appId:             "1:1098296030845:web:f12a4f3a51f18cff106314",
}
const db = getDatabase(initializeApp(firebaseConfig))
// ─────────────────────────────────────────────────────────────────────────────

const CATS = [
  { key: 'wakeTime',       label: 'Wake Time',       icon: '⏰', lowerWins: true,  fmt: formatTime },
  { key: 'exoticScore',    label: 'Exotic Food',     icon: '🍱', lowerWins: false, fmt: n => `${n}/100`, subKey: 'exoticFood' },
  { key: 'transportModes', label: 'Transport Modes', icon: '🚌', lowerWins: false, fmt: n => String(n), subKey: 'transportList' },
  { key: 'bedTime',        label: 'Bed Time',        icon: '🌙', lowerWins: false, fmt: formatTime },
  { key: 'coffees',        label: 'Coffees',         icon: '☕', lowerWins: false, fmt: n => String(n) },
]

function formatTime(h) {
  const hh = h % 24
  const hours = Math.floor(hh)
  const mins = Math.round((hh - hours) * 60)
  const ampm = hours < 12 ? 'am' : 'pm'
  const display12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
  return `${String(display12).padStart(2, '0')}:${String(mins).padStart(2, '0')}${ampm}`
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

function seededShuffle(arr, seed) {
  const a = [...arr]
  const rand = mulberry32(seed)
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function makeCode() {
  return Math.floor(Math.random() * 2176782336).toString(36).toUpperCase().padStart(6, '0')
}

function codeToSeed(code) { return parseInt(code, 36) }

function getUrlParams() {
  const p = new URLSearchParams(window.location.search)
  return { code: p.get('g') }
}

function makeShareUrl(code) {
  const url = new URL(window.location.href)
  url.search = ''
  url.searchParams.set('g', code)
  url.searchParams.set('p', '2')
  return url.toString()
}

function dealHands(deck) {
  return {
    p1: deck.filter((_, i) => i % 2 === 0),
    p2: deck.filter((_, i) => i % 2 === 1),
  }
}

// ── Game reducer ──────────────────────────────────────────────────────────────
// All actions have guards so receiving a duplicate (e.g. both players click
// Next at the same moment) is a safe no-op.

const BLANK = {
  p1Hand: null, p2Hand: null, pot: [],
  isP1Turn: true, round: 1,
  phase: 'pick', cat: null, result: null,
}

function gameReducer(state, action) {
  switch (action.type) {
    case 'INIT': {
      const { p1, p2 } = dealHands(action.deck)
      return { ...BLANK, p1Hand: p1, p2Hand: p2 }
    }
    case 'PICK': {
      if (state.phase !== 'pick') return state
      const c = CATS.find(c => c.key === action.catKey)
      const pv = state.p1Hand[0][c.key]
      const cv = state.p2Hand[0][c.key]
      const result = pv === cv ? 'draw' : (c.lowerWins ? pv < cv : pv > cv) ? 'win' : 'lose'
      return { ...state, cat: c, result, phase: 'reveal' }
    }
    case 'NEXT': {
      if (state.phase !== 'reveal') return state
      const top1 = state.p1Hand[0], top2 = state.p2Hand[0]
      let newP1, newP2, newPot, nextIsP1Turn
      if (state.result === 'win') {
        newP1 = [...state.p1Hand.slice(1), ...state.pot, top1, top2]
        newP2 = state.p2Hand.slice(1); newPot = []; nextIsP1Turn = true
      } else if (state.result === 'lose') {
        newP1 = state.p1Hand.slice(1)
        newP2 = [...state.p2Hand.slice(1), ...state.pot, top2, top1]
        newPot = []; nextIsP1Turn = false
      } else {
        newP1 = state.p1Hand.slice(1); newP2 = state.p2Hand.slice(1)
        newPot = [...state.pot, top1, top2]; nextIsP1Turn = state.isP1Turn
      }
      if (newP1.length === 0 || newP2.length === 0)
        return { ...state, p1Hand: newP1, p2Hand: newP2, phase: 'gameover' }
      return {
        ...state, p1Hand: newP1, p2Hand: newP2, pot: newPot,
        isP1Turn: nextIsP1Turn, round: state.round + 1,
        phase: 'pick', cat: null, result: null,
      }
    }
    case 'RESET': return BLANK
    default: return state
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TopTrumps() {
  const urlParams = getUrlParams()

  const [screen, setScreen]     = useState(urlParams.code ? 'joining' : 'setup')
  const [mode, setMode]         = useState(null)   // 'solo' | 'multi'
  const [playerNum, setPlayerNum] = useState(null) // 1 or 2
  const [gameCode, setGameCode] = useState(urlParams.code || '')
  const [shareUrl, setShareUrl] = useState('')

  const [gs, dispatch] = useReducer(gameReducer, BLANK)

  // Firebase listener unsubscribe handle
  const unsubRef = useRef(null)
  // Firebase ref for the current game's moves
  const movesRef = useRef(null)

  // ── Firebase helpers ────────────────────────────────────────────────────────

  function startListening(code) {
    const r = ref(db, `games/${code}/moves`)
    movesRef.current = r
    // onChildAdded replays all existing children first, then streams new ones.
    // This means a player who joins late (or refreshes) auto-catches up.
    unsubRef.current = onChildAdded(r, snap => {
      const { t, k } = snap.val()
      if (t === 'pick') dispatch({ type: 'PICK', catKey: k })
      if (t === 'next') dispatch({ type: 'NEXT' })
    })
  }

  function stopListening() {
    unsubRef.current?.()
    unsubRef.current = null
    movesRef.current = null
  }

  function send(msg) {
    if (movesRef.current) push(movesRef.current, msg)
  }

  // ── Game actions ────────────────────────────────────────────────────────────

  function startSolo() {
    dispatch({ type: 'INIT', deck: shuffle(cards) })
    setMode('solo'); setPlayerNum(null); setScreen('game')
  }

  function hostMulti() {
    const code = makeCode()
    dispatch({ type: 'INIT', deck: seededShuffle(cards, codeToSeed(code)) })
    setGameCode(code); setPlayerNum(1)
    setShareUrl(makeShareUrl(code))
    startListening(code)
    setScreen('host-waiting')
  }

  function startFromHost() {
    setMode('multi'); setScreen('game')
  }

  function joinFromUrl() {
    const code = urlParams.code.trim().toUpperCase()
    dispatch({ type: 'INIT', deck: seededShuffle(cards, codeToSeed(code)) })
    setGameCode(code); setPlayerNum(2)
    startListening(code)
    setMode('multi'); setScreen('game')
  }

  function pick(c) {
    if (gs.phase !== 'pick' || !isMyTurn) return
    dispatch({ type: 'PICK', catKey: c.key })
    send({ t: 'pick', k: c.key })
  }

  function next() {
    if (gs.phase !== 'reveal') return
    dispatch({ type: 'NEXT' })
    send({ t: 'next' })
  }

  function reset() {
    stopListening()
    dispatch({ type: 'RESET' })
    setMode(null); setPlayerNum(null); setGameCode(''); setShareUrl('')
    setScreen('setup')
    const url = new URL(window.location.href); url.search = ''
    window.history.replaceState({}, '', url)
  }

  // ── Derived values ──────────────────────────────────────────────────────────

  const isP2 = mode === 'multi' && playerNum === 2
  const myCard  = isP2 ? gs.p2Hand?.[0] : gs.p1Hand?.[0]
  const oppCard = isP2 ? gs.p1Hand?.[0] : gs.p2Hand?.[0]
  const myCards  = (isP2 ? gs.p2Hand : gs.p1Hand)?.length ?? 0
  const oppCards = (isP2 ? gs.p1Hand : gs.p2Hand)?.length ?? 0
  const isMyTurn = mode !== 'multi' || (isP2 ? !gs.isP1Turn : gs.isP1Turn)
  const resultForMe = !gs.result ? null : gs.result === 'draw' ? 'draw'
    : isP2 ? (gs.result === 'win' ? 'lose' : 'win') : gs.result
  const oppLabel = mode === 'multi' ? 'Friend' : 'CPU'

  // ── Screens ─────────────────────────────────────────────────────────────────

  if (screen === 'setup') {
    return (
      <div className="tt-over">
        <h1>What Did You Do Yesterday?</h1>
        <p style={{ color: '#888', fontSize: '0.95rem' }}>Top Trumps</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%', maxWidth: '280px' }}>
          <button className="tt-btn" onClick={startSolo}>Solo vs CPU</button>
          <button className="tt-btn" style={{ background: 'linear-gradient(135deg,#4a90d9,#1a5fa8)', color: '#fff' }} onClick={hostMulti}>
            Play with a Friend
          </button>
        </div>
        <Credits />
      </div>
    )
  }

  if (screen === 'host-waiting') {
    return (
      <div className="tt-over">
        <h1 style={{ fontSize: 'clamp(1.5rem,6vw,2.5rem)' }}>Share this link</h1>
        <p style={{ color: '#888', fontSize: '0.85rem' }}>Send it to your friend, then press Start when you're both ready</p>
        <div className="tt-code-box">
          <span className="tt-code-label">Game code</span>
          <span className="tt-code-text">{gameCode}</span>
        </div>
        <div style={{ width: '100%', maxWidth: '420px' }}>
          <input className="tt-code-input" readOnly value={shareUrl} onFocus={e => e.target.select()} />
          <button className="tt-btn" style={{ marginTop: '0.5rem', width: '100%' }}
            onClick={() => navigator.clipboard?.writeText(shareUrl)}>
            Copy Link
          </button>
        </div>
        <button className="tt-btn" onClick={startFromHost}>Start Game →</button>
        <button onClick={reset} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '0.8rem' }}>← Back</button>
      </div>
    )
  }

  if (screen === 'joining') {
    return (
      <div className="tt-over">
        <h1 style={{ fontSize: 'clamp(1.5rem,6vw,2.5rem)' }}>Join Game</h1>
        <p style={{ color: '#888', fontSize: '0.85rem' }}>
          Code: <strong style={{ color: '#ffd700' }}>{urlParams.code}</strong>
        </p>
        <button className="tt-btn" onClick={joinFromUrl}>Join →</button>
        <button onClick={() => { window.history.replaceState({}, '', window.location.pathname); setScreen('setup') }}
          style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '0.8rem' }}>
          ← Back to menu
        </button>
      </div>
    )
  }

  if (gs.phase === 'gameover') {
    const myFinal  = (isP2 ? gs.p2Hand : gs.p1Hand)?.length ?? 0
    const oppFinal = (isP2 ? gs.p1Hand : gs.p2Hand)?.length ?? 0
    const winner = myFinal > oppFinal ? 'You win! 🏆' : oppFinal > myFinal ? `${oppLabel} wins!` : "It's a draw! 🤝"
    return (
      <div className="tt-over">
        <h1>Game Over</h1>
        <p className="tt-winner">{winner}</p>
        <p className="tt-final">{myFinal} – {oppFinal}</p>
        <p style={{ color: '#555', fontSize: '0.85rem' }}>cards</p>
        <button className="tt-btn" onClick={reset}>Play Again</button>
      </div>
    )
  }

  // ── Main game ───────────────────────────────────────────────────────────────

  const potNote = gs.pot.length > 0 ? ` · ${gs.pot.length} in pot` : ''

  return (
    <div className="tt-root">
      <header className="tt-header">
        <h1>What Did You Do Yesterday?</h1>
        <div className="tt-scorebar">
          <span className={myCards > oppCards ? 'tt-leading' : ''}>You: {myCards}</span>
          <span className="tt-rounds">Round {gs.round}{potNote}</span>
          <span className={oppCards > myCards ? 'tt-leading' : ''}>{oppLabel}: {oppCards}</span>
        </div>
      </header>

      {gs.phase === 'reveal' && (
        <div className={`tt-banner tt-banner-${resultForMe}`}>
          {resultForMe === 'win'
            ? `🏆 You win${gs.pot.length > 0 ? ` +${gs.pot.length} from pot` : ''}!`
            : resultForMe === 'lose'
            ? `😬 ${oppLabel} wins${gs.pot.length > 0 ? ` +${gs.pot.length} from pot` : ''}!`
            : '🤝 Draw — cards go to the pot!'}
        </div>
      )}

      <div className="tt-arena">
        <div className="tt-side">
          <p className="tt-label">Your card</p>
          <TrumpCard card={myCard} alwaysVisible phase={gs.phase} activeCat={gs.cat}
            onPick={pick} isMe result={resultForMe} canPick={gs.phase === 'pick' && isMyTurn} />
        </div>
        <div className="tt-vs">VS</div>
        <div className="tt-side">
          <p className="tt-label">{oppLabel}'s card</p>
          <TrumpCard card={oppCard} phase={gs.phase} activeCat={gs.cat}
            isMe={false} result={resultForMe} canPick={false} />
        </div>
      </div>

      <div className="tt-footer">
        {gs.phase === 'pick' && (
          <p className="tt-hint">
            {mode === 'multi'
              ? isMyTurn ? 'Your pick' : 'Waiting for friend to pick…'
              : 'Pick a category to challenge the CPU'}
          </p>
        )}
        {gs.phase === 'reveal' && (
          <button className="tt-btn" onClick={next}>Next Round →</button>
        )}
      </div>

      <Credits />
    </div>
  )
}

function Credits() {
  return (
    <footer className="tt-credits">
      <p>Based on the <a href="https://everythingisshowbiz.com" target="_blank" rel="noreferrer">What Did You Do Yesterday?</a> podcast. All rights reserved by the podcast creators. Data sourced from <a href="https://everythingisshowbiz.com" target="_blank" rel="noreferrer">everythingisshowbiz.com</a>. This is an unofficial fan project.</p>
    </footer>
  )
}

function TrumpCard({ card, alwaysVisible, phase, activeCat, onPick, isMe, result, canPick }) {
  const revealed = alwaysVisible || phase === 'reveal'
  if (!card) return null
  return (
    <div className={`tt-card ${!revealed ? 'tt-card-hidden' : ''}`}>
      {!revealed ? (
        <div className="tt-back-inner">?</div>
      ) : (
        <>
          <div className="tt-card-top">
            <span className="tt-ep-badge">EP. {card.episode}</span>
            {card.photo
              ? <img className="tt-photo" src={card.photo} alt={card.guest} />
              : <div className="tt-photo tt-photo-placeholder">{card.guest.charAt(0)}</div>
            }
            <h2 className="tt-guest">{card.guest}</h2>
          </div>
          <ul className="tt-stats">
            {CATS.map(c => {
              const isActive = activeCat?.key === c.key
              const win  = isActive && (isMe ? result === 'win'  : result === 'lose')
              const lose = isActive && (isMe ? result === 'lose' : result === 'win')
              return (
                <li key={c.key}
                  className={['tt-stat', canPick ? 'tt-stat-pick' : '', isActive ? 'tt-stat-active' : '', win ? 'tt-stat-win' : '', lose ? 'tt-stat-lose' : ''].filter(Boolean).join(' ')}
                  onClick={() => canPick && onPick(c)}
                >
                  <span className="tt-cat-icon">{c.icon}</span>
                  <span className="tt-cat-label">
                    {c.label}
                    {c.lowerWins && <em> ↓</em>}
                    {c.subKey && card[c.subKey] && (
                      <small style={{ display: 'block', opacity: 0.75, fontStyle: 'italic' }}>{card[c.subKey]}</small>
                    )}
                  </span>
                  <span className="tt-cat-val">{c.fmt(card[c.key])}</span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
