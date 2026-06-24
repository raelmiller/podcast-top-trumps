#!/usr/bin/env python3
"""
Fetch the podcast RSS, transcribe episodes with Whisper, extract game stats
with Claude, and write data/cards.json for the Top Trumps game.

Requirements:
    pip install feedparser requests openai-whisper anthropic

Usage:
    export ANTHROPIC_API_KEY=sk-ant-...
    python scripts/build_cards.py

    # Only (re)process episodes not already in cards.json:
    python scripts/build_cards.py --incremental

    # Limit to the 10 most recent episodes:
    python scripts/build_cards.py --limit 10
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import feedparser
    import requests
    import anthropic
except ImportError:
    sys.exit("Run: pip install feedparser requests anthropic")

RSS_URL = "https://feeds.acast.com/public/shows/what-did-you-do-yesterday"
OUT_PATH = Path(__file__).parent.parent / "data" / "cards.json"

EXTRACT_PROMPT = """
You are analysing a transcript from "What Did You Do Yesterday?" — a podcast
where a guest describes everything they did the previous day.

Extract the following statistics as accurately as possible from the transcript.
If a value is not mentioned or cannot be estimated, use null.

Return ONLY valid JSON matching this schema (no markdown, no commentary):
{
  "wakeTime": <decimal hours since midnight, e.g. 7.5 for 7:30am>,
  "calories": <estimated total kcal consumed that day, integer>,
  "transportModes": <number of distinct transport modes used, integer>,
  "bedTime": <decimal hours since midnight; use >24 for after midnight, e.g. 25.5 for 1:30am>,
  "coffees": <number of coffees or teas drunk, integer>
}

Transcript:
"""


def fetch_feed(limit):
    feed = feedparser.parse(RSS_URL)
    entries = feed.entries
    if limit:
        entries = entries[:limit]
    return entries


def transcribe(audio_url: str, ep_num: int) -> str:
    print(f"  Downloading audio for ep {ep_num}…")
    with tempfile.TemporaryDirectory() as tmp:
        mp3 = os.path.join(tmp, "episode.mp3")
        r = requests.get(audio_url, stream=True, timeout=60)
        r.raise_for_status()
        with open(mp3, "wb") as f:
            for chunk in r.iter_content(chunk_size=65536):
                f.write(chunk)
        print(f"  Transcribing ep {ep_num} with Whisper (this takes a while)…")
        result = subprocess.run(
            ["whisper", mp3, "--model", "base", "--output_format", "txt",
             "--output_dir", tmp, "--fp16", "False"],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            print(f"  Whisper error: {result.stderr}")
            return ""
        txt_path = os.path.join(tmp, "episode.txt")
        return Path(txt_path).read_text(encoding="utf-8") if os.path.exists(txt_path) else ""


def extract_stats(transcript: str, client: anthropic.Anthropic) -> dict:
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=256,
        messages=[{"role": "user", "content": EXTRACT_PROMPT + transcript[:12000]}],
    )
    raw = msg.content[0].text.strip()
    return json.loads(raw)


def parse_episode_number(entry) -> int:
    # Try itunes:episode tag first, then fall back to parsing the title
    num = getattr(entry, "itunes_episode", None)
    if num:
        try:
            return int(num)
        except (ValueError, TypeError):
            pass
    import re
    m = re.search(r'\b(\d+)\b', entry.get("title", ""))
    return int(m.group(1)) if m else 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="Max episodes to process (0 = all)")
    parser.add_argument("--incremental", action="store_true", help="Skip episodes already in cards.json")
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        sys.exit("Set ANTHROPIC_API_KEY environment variable")

    client = anthropic.Anthropic(api_key=api_key)

    existing = {}
    if args.incremental and OUT_PATH.exists():
        for card in json.loads(OUT_PATH.read_text()):
            existing[card["episode"]] = card

    print(f"Fetching RSS feed from {RSS_URL}…")
    entries = fetch_feed(args.limit or None)
    print(f"Found {len(entries)} episodes")

    cards = list(existing.values()) if args.incremental else []

    for entry in entries:
        ep_num = parse_episode_number(entry)
        guest = entry.get("itunes_author") or entry.get("author") or entry.get("title", "Unknown")
        audio_url = next(
            (l["href"] for l in entry.get("links", []) if l.get("type", "").startswith("audio")),
            None
        )

        if "WDWDY" in entry.get("title", ""):
            print(f"Skipping ep {ep_num} — WDWDY episode")
            continue

        if not audio_url:
            print(f"Skipping ep {ep_num} — no audio link found")
            continue

        if args.incremental and ep_num in existing:
            print(f"Skipping ep {ep_num} — already processed")
            continue

        print(f"\nProcessing ep {ep_num}: {guest}")
        transcript = transcribe(audio_url, ep_num)
        if not transcript:
            print(f"  No transcript, skipping")
            continue

        try:
            stats = extract_stats(transcript, client)
        except (json.JSONDecodeError, Exception) as e:
            print(f"  Failed to extract stats: {e}")
            continue

        photo = getattr(entry, "image", {}).get("href") or None
        card = {"id": ep_num, "episode": ep_num, "guest": guest, "photo": photo, **stats}
        # Replace nulls with sensible defaults so the game doesn't break
        defaults = {"wakeTime": 7.5, "calories": 2000, "transportModes": 2, "bedTime": 23.0, "coffees": 2}
        for k, v in defaults.items():
            if card.get(k) is None:
                card[k] = v

        cards.append(card)
        print(f"  Stats: {stats}")

    cards.sort(key=lambda c: c["episode"])
    OUT_PATH.write_text(json.dumps(cards, indent=2))
    print(f"\nWrote {len(cards)} cards to {OUT_PATH}")


if __name__ == "__main__":
    main()
