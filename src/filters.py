"""Match normalised jobs against the role taxonomy in config/roles.yaml.

A job passes if: no exclude term hits the title, at least one tier's include
term hits the title, and (optionally) the location and seniority pass. Each
match carries the role tier it hit and a short reason, so the digest is
transparent and the rules are easy to tune.
"""
from __future__ import annotations


def _lc(s):
    return (s or "").lower()


def seniority_of(title, sen_cfg):
    t = _lc(title)
    if any(k in t for k in sen_cfg.get("director_plus", [])):
        return "director+"
    if any(k in t for k in sen_cfg.get("manager", [])):
        return "manager"
    if any(k in t for k in sen_cfg.get("ic", [])):
        return "senior/IC"
    return "unspecified"


_ORDER = {"director+": 3, "manager": 2, "senior/IC": 1, "unspecified": 2}


def classify(job, cfg):
    """Return (matched: bool, info: dict)."""
    title = _lc(job["title"])

    for term in cfg.get("exclude", []):
        if term in title:
            return False, {"reason": f"excluded ({term})"}

    matched_tier = None
    for tier in sorted(cfg["tiers"], key=lambda x: x["priority"]):
        if any(term in title for term in tier["include"]):
            matched_tier = tier
            break
    if not matched_tier:
        return False, {"reason": "no role-tier match"}

    sen = seniority_of(job["title"], cfg.get("seniority", {}))
    drop_below = cfg.get("drop_below", "")
    if drop_below and matched_tier["priority"] <= 2:  # only gate RevOps / Sales Ops
        if _ORDER.get(sen, 2) < _ORDER.get(drop_below, 2):
            return False, {"reason": f"below {drop_below} ({sen})"}

    loc = _lc(job.get("location", ""))
    loc_cfg = cfg.get("locations", {})
    exc_loc = loc_cfg.get("exclude", [])
    if loc and any(k in loc for k in exc_loc):
        return False, {"reason": f"location excluded ({job.get('location','')})"}
    inc = loc_cfg.get("include", [])
    if loc and inc and not any(k in loc for k in inc):
        return False, {"reason": f"location out of scope ({job.get('location','')})"}
    # When location is blank, also check the title for obvious non-UK geographic signals
    if not loc and exc_loc:
        title_geo_terms = [
            "amer", "americas", " us ", "(us)", "- us", "u.s.", "apac", " sg",
            ", sg", "anz", " au ", "australia", "singapore", "korea", "japan",
            "china", " cn ", "latam", "east coast", "west coast",
        ]
        if any(t in title for t in title_geo_terms):
            return False, {"reason": f"title geo-signal excluded ({job['title']})"}
    loc_note = "location unknown" if not loc else ""

    return True, {
        "role_tier": matched_tier["name"],
        "role_priority": matched_tier["priority"],
        "seniority": sen,
        "loc_note": loc_note,
    }
