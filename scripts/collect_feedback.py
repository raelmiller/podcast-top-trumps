#!/usr/bin/env python3
"""Copy new card corrections out of Firebase into data/feedback.json.

The game writes suggestions to the Firebase Realtime Database, which is the
only store the static site can reach without a backend. Claude Code sessions
cannot reach Firebase, so this runs on a GitHub runner and lands the
suggestions in the repo, where they can be read, reviewed and answered.

Items are only ever added here, keyed by their Firebase id, so collecting
twice is harmless and a review already recorded is never overwritten.

Usage:
    python scripts/collect_feedback.py
"""

import json
import os
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("Run: pip install requests")

# Same public database as the game client; reads need no credential.
DB_URL = os.environ.get(
    "FIREBASE_DB_URL",
    "https://wdydy-abc65-default-rtdb.firebaseio.com",
).rstrip("/")

OUT_PATH = Path(__file__).parent.parent / "data" / "feedback.json"

# Fields copied from each submission, so a change to the form cannot inject
# arbitrary keys into the stored record.
FIELDS = ("at", "episode", "guest", "field", "suggested", "reason", "from",
          "current", "deck")


def main():
    resp = requests.get(f"{DB_URL}/feedback.json", timeout=30)
    resp.raise_for_status()
    remote = resp.json() or {}
    if not isinstance(remote, dict):
        sys.exit(f"Unexpected feedback payload: {type(remote).__name__}")

    existing = []
    if OUT_PATH.exists():
        existing = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    known = {item["id"] for item in existing}

    added = 0
    for fb_id, raw in sorted(remote.items(), key=lambda kv: str(kv[1].get("at", ""))):
        if fb_id in known or not isinstance(raw, dict):
            continue
        item = {"id": fb_id, "status": "pending"}
        item.update({k: raw.get(k) for k in FIELDS})
        existing.append(item)
        added += 1
        who = raw.get("from") or "anonymous"
        print(f"  + ep {raw.get('episode')} {raw.get('guest')!r} "
              f"[{raw.get('field')}] from {who}")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(existing, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")

    pending = sum(1 for i in existing if i.get("status") == "pending")
    print(f"\n{added} new, {len(existing)} total, {pending} awaiting review")
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
