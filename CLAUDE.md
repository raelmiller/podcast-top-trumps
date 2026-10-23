# What Did You Do Yesterday? — Top Trumps

A card game built from the podcast's episode transcripts. Live at
https://wdydy-top-trumps.netlify.app/

## Two repos — read this first

- `raelmiller/podcast-top-trumps` (this repo, `main`) — **what Netlify builds.**
  A push here deploys the site.
- `raelmiller/exec-search` (branch `claude/podcast-top-trumps-game-26xt7v`) — the
  development copy. Pushing there does **not** touch the website.

Changes to the deck or the game must land in **both**, or they diverge. A deploy
run from a stale checkout has already silently reverted fixes once;
`exec-search/deploy.bat` now refuses to run when the branch is behind.

## Reviewing card corrections

Players submit corrections with the `⚑` on any card. The flow:

1. Submissions go to Firebase. **Claude Code sessions cannot reach Firebase**
   (the egress proxy blocks it), so they are collected on a GitHub runner.
2. Run the `collect-feedback` workflow — scheduled daily at 07:23 UTC, or
   trigger it directly. It appends new items to `data/feedback.json`.
3. Read `data/feedback.json` and review each `status: "pending"` item against
   the rubric below. Propose a score with reasoning; **compare against similar
   cards already in the deck**, not just the band, since consistency between
   cards is what the rubric is protecting.
4. The owner accepts, adjusts or rejects. Nothing on a card changes without that.
5. Apply accepted changes to `data/cards.json`, set the item's `status` to
   `accepted`, `adjusted` or `no_change` with a short `decision` note, and push
   to both repos.

Each submission carries a `current` snapshot of what the submitter was looking
at. If it disagrees with the card today, they were on a stale page — say so
rather than acting on it.

## The exotic food rubric

The authoritative version is the `exoticScore` section of the extraction prompt
in `scripts/build_cards.py`. Keep that and any review in step. In short: rarity
judged from a mainstream **British** perspective, weighted by how high-end the
venue is, on a curve centred near 42.

| Band | What belongs there |
|------|--------------------|
| 1–10 | Truly plain — tea, toast, a slushy |
| 11–25 | Simple everyday food and chains — pasta bake, Pret, KFC, chippy tea |
| 26–40 | World food naturalised in Britain — tikka masala, Thai green curry, kebab |
| 41–55 | Independent restaurant cooking, or ambitious cooking at home |
| 56–70 | Specialist ingredients or real skill; upmarket dining |
| 71–85 | Rare ingredients and/or near-Michelin venues |
| 86–100 | Luxury, then once-in-a-lifetime |

Cooking at home is **not** a penalty: judge the dish on its scarcity,
ingredients and effort. The restaurant distinction only separates basic meals.

Reheated takeaway **leftovers** score lower than cooking from scratch, and lower
than the same dish eaten fresh — no effort, no freshness. They belong in 11–25
whatever the dish was: Pizza Hut leftovers 14, leftover beef and black bean 18,
against 35 for that dish ordered fresh. Note "leftovers" in `exoticFood` so the
score explains itself.

## Updating episodes

`scripts/build_cards.py` scrapes the site and extracts stats with Claude.

- `--incremental` — only episodes not already in the deck
- `--episodes 322,338` — rebuild named cards
- `--photos-only` — refresh guest photos; needs no API key

The `update-cards` workflow runs this weekly and pushes.

**Do not re-scrape a hand-corrected card.** Ross Noble (447), Huge Davies (358)
and Christopher Macarthur-Boyd (494) were corrected from the episodes
themselves after the extractor returned a beer, a side dish and a video game.
`--incremental` leaves them alone; naming them in `--episodes` does not.

## Tests

`node test/cards.test.mjs` covers dealing, card conservation over full games,
and the deck-fingerprint guard that stops two players holding the same card
when their decks differ. The `update-cards` workflow runs it before pushing.
