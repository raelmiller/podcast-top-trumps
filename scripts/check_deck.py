#!/usr/bin/env python3
"""Refuse a deck that would break the site.

A deploy once pushed cards.json with merge conflict markers still in it, which
is not valid JSON, so the site could not build. Run this before publishing.

Usage:
    python scripts/check_deck.py data/cards.json
"""

import json
import sys
from pathlib import Path

REQUIRED = ("id", "episode", "guest", "exoticScore")


def main():
    if len(sys.argv) != 2:
        sys.exit("Usage: check_deck.py <path to cards.json>")
    path = Path(sys.argv[1])
    if not path.exists():
        sys.exit(f"ERROR: {path} does not exist")

    text = path.read_text(encoding="utf-8")
    for marker in ("<<<<<<<", "=======", ">>>>>>>"):
        if any(line.startswith(marker) for line in text.splitlines()):
            sys.exit(
                f"ERROR: {path} still contains merge conflict markers ({marker}).\n"
                "Resolve the conflict before deploying — publishing this would\n"
                "break the site build."
            )

    try:
        cards = json.loads(text)
    except json.JSONDecodeError as e:
        sys.exit(f"ERROR: {path} is not valid JSON — {e}")

    if not isinstance(cards, list) or not cards:
        sys.exit(f"ERROR: {path} should be a non-empty list of cards")

    ids = []
    for i, card in enumerate(cards):
        if not isinstance(card, dict):
            sys.exit(f"ERROR: card {i} is not an object")
        missing = [k for k in REQUIRED if card.get(k) is None]
        if missing:
            sys.exit(f"ERROR: card {i} ({card.get('guest')!r}) is missing {missing}")
        ids.append(card["id"])

    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        sys.exit(f"ERROR: duplicate episode ids: {sorted(dupes)}")

    photos = sum(1 for c in cards if c.get("photo"))
    print(f"Deck OK — {len(cards)} cards, {photos} with photos")


if __name__ == "__main__":
    main()
