"""ATS pollers.

Each public applicant tracking system exposes an unauthenticated job feed.
We hit the structured endpoint per company rather than scraping careers pages,
then normalise every posting into one shape:

    {company, company_tier, ats, id, title, location, url, department, posted}

`id` is globally unique: "{company}:{ats}:{external_id}" so dedup is clean
even if two companies share an external id.
"""
from __future__ import annotations
import xml.etree.ElementTree as ET
import requests

TIMEOUT = 20
HEADERS = {"User-Agent": "role-monitor/1.0 (personal job-search tool)"}

ENDPOINTS = {
    "greenhouse":     "https://boards-api.greenhouse.io/v1/boards/{t}/jobs?content=true",
    "lever":          "https://api.lever.co/v0/postings/{t}?mode=json",
    "ashby":          "https://api.ashbyhq.com/posting-api/job-board/{t}?includeCompensation=true",
    "smartrecruiters":"https://api.smartrecruiters.com/v1/companies/{t}/postings?limit=100",
    "workable":       "https://apply.workable.com/api/v1/widget/accounts/{t}",
    "recruitee":      "https://{t}.recruitee.com/api/offers/",
    "personio":       "https://{t}.jobs.personio.de/xml?language=en",
}


def _get(url):
    r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    return r


def _loc_from_parts(*parts):
    return ", ".join(str(p) for p in parts if p)


def _greenhouse(token, data):
    out = []
    for j in data.get("jobs", []):
        out.append(dict(
            ext=str(j.get("id")),
            title=j.get("title", ""),
            location=(j.get("location") or {}).get("name", ""),
            url=j.get("absolute_url", ""),
            department=", ".join(d.get("name", "") for d in j.get("departments", [])),
            posted=j.get("updated_at", "") or j.get("first_published", ""),
        ))
    return out


def _lever(token, data):
    out = []
    for j in data:
        cats = j.get("categories", {}) or {}
        out.append(dict(
            ext=str(j.get("id")),
            title=j.get("text", ""),
            location=cats.get("location", ""),
            url=j.get("hostedUrl", "") or j.get("applyUrl", ""),
            department=cats.get("department", "") or cats.get("team", ""),
            posted=str(j.get("createdAt", "")),
        ))
    return out


def _ashby(token, data):
    out = []
    for j in data.get("jobs", []):
        out.append(dict(
            ext=str(j.get("id")),
            title=j.get("title", ""),
            location=j.get("location", "") or "",
            url=j.get("jobUrl", "") or j.get("applyUrl", "") or j.get("jobPostingUrl", ""),
            department=j.get("department", "") or j.get("team", ""),
            posted=j.get("publishedAt", "") or j.get("updatedAt", ""),
        ))
    return out


def _smartrecruiters(token, data):
    out = []
    for j in data.get("content", []):
        loc = j.get("location", {}) or {}
        ext = str(j.get("id"))
        out.append(dict(
            ext=ext,
            title=j.get("name", ""),
            location=_loc_from_parts(loc.get("city"), loc.get("region"), loc.get("country"))
                     + (" (remote)" if loc.get("remote") else ""),
            url=f"https://jobs.smartrecruiters.com/{token}/{ext}",
            department=(j.get("department") or {}).get("label", "") if isinstance(j.get("department"), dict) else "",
            posted=j.get("releasedDate", "") or j.get("createdOn", ""),
        ))
    return out


def _workable(token, data):
    out = []
    for j in data.get("jobs", []):
        loc = j.get("location", {}) or {}
        if isinstance(loc, dict):
            location = _loc_from_parts(loc.get("city"), loc.get("region"), loc.get("country"))
            if loc.get("telecommuting") or loc.get("workplace") == "remote":
                location += " (remote)"
        else:
            location = str(loc)
        shortcode = j.get("shortcode", "")
        out.append(dict(
            ext=str(shortcode or j.get("id", "")),
            title=j.get("title", ""),
            location=location,
            url=j.get("url", "") or f"https://apply.workable.com/{token}/j/{shortcode}/",
            department=j.get("department", "") or "",
            posted=j.get("published_on", "") or j.get("created_at", ""),
        ))
    return out


def _recruitee(token, data):
    out = []
    for j in data.get("offers", []):
        out.append(dict(
            ext=str(j.get("id")),
            title=j.get("title", ""),
            location=j.get("location", "") or _loc_from_parts(j.get("city"), j.get("country_code")),
            url=j.get("careers_url", "") or j.get("careers_apply_url", ""),
            department=j.get("department", "") or "",
            posted=j.get("published_at", "") or j.get("created_at", ""),
        ))
    return out


def _personio(token, raw_text):
    out = []
    root = ET.fromstring(raw_text)
    for pos in root.iter("position"):
        def g(tag):
            el = pos.find(tag)
            return el.text.strip() if el is not None and el.text else ""
        ext = g("id")
        out.append(dict(
            ext=ext,
            title=g("name"),
            location=g("office"),
            url=f"https://{token}.jobs.personio.de/job/{ext}",
            department=g("department") or g("recruitingCategory"),
            posted=g("createdAt"),
        ))
    return out


NORMALISERS = {
    "greenhouse": _greenhouse, "lever": _lever, "ashby": _ashby,
    "smartrecruiters": _smartrecruiters, "workable": _workable,
    "recruitee": _recruitee, "personio": _personio,
}


def fetch(ats, token, company="", company_tier=""):
    """Poll one company's ATS feed and return normalised jobs (or [] on failure)."""
    ats = ats.lower()
    if ats not in ENDPOINTS:
        return []
    url = ENDPOINTS[ats].format(t=token)
    try:
        resp = _get(url)
        payload = resp.text if ats == "personio" else resp.json()
        rows = NORMALISERS[ats](token, payload)
    except Exception:
        return []
    jobs = []
    for r in rows:
        if not r.get("title"):
            continue
        jobs.append(dict(
            company=company or token,
            company_tier=company_tier,
            ats=ats,
            id=f"{company or token}:{ats}:{r['ext']}",
            title=r["title"].strip(),
            location=(r.get("location") or "").strip(),
            url=r.get("url", ""),
            department=(r.get("department") or "").strip(),
            posted=str(r.get("posted") or ""),
        ))
    return jobs
