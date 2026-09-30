import { readFileSync } from 'fs'
import {
  seededShuffle, codeToSeed, dealHands, gameReducer, BLANK, CATS, deckFingerprint,
} from '../src/gameLogic.js'

const cards = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url), 'utf8'))
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}
const ids = h => h.map(c => c.id)
const dupes = a => a.filter((v, i) => a.indexOf(v) !== i)

console.log('\n=== 1. Dealing from one deck ===')
{
  const deck = seededShuffle(cards, codeToSeed('ABC123'))
  const { p1, p2 } = dealHands(deck)
  const overlap = ids(p1).filter(i => ids(p2).includes(i))
  check('no card is in both hands', overlap.length === 0, `${overlap.length} shared`)
  check('no duplicates within a hand', dupes(ids(p1)).length === 0 && dupes(ids(p2)).length === 0)
  check('every card dealt exactly once', p1.length + p2.length === cards.length,
    `${p1.length}+${p2.length} vs ${cards.length}`)
}

console.log('\n=== 2. Full game: cards can never duplicate or vanish ===')
{
  // Play many games to completion, asserting the invariant after every round.
  let worst = null
  for (let g = 0; g < 200 && !worst; g++) {
    const deck = seededShuffle(cards, 1000 + g)
    let s = gameReducer(BLANK, { type: 'INIT', deck })
    const total = cards.length
    for (let round = 0; round < 5000; round++) {
      if (s.phase === 'gameover') break
      const all = [...ids(s.p1Hand), ...ids(s.p2Hand), ...ids(s.pot)]
      if (all.length !== total || dupes(all).length) {
        worst = { g, round, len: all.length, dupes: dupes(all) }; break
      }
      const cat = CATS[round % CATS.length]
      s = gameReducer(s, { type: 'PICK', catKey: cat.key })
      s = gameReducer(s, { type: 'NEXT' })
    }
  }
  check('200 full games conserve all cards, no duplicates', worst === null,
    worst ? `game ${worst.g} round ${worst.round}: ${worst.len} cards, dupes ${worst.dupes}` : '')
}

console.log('\n=== 3. Two clients, SAME deck file (the happy path) ===')
{
  const code = 'XY7Z91'
  const a = gameReducer(BLANK, { type: 'INIT', deck: seededShuffle(cards, codeToSeed(code)) })
  const b = gameReducer(BLANK, { type: 'INIT', deck: seededShuffle(cards, codeToSeed(code)) })
  check('both clients deal identical hands',
    JSON.stringify(ids(a.p1Hand)) === JSON.stringify(ids(b.p1Hand)) &&
    JSON.stringify(ids(a.p2Hand)) === JSON.stringify(ids(b.p2Hand)))
  // What each player sees as "my card": P1 sees p1Hand[0], P2 sees p2Hand[0].
  check('the two players hold different cards', a.p1Hand[0].id !== b.p2Hand[0].id,
    `P1 ${a.p1Hand[0].guest} vs P2 ${b.p2Hand[0].guest}`)
}

console.log('\n=== 4. Two clients, DIFFERENT deck file (host on old build) ===')
{
  // Exactly what happens mid-session: the deck grew from 99 to 103 cards, so a
  // host who loaded before the deploy shuffles a different deck to the joiner.
  const oldDeck = cards.slice(0, 99)
  const code = 'XY7Z91'
  const host   = gameReducer(BLANK, { type: 'INIT', deck: seededShuffle(oldDeck, codeToSeed(code)) })
  const joiner = gameReducer(BLANK, { type: 'INIT', deck: seededShuffle(cards,   codeToSeed(code)) })

  const hostMine   = ids(host.p1Hand)    // what the host thinks it owns
  const joinerMine = ids(joiner.p2Hand)  // what the joiner thinks it owns
  const bothOwn = hostMine.filter(i => joinerMine.includes(i))

  console.log(`     host deck ${oldDeck.length} cards, joiner deck ${cards.length} cards`)
  console.log(`     host's top card:   ${host.p1Hand[0].guest}`)
  console.log(`     joiner's top card: ${joiner.p2Hand[0].guest}`)
  check('WITHOUT a guard, players share cards (documents the hazard)',
    bothOwn.length > 0,
    `${bothOwn.length} of ${hostMine.length} cards would be held by BOTH players`)

  console.log('\n     fingerprints:')
  console.log(`       host:   ${deckFingerprint(seededShuffle(oldDeck, codeToSeed(code)))}`)
  console.log(`       joiner: ${deckFingerprint(seededShuffle(cards, codeToSeed(code)))}`)
  check('fingerprint detects the mismatch',
    deckFingerprint(oldDeck) !== deckFingerprint(cards))
  check('fingerprint matches when decks agree',
    deckFingerprint(cards) === deckFingerprint([...cards]))
}

console.log('\n=== 5. The guard blocks exactly the bad cases ===')
{
  // watchDeckAgreement flags a mismatch when any published fingerprint differs.
  const flagged = (mine, others) => others.some(f => f !== mine)

  const same = deckFingerprint(cards)
  check('identical decks are allowed through', flagged(same, [same]) === false)
  check('99 vs 103 cards is blocked',
    flagged(deckFingerprint(cards), [deckFingerprint(cards.slice(0, 99))]))

  // Same length, one card's data changed: still a different pack.
  const edited = cards.map((c, i) => i === 5 ? { ...c, id: 999999 } : c)
  check('same size but different cards is blocked',
    flagged(deckFingerprint(cards), [deckFingerprint(edited)]))

  // Reordering must NOT trip the guard: the seeded shuffle reorders identically
  // on both clients, so only deck CONTENT matters.
  const shuffled = seededShuffle(cards, 4242)
  check('a reordered identical deck is still allowed',
    flagged(deckFingerprint(cards), [deckFingerprint(shuffled)]) === false,
    'fingerprint must ignore order')

  check('a solo game publishes nothing and is never blocked',
    flagged(deckFingerprint(cards), []) === false)
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}\n`)
process.exit(failures ? 1 : 0)
