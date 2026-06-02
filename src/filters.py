"""Match normalised jobs against the role taxonomy in config/roles.yaml."""
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
    if drop_below and matched_tier["priority"] <= 2:
        if _ORDER.get(sen, 2) < _ORDER.get(drop_below, 2):
            return False, {"reason": f"below {drop_below} ({sen})"}

    loc = _lc(job.get("location", ""))
    loc_cfg = cfg.get("locations", {})
    inc = loc_cfg.get("include", [])
    if loc and inc and not any(k in loc for k in inc):
        return False, {"reason": f"location out of scope ({job.get('location','')})"}
    loc_note = "location unknown" if not loc else ""

    return True, {
        "role_tier": matched_tier["name"],
        "role_priority": matched_tier["priority"],
        "seniority": sen,
        "loc_note": loc_note,
    }
