import { useState } from 'react'
import cards from '../data/cards.json'
import './TopTrumps.css'

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
  const n = Math.floor(Math.random() * 2176782336)
  return n.toString(36).toUpperCase().padStart(6, '0')
}

function codeToSeed(code) {
  return parseInt(code, 36)
}

function getUrlParams() {
  const p = new URLSearchParams(window.location.search)
  return { code: p.get('g'), player: p.get('p') }
}

function makeShareUrl(code, playerNum) {
  const url = new URL(window.location.href)
  url.search = ''
  url.searchParams.set('g', code)
  url.searchParams.set('p', playerNum)
  return url.toString()
}

export default function TopTrumps() {
  const urlParams = getUrlParams()

  const [screen, setScreen] = useState(urlParams.code ? 'joining' : 'setup')
  const [mode, setMode] = useState(null)      // 'solo' | 'multi'
  const [playerNum, setPlayerNum] = useState(null)  // 1 or 2 (multi only)
  const [gameCode, setGameCode] = useState(urlParams.code || '')
  const [shareUrl, setShareUrl] = useState('')
  const [deck, setDeck] = useState(null)
  const [round, setRound] = useState(0)
  const [phase, setPhase] = useState('pick')
  const [cat, setCat] = useState(null)
  // result is always P1-perspective: 'win' = deck[r*2] beat deck[r*2+1]
  const [result, setResult] = useState(null)
  // score.p = P1 round wins, score.c = P2 round wins
  const [score, setScore] = useState({ p: 0, c: 0 })

  function startSolo() {
    setMode('solo')
    setDeck(shuffle(cards))
    setScreen('game')
  }

  function hostMulti() {
    const code = makeCode()
    const seed = codeToSeed(code)
    setGameCode(code)
    setPlayerNum(1)
    setDeck(seededShuffle(cards, seed))
    setShareUrl(makeShareUrl(code, 2))
    setScreen('host-waiting')
  }

  function startFromHost() {
    setMode('multi')
    setScreen('game')
  }

  function joinFromUrl() {
    const code = urlParams.code.trim().toUpperCase()
    setGameCode(code)
    setPlayerNum(2)
    setDeck(seededShuffle(cards, codeToSeed(code)))
    setMode('multi')
    setScreen('game')
  }

  function reset() {
    setDeck(shuffle(cards))
    setRound(0); setPhase('pick'); setCat(null); setResult(null)
    setScore({ p: 0, c: 0 })
    setScreen('setup'); setMode(null); setPlayerNum(null)
    setGameCode(''); setShareUrl('')
    const url = new URL(window.location.href)
    url.search = ''
    window.history.replaceState({}, '', url)
  }

  const totalRounds = deck ? Math.floor(deck.length / 2) : 0
  // Canonical P1 card and P2 card from the deck
  const p1Card = deck ? deck[round * 2] : null
  const p2Card = deck ? deck[round * 2 + 1] : null

  const isP2 = mode === 'multi' && playerNum === 2
  // Each player sees their own card on the left, opponent's on the right
  const myCard  = isP2 ? p2Card : p1Card
  const oppCard = isP2 ? p1Card : p2Card

  // Score from my perspective
  const myScore  = isP2 ? score.c : score.p
  const oppScore = isP2 ? score.p : score.c

  // Whose turn to announce the pick (alternates in multi; always "mine" in solo)
  const isMyTurn = mode !== 'multi' || (playerNum === 1 ? round % 2 === 0 : round % 2 === 1)

  // Result from MY perspective
  const resultForMe = !result ? null : result === 'draw' ? 'draw'
    : isP2 ? (result === 'win' ? 'lose' : 'win') : result

  const oppLabel = mode === 'multi' ? 'Friend' : 'CPU'

  function pick(c) {
    if (phase !== 'pick') return
    // Always compare p1Card vs p2Card; result 'win' means p1Card won
    const pv = p1Card[c.key]
    const cv = p2Card[c.key]
    const r = pv === cv ? 'draw' : (c.lowerWins ? pv < cv : pv > cv) ? 'win' : 'lose'
    setCat(c)
    setResult(r)
    setPhase('reveal')
    setScore(s => ({ p: s.p + (r === 'win' ? 1 : 0), c: s.c + (r === 'lose' ? 1 : 0) }))
  }

  function next() {
    const nr = round + 1
    if (nr >= totalRounds) { setPhase('gameover'); return }
    setRound(nr); setPhase('pick'); setCat(null); setResult(null)
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

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
        <footer className="tt-credits">
          <p>Based on the <a href="https://everythingisshowbiz.com" target="_blank" rel="noreferrer">What Did You Do Yesterday?</a> podcast. All rights reserved by the podcast creators. Data sourced from <a href="https://everythingisshowbiz.com" target="_blank" rel="noreferrer">everythingisshowbiz.com</a>. This is an unofficial fan project.</p>
        </footer>
      </div>
    )
  }

  // ── Host waiting ──────────────────────────────────────────────────────────

  if (screen === 'host-waiting') {
    return (
      <div className="tt-over">
        <h1 style={{ fontSize: 'clamp(1.5rem,6vw,2.5rem)' }}>Share this link</h1>
        <p style={{ color: '#888', fontSize: '0.85rem' }}>Send it to your friend, then press Start when they're ready</p>
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
        <button onClick={reset} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '0.8rem' }}>
          ← Back
        </button>
      </div>
    )
  }

  // ── Joining (arrived via URL) ─────────────────────────────────────────────

  if (screen === 'joining') {
    return (
      <div className="tt-over">
        <h1 style={{ fontSize: 'clamp(1.5rem,6vw,2.5rem)' }}>Join Game</h1>
        <p style={{ color: '#888', fontSize: '0.85rem' }}>
          Code: <strong style={{ color: '#ffd700' }}>{urlParams.code}</strong>
        </p>
        <button className="tt-btn" onClick={joinFromUrl}>Join as Player 2 →</button>
        <button onClick={() => { window.history.replaceState({}, '', window.location.pathname); setScreen('setup') }}
          style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '0.8rem' }}>
          ← Back to menu
        </button>
      </div>
    )
  }

  // ── Game over ─────────────────────────────────────────────────────────────

  if (phase === 'gameover') {
    const winner = myScore > oppScore ? 'You win! 🏆' : oppScore > myScore ? `${oppLabel} wins!` : "It's a draw! 🤝"
    return (
      <div className="tt-over">
        <h1>Game Over</h1>
        <p className="tt-winner">{winner}</p>
        <p className="tt-final">{myScore} – {oppScore}</p>
        <button className="tt-btn" onClick={reset}>Play Again</button>
      </div>
    )
  }

  // ── Main game ─────────────────────────────────────────────────────────────

  return (
    <div className="tt-root">
      <header className="tt-header">
        <h1>What Did You Do Yesterday?</h1>
        <div className="tt-scorebar">
          <span className={myScore >= oppScore && (myScore > 0 || oppScore > 0) ? 'tt-leading' : ''}>
            You: {myScore}
          </span>
          <span className="tt-rounds">Round {round + 1} / {totalRounds}</span>
          <span className={oppScore > myScore ? 'tt-leading' : ''}>
            {oppLabel}: {oppScore}
          </span>
        </div>
      </header>

      {phase === 'reveal' && (
        <div className={`tt-banner tt-banner-${resultForMe}`}>
          {resultForMe === 'win' ? '🏆 You win this round!'
            : resultForMe === 'lose' ? `😬 ${oppLabel} wins this round!`
            : '🤝 Draw!'}
        </div>
      )}

      <div className="tt-arena">
        <div className="tt-side">
          <p className="tt-label">Your card</p>
          {/* My card: always visible, always clickable during pick phase */}
          <TrumpCard card={myCard} alwaysVisible phase={phase} activeCat={cat}
            onPick={pick} isMe result={resultForMe} canPick={phase === 'pick'} />
        </div>
        <div className="tt-vs">VS</div>
        <div className="tt-side">
          <p className="tt-label">{oppLabel}'s card</p>
          {/* Opp card: hidden until reveal, never clickable */}
          <TrumpCard card={oppCard} phase={phase} activeCat={cat}
            isMe={false} result={resultForMe} canPick={false} />
        </div>
      </div>

      <div className="tt-footer">
        {phase === 'pick' && (
          <p className="tt-hint">
            {mode === 'multi'
              ? isMyTurn
                ? 'Your pick — tell your friend what you chose!'
                : `${oppLabel}'s pick — tap the category they announce`
              : 'Pick a category to challenge the CPU'}
          </p>
        )}
        {phase === 'reveal' && (
          <button className="tt-btn" onClick={next}>
            {round + 1 >= totalRounds ? 'See Final Score' : 'Next Round →'}
          </button>
        )}
      </div>

      <footer className="tt-credits">
        <p>Based on the <a href="https://everythingisshowbiz.com" target="_blank" rel="noreferrer">What Did You Do Yesterday?</a> podcast. All rights reserved by the podcast creators. Data sourced from <a href="https://everythingisshowbiz.com" target="_blank" rel="noreferrer">everythingisshowbiz.com</a>. This is an unofficial fan project.</p>
      </footer>
    </div>
  )
}

function TrumpCard({ card, alwaysVisible, phase, activeCat, onPick, isMe, result, canPick }) {
  const revealed = alwaysVisible || phase === 'reveal'

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
              // win/lose is from this card's perspective
              const win  = isActive && (isMe ? result === 'win'  : result === 'lose')
              const lose = isActive && (isMe ? result === 'lose' : result === 'win')
              return (
                <li
                  key={c.key}
                  className={[
                    'tt-stat',
                    canPick ? 'tt-stat-pick' : '',
                    isActive ? 'tt-stat-active' : '',
                    win  ? 'tt-stat-win'  : '',
                    lose ? 'tt-stat-lose' : '',
                  ].filter(Boolean).join(' ')}
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
