// Pure game logic, kept out of the component so it can be tested directly.

export function formatTime(h) {
  const hh = h % 24
  const hours = Math.floor(hh)
  const mins = Math.round((hh - hours) * 60)
  const ampm = hours < 12 ? 'am' : 'pm'
  const display12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
  return `${String(display12).padStart(2, '0')}:${String(mins).padStart(2, '0')}${ampm}`
}

export const CATS = [
  { key: 'wakeTime',       label: 'Wake Time',       icon: '⏰', lowerWins: true,  fmt: formatTime },
  { key: 'exoticScore',    label: 'Exotic Food',     icon: '🍱', lowerWins: false, fmt: n => `${n}/100`, subKey: 'exoticFood' },
  { key: 'transportModes', label: 'Transport Modes', icon: '🚌', lowerWins: false, fmt: n => String(n), subKey: 'transportList' },
  { key: 'bedTime',        label: 'Bed Time',        icon: '🌙', lowerWins: false, fmt: formatTime },
  { key: 'coffees',        label: 'Coffees',         icon: '☕', lowerWins: false, fmt: n => String(n) },
]

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

export function seededShuffle(arr, seed) {
  const a = [...arr]
  const rand = mulberry32(seed)
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function makeCode() {
  return Math.floor(Math.random() * 2176782336).toString(36).toUpperCase().padStart(6, '0')
}

export function codeToSeed(code) { return parseInt(code, 36) }

// Both clients must deal from an identical deck. The deck file changes whenever
// new episodes are scraped, so a host on the old build and a joiner on the new
// one would otherwise shuffle different decks from the same code and end up
// holding the same card on two screens. This fingerprint lets them detect that.
//
// Order-independent on purpose: only the deck's CONTENTS need to agree, since
// the seeded shuffle reorders both clients' copies identically anyway. A build
// that merely sorted the file differently must not be mistaken for a mismatch.
export function deckFingerprint(deck) {
  const ids = deck.map(c => c.id).sort((a, b) => a - b)
  let h = 0x811c9dc5
  for (const id of ids) {
    const s = `${id}`
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    h ^= 0x2c  // separator, so [1,23] and [12,3] differ
    h = Math.imul(h, 0x01000193)
  }
  return ((h >>> 0).toString(36) + '-' + deck.length).toUpperCase()
}

export function dealHands(deck) {
  return {
    p1: deck.filter((_, i) => i % 2 === 0),
    p2: deck.filter((_, i) => i % 2 === 1),
  }
}

// ── Game reducer ──────────────────────────────────────────────────────────────
// All actions have guards so receiving a duplicate (e.g. both players click
// Next at the same moment) is a safe no-op.

export const BLANK = {
  p1Hand: null, p2Hand: null, pot: [],
  isP1Turn: true, round: 1,
  phase: 'pick', cat: null, result: null,
}

export function gameReducer(state, action) {
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
        return { ...state, p1Hand: newP1, p2Hand: newP2, pot: newPot, phase: 'gameover' }
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
