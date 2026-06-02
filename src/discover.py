"""Resolve which ATS each company uses and its board token, by probing."""
from __future__ import annotations
import json
import re
import sys
import time
from pathlib import Path

import yaml

from . import ats as ats_mod

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PROBE_ORDER = ["greenhouse", "lever", "ashby", "smartrecruiters", "workable", "recruitee", "personio"]
SUFFIXES = ("bank", "labs", "ai", "io", "hq", "app", "inc", "ltd", "group")


def slug_candidates(name):
    base = name.strip().lower()
    cands = []

    def add(s):
        s = re.sub(r"[^a-z0-9]", "", s)
        if s and s not in cands:
            cands.append(s)

    add(base)
    add(base.replace(" ", "-"))
    add(base.replace(" ", ""))
    add(base.replace("&", "and"))
    add(base.replace(".", ""))
    words = re.sub(r"[^a-z0-9 ]", "", base).split()
    if len(words) > 1 and words[-1] in SUFFIXES:
        add(" ".join(words[:-1]))
    if words:
        add(words[0])
    return cands


def resolve_one(name, override_ats=None, override_token=None, pause=0.4):
    if override_ats and override_token:
        jobs = ats_mod.fetch(override_ats, override_token, name)
        return {"ats": override_ats, "token": override_token, "jobs": len(jobs), "source": "override"}

    best = None
    cands = slug_candidates(name)
    probe = [override_ats] if override_ats else PROBE_ORDER
    for ats in probe:
        for token in cands:
            try:
                jobs = ats_mod.fetch(ats, token, name)
            except Exception:
                jobs = []
            if jobs:
                if best is None or len(jobs) > best["jobs"]:
                    best = {"ats": ats, "token": token, "jobs": len(jobs), "source": "probe"}
            time.sleep(pause)
        if best:
            break
    return best


def run(companies_path=None):
    companies_path = companies_path or (ROOT / "config" / "companies.yaml")
    companies = yaml.safe_load(Path(companies_path).read_text())["companies"]
    DATA.mkdir(exist_ok=True)
    out_path = DATA / "resolved.json"
    resolved = json.loads(out_path.read_text()) if out_path.exists() else {}

    unresolved = []
    for c in companies:
        name = c["name"]
        if name in resolved and resolved[name].get("token") and not c.get("force_rediscover"):
            continue
        r = resolve_one(name, c.get("ats"), c.get("token"))
        if r:
            r["tier"] = c.get("tier", "")
            resolved[name] = r
            print(f"  resolved  {name:24s} -> {r['ats']}:{r['token']} ({r['jobs']} jobs)")
        else:
            unresolved.append(name)
            print(f"  unresolved {name:24s} (likely Workday / bespoke - add manually)")

    out_path.write_text(json.dumps(resolved, indent=2))
    print(f"\nResolved {len(resolved)} companies. Unresolved: {len(unresolved)}")
    if unresolved:
        (DATA / "unresolved.txt").write_text("\n".join(unresolved))
    return resolved, unresolved


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else None)
