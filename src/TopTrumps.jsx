import { useState } from 'react'
import cards from '../data/cards.json'
import './TopTrumps.css'

const CATS = [
  { key: 'wakeTime',       label: 'Wake Time',       icon: '⏰', lowerWins: true,  fmt: formatTime },
  { key: 'calories',       label: 'Calories',        icon: '🍽️', lowerWins: false, fmt: n => n.toLocaleString() + ' kcal' },
  { key: 'transportModes', label: 'Transport Modes', icon: '🚌', lowerWins: false, fmt: n => String(n) },
  { key: 'bedTime',        label: 'Bed Time',        icon: '🌙', lowerWins: false, fmt: formatTime },
  { key: 'coffees',        label: 'Coffees',         icon: '☕', lowerWins: false, fmt: n => String(n) },
]

function formatTime(h) {
  const hh = h % 24
  const hours = Math.floor(hh)
  const mins = Math.round((hh - hours) * 60)
  const ampm = hours < 12 ? 'am' : 'pm'
  const display = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
  return `${display}:${String(mins).padStart(2, '0')}${ampm}`
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function TopTrumps() {
  const [deck, setDeck] = useState(() => shuffle(cards))
  const [round, setRound] = useState(0)
  const [phase, setPhase] = useState('pick')
  const [cat, setCat] = useState(null)
  const [result, setResult] = useState(null)
  const [score, setScore] = useState({ p: 0, c: 0 })

  const totalRounds = Math.floor(deck.length / 2)
  const pCard = deck[round * 2]
  const cCard = deck[round * 2 + 1]

  function pick(c) {
    if (phase !== 'pick') return
    const pv = pCard[c.key]
    const cv = cCard[c.key]
    const r = pv === cv ? 'draw' : (c.lowerWins ? pv < cv : pv > cv) ? 'win' : 'lose'
    setCat(c)
    setResult(r)
    setPhase('reveal')
    setScore(s => ({ p: s.p + (r === 'win' ? 1 : 0), c: s.c + (r === 'lose' ? 1 : 0) }))
  }

  function next() {
    const nr = round + 1
    if (nr >= totalRounds) { setPhase('gameover'); return }
    setRound(nr)
    setPhase('pick')
    setCat(null)
    setResult(null)
  }

  function reset() {
    setDeck(shuffle(cards))
    setRound(0)
    setPhase('pick')
    setCat(null)
    setResult(null)
    setScore({ p: 0, c: 0 })
  }

  if (phase === 'gameover') {
    const winner = score.p > score.c ? 'You win! 🏆' : score.c > score.p ? 'CPU wins! 🤖' : "It's a draw! 🤝"
    return (
      <div className="tt-over">
        <h1>Game Over</h1>
        <p className="tt-winner">{winner}</p>
        <p className="tt-final">{score.p} – {score.c}</p>
        <button className="tt-btn" onClick={reset}>Play Again</button>
      </div>
    )
  }

  return (
    <div className="tt-root">
      <header className="tt-header">
        <h1>What Did You Do Yesterday?</h1>
        <div className="tt-scorebar">
          <span className={score.p >= score.c && (score.p > 0 || score.c > 0) ? 'tt-leading' : ''}>
            You: {score.p}
          </span>
          <span className="tt-rounds">Round {round + 1} / {totalRounds}</span>
          <span className={score.c > score.p ? 'tt-leading' : ''}>
            CPU: {score.c}
          </span>
        </div>
      </header>

      {phase === 'reveal' && (
        <div className={`tt-banner tt-banner-${result}`}>
          {result === 'win' ? '🏆 You win this round!' : result === 'lose' ? '😬 CPU wins this round!' : '🤝 Draw!'}
        </div>
      )}

      <div className="tt-arena">
        <div className="tt-side">
          <p className="tt-label">Your card</p>
          <TrumpCard card={pCard} phase={phase} activeCat={cat} onPick={pick} perspective="player" result={result} />
        </div>
        <div className="tt-vs">VS</div>
        <div className="tt-side">
          <p className="tt-label">CPU card</p>
          <TrumpCard card={cCard} phase={phase} activeCat={cat} perspective="cpu" result={result} />
        </div>
      </div>

      <div className="tt-footer">
        {phase === 'pick' && <p className="tt-hint">Pick a category to challenge the CPU</p>}
        {phase === 'reveal' && (
          <button className="tt-btn" onClick={next}>
            {round + 1 >= totalRounds ? 'See Final Score' : 'Next Round →'}
          </button>
        )}
      </div>
    </div>
  )
}

function TrumpCard({ card, phase, activeCat, onPick, perspective, result }) {
  const isPlayer = perspective === 'player'
  const revealed = isPlayer || phase === 'reveal'

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
              const win  = isActive && (isPlayer ? result === 'win'  : result === 'lose')
              const lose = isActive && (isPlayer ? result === 'lose' : result === 'win')
              return (
                <li
                  key={c.key}
                  className={[
                    'tt-stat',
                    isPlayer && phase === 'pick' ? 'tt-stat-pick' : '',
                    isActive ? 'tt-stat-active' : '',
                    win  ? 'tt-stat-win'  : '',
                    lose ? 'tt-stat-lose' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => isPlayer && phase === 'pick' && onPick(c)}
                >
                  <span className="tt-cat-icon">{c.icon}</span>
                  <span className="tt-cat-label">
                    {c.label}
                    {c.lowerWins && <em> ↓</em>}
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
