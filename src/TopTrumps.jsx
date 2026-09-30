import { useReducer, useRef, useState } from 'react'
import { initializeApp } from 'firebase/app'
import { getDatabase, ref, push, set, onValue, onChildAdded } from 'firebase/database'
import cards from '../data/cards.json'
import {
  CATS, BLANK, gameReducer, shuffle, seededShuffle,
  makeCode, codeToSeed, deckFingerprint,
} from './gameLogic.js'
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

// Identifies this build's deck. Both players must agree on it, or the same
// card can end up in both hands — see the deck-mismatch guard below.
const MY_DECK = deckFingerprint(cards)

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
  // Unsubscribe handle for the deck-agreement watcher
  const deckUnsubRef = useRef(null)
  // Set when the two players turn out to be on different builds of the deck
  const [deckMismatch, setDeckMismatch] = useState(null)

  // ── Deck agreement ─────────────────────────────────────────────────────────
  // Both players publish the fingerprint of the deck they loaded. The seeded
  // shuffle only produces matching hands if both decks are identical, so if the
  // fingerprints differ the two screens are dealing from different packs and the
  // same card can be top of both hands. Detect it and stop rather than play on.

  function watchDeckAgreement(code, playerNum) {
    set(ref(db, `games/${code}/decks/${playerNum}`), MY_DECK)
    deckUnsubRef.current = onValue(ref(db, `games/${code}/decks`), snap => {
      const seen = Object.values(snap.val() || {})
      const other = seen.find(f => f !== MY_DECK)
      if (other) setDeckMismatch({ mine: MY_DECK, theirs: other })
    })
  }

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
    deckUnsubRef.current?.()
    deckUnsubRef.current = null
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
    watchDeckAgreement(code, 1)
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
    watchDeckAgreement(code, 2)
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
    setDeckMismatch(null)
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

  // A deck mismatch means the two screens are dealing from different packs, so
  // nothing shown after this point can be trusted. Block before any game screen.
  if (deckMismatch) {
    return (
      <div className="tt-over">
        <h1 style={{ fontSize: 'clamp(1.4rem,5vw,2.2rem)' }}>Different card packs</h1>
        <p style={{ color: '#aaa', fontSize: '0.95rem', maxWidth: '30rem', lineHeight: 1.5 }}>
          You and your friend have different versions of the deck, so you'd be
          playing with mismatched cards. This happens when one of you has an
          older copy of the page open.
        </p>
        <p style={{ color: '#888', fontSize: '0.9rem', maxWidth: '30rem', lineHeight: 1.5 }}>
          <strong style={{ color: '#ffd700' }}>Both of you</strong> reload the
          page, then start a new game.
        </p>
        <button className="tt-btn" onClick={() => window.location.reload()}>Reload</button>
        <p style={{ color: '#444', fontSize: '0.7rem', fontFamily: 'monospace' }}>
          yours: {deckMismatch.mine} · theirs: {deckMismatch.theirs}
        </p>
      </div>
    )
  }

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
