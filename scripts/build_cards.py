#!/usr/bin/env python3
"""
Scrape episode transcripts from everythingisshowbiz.com, extract game stats
using Claude, write data/cards.json for the Top Trumps game.

Requirements:
    py -m pip install requests beautifulsoup4 anthropic

Usage:
    set ANTHROPIC_API_KEY=sk-ant-...
    py scripts/build_cards.py --limit 5
    py scripts/build_cards.py --incremental
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

try:
    import requests
    from bs4 import BeautifulSoup
    import anthropic
except ImportError:
    sys.exit("Run: py -m pip install requests beautifulsoup4 anthropic")

BASE_URL = "https://everythingisshowbiz.com"
OUT_PATH = Path(__file__).parent.parent / "data" / "cards.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

MONTHS = r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"

EXTRACT_PROMPT = """You are reading the full transcript from "What Did You Do Yesterday?" — a podcast
where a guest describes everything they did the previous day.

Extract these statistics from the transcript. For each field:
- wakeTime: the time they woke up, as decimal hours since midnight (e.g. 7.5 = 7:30am)
- exoticFood: the single most unusual, exotic, or interesting food or drink item they consumed.
  Prefer restaurant dishes, unusual cuisines, or anything memorable over everyday items.
  Use null only if absolutely no food or drink is mentioned.
- exoticScore: how exotic that food is, 1-100, judged from a mainstream BRITISH perspective.
  Weigh two things together: (a) how rare or specialised the ingredients and preparation are
  to a British eater, and (b) how expensive/high-end the place serving it is. A humble dish at
  a very good restaurant scores up; a fancy-sounding cuisine from a high-street takeaway does not.

    1-10   British staples and everyday drinks: tea, coffee, toast, cereal, beans on toast,
           chippy chips, a pint, Bacardi and Coke, supermarket sandwich, KFC, Greggs
    11-20  Ordinary home cooking and high-street chains: tuna pasta bake, roast chicken,
           Pret / Leon / Nando's, full English, meal-kit box, M&S food hall
    21-35  World food fully naturalised in Britain — the stuff on every high street:
           chicken tikka masala, Thai green curry, sweet and sour chicken balls,
           crispy duck pancakes, doner kebab, burrito, supermarket sushi, chain pizzeria.
           Cuisine does NOT score highly merely for being foreign — if a British town of
           20,000 people has a place selling it, it belongs in this band.
    36-50  Proper independent restaurant cooking, or home cooking using genuinely specialist
           ingredients: regional Italian, Turkish eggs, shakshuka, Cantabrian anchovies,
           paneer 65 at a real South Indian place, moussaka with a named wine
    51-65  Regional specialities demanding specialist ingredients or skill, or notably upmarket
           dining: hand-pulled Sichuan noodle soup, mala broth, ceremonial cacao,
           modern Italian small plates involving offal
    66-80  Rare ingredients and/or restaurants approaching Michelin standard:
           spider crab omelette at Mountain = 78, salted cod at Rovi = 72, a tasting menu = 70
    81-95  Luxury or genuinely rare: Michelin-starred tasting menu, wild game, truffle in season,
           live seafood specialities
    96-100 Once-in-a-lifetime: fugu, ortolan, ant eggs

  Use the WHOLE range and commit to the extremes. If it is a British staple, give it a
  single-digit or teens score — do not hedge toward the middle. Fewer than half of all
  episodes should land in the 20s. Integer. Use null if no food mentioned.
- transportModes: number of DISTINCT transport types used (car, tube, walk, cycle, taxi, train, plane, bus, etc). Integer.
  Only return 0 if they explicitly say they didn't leave the house.
- transportList: brief comma-separated list of the actual transport types used, e.g. "car, tube, walking". Null if none.
- bedTime: the time they went to sleep, as decimal hours since midnight. Use >24 for after midnight (e.g. 25.5 = 1:30am).
- coffees: total coffees AND teas drunk. Integer. Only return 0 if they explicitly say they had none.

Use null only if the information is genuinely absent from the transcript.

Return ONLY valid JSON, no markdown, no explanation:
{
  "wakeTime": <number or null>,
  "exoticFood": <string or null>,
  "exoticScore": <integer 1-100 or null>,
  "transportModes": <integer or null>,
  "transportList": <string or null>,
  "bedTime": <number or null>,
  "coffees": <integer or null>
}

Transcript:
"""

DEFAULTS = {"wakeTime": 7.5, "exoticFood": "home cooking", "exoticScore": 14, "transportModes": 2, "transportList": None, "bedTime": 23.0, "coffees": 2}


def extract_json_array(text, var_name):
    m = re.search(rf'{re.escape(var_name)}\s*=\s*(\[)', text)
    if not m:
        return None
    start = m.start(1)
    depth = 0
    for i, ch in enumerate(text[start:]):
        if ch == '[':
            depth += 1
        elif ch == ']':
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:start + i + 1])
                except json.JSONDecodeError:
                    return None
    return None


def fetch_episode_list(session, page=1):
    url = f"{BASE_URL}/?view=episodes&sort=relevance&page={page}"
    resp = session.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    data = extract_json_array(resp.text, "window.serverEpisodeData")
    if data:
        return data

    soup = BeautifulSoup(resp.text, "html.parser")
    episodes = []
    seen = set()
    for a in soup.find_all("a", href=re.compile(r"episode=\d+")):
        ep_id = int(re.search(r"episode=(\d+)", a["href"]).group(1))
        if ep_id in seen:
            continue
        seen.add(ep_id)
        text = a.get_text(" ", strip=True)
        episodes.append({"id": ep_id, "title": text, "episode_type": "interview"})
    return episodes


def extract_guest(title):
    m = re.search(rf'EP\d+[:\s]+(.+?)\s+{MONTHS}\s+\d', title, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    m = re.search(rf'^(.+?)\s+{MONTHS}\s+\d', title, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return title


def fetch_wikipedia_photo(name: str, session) -> str | None:
    try:
        search = session.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "list": "search",
                "srsearch": name,
                "srlimit": 1,
                "srnamespace": 0,
                "format": "json",
            },
            headers=HEADERS,
            timeout=10,
        )
        search.raise_for_status()
        results = search.json().get("query", {}).get("search", [])
        page_title = results[0]["title"] if results else name

        img = session.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "titles": page_title,
                "prop": "pageimages",
                "format": "json",
                "pithumbsize": 400,
                "redirects": 1,
            },
            headers=HEADERS,
            timeout=10,
        )
        img.raise_for_status()
        pages = img.json().get("query", {}).get("pages", {})
        for page in pages.values():
            src = page.get("thumbnail", {}).get("source")
            if src:
                return src
    except Exception:
        pass
    return None


def fetch_episode_page(session, episode_id):
    url = f"{BASE_URL}/?view=episodes&episode={episode_id}"
    resp = session.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    segments = []
    for item in soup.find_all("div", class_="segment-item"):
        text_div = item.find("div", class_=lambda c: c and "text-sm" in c and "text-gray-700" in c)
        if text_div:
            segments.append(text_div.get_text(" ", strip=True))

    if not segments:
        for div in soup.find_all("div", class_=lambda c: c and "text-sm" in c and "text-gray-700" in c):
            text = div.get_text(" ", strip=True)
            if len(text) > 20:
                segments.append(text)

    transcript = " ".join(segments)

    photo = None
    og = soup.find("meta", property="og:image")
    if og:
        photo = og.get("content")

    return transcript, photo


def extract_stats(transcript: str, client: anthropic.Anthropic) -> dict:
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=300,
        messages=[{"role": "user", "content": EXTRACT_PROMPT + transcript}],
    )
    raw = msg.content[0].text.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    if not raw:
        raise ValueError("Empty response from Claude")
    return json.loads(raw)


def should_skip(ep: dict) -> bool:
    title = ep.get("title", "").upper()
    ep_type = ep.get("episode_type", "")
    return (
        ep_type == "midweek_mayhem"
        or "WDWDY" in title
        or "BREAKING NEWS" in title
        or "CHRISTMAS" in title
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="Max episodes to process (0 = all)")
    parser.add_argument("--incremental", action="store_true", help="Skip already-processed episodes")
    parser.add_argument("--pages", type=int, default=4, help="Listing pages to fetch (default 4)")
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        sys.exit("Set ANTHROPIC_API_KEY environment variable")

    client = anthropic.Anthropic(api_key=api_key)
    session = requests.Session()

    existing = {}
    if args.incremental and OUT_PATH.exists():
        for card in json.loads(OUT_PATH.read_text()):
            existing[card["episode"]] = card
        print(f"Loaded {len(existing)} existing cards")

    print("Fetching episode list...")
    all_episodes = []
    for page in range(1, args.pages + 1):
        print(f"  Page {page}...")
        eps = fetch_episode_list(session, page)
        all_episodes.extend(eps)
        time.sleep(1)

    interview_eps = [e for e in all_episodes if not should_skip(e)]
    print(f"Found {len(all_episodes)} total, {len(interview_eps)} to consider")

    cards = list(existing.values()) if args.incremental else []
    processed = 0

    for ep in interview_eps:
        ep_id = ep["id"]
        raw_title = ep.get("title", f"Episode {ep_id}")
        guest = extract_guest(raw_title)

        if args.incremental and ep_id in existing:
            continue

        if args.limit and processed >= args.limit:
            break

        print(f"Processing ep {ep_id}: {guest}")

        try:
            transcript, og_photo = fetch_episode_page(session, ep_id)
        except Exception as e:
            print(f"  Failed to fetch page: {e}")
            time.sleep(2)
            continue

        if len(transcript) < 5000:
            print(f"  Skipping — too short ({len(transcript)} chars)")
            continue

        print(f"  Transcript: {len(transcript)} chars")

        photo = fetch_wikipedia_photo(guest, session)
        if photo:
            print(f"  Photo: Wikipedia")
        elif og_photo:
            photo = og_photo
            print(f"  Photo: og:image")
        else:
            print(f"  Photo: none")

        try:
            stats = extract_stats(transcript, client)
        except Exception as e:
            print(f"  Stats extraction failed: {e}")
            time.sleep(2)
            continue

        card = {"id": ep_id, "episode": ep_id, "guest": guest, "photo": photo, **stats}
        for k, v in DEFAULTS.items():
            if card.get(k) is None:
                card[k] = v

        cards.append(card)
        print(f"  {stats}")
        processed += 1
        time.sleep(1.5)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    cards.sort(key=lambda c: c["episode"])
    OUT_PATH.write_text(json.dumps(cards, indent=2))
    print(f"\nWrote {len(cards)} cards to {OUT_PATH}")


if __name__ == "__main__":
    main()
