"""Offline self-test. Run: python selftest.py"""
import yaml
from pathlib import Path
from src import ats, filters, discover

ROOT = Path(__file__).resolve().parent
roles = yaml.safe_load((ROOT / "config" / "roles.yaml").read_text())

gh = ats._greenhouse("acme", {"jobs": [
    {"id": 1, "title": "Revenue Operations Manager", "location": {"name": "London, UK"},
     "absolute_url": "https://x/1", "updated_at": "2026-05-01", "departments": [{"name": "GTM"}]},
]})
assert gh[0]["title"] == "Revenue Operations Manager" and gh[0]["location"] == "London, UK"

lv = ats._lever("acme", [
    {"id": "u1", "text": "Sales Operations Lead",
     "categories": {"location": "Remote - Europe", "department": "Revenue"},
     "hostedUrl": "https://x/u1", "createdAt": 1700000000000},
])
assert lv[0]["title"] == "Sales Operations Lead" and "Europe" in lv[0]["location"]

def mk(title, loc="London, UK"):
    return {"company": "Acme", "company_tier": "A", "ats": "greenhouse",
            "id": f"Acme:greenhouse:{title}", "title": title, "location": loc,
            "url": "https://x", "department": "", "posted": ""}

cases = {
    "Revenue Operations Manager": ("RevOps", True),
    "Head of Sales Operations": ("Sales Ops", True),
    "GTM Strategy Director": ("GTM Strategy", True),
    "Business Intelligence Analyst": ("BI / Analytics", True),
    "Deal Desk Manager": (None, False),
    "Software Engineer": (None, False),
}
for title, (tier, expected) in cases.items():
    ok, info = filters.classify(mk(title), roles)
    assert ok == expected, f"{title}: expected {expected} got {ok} ({info})"
    if ok:
        assert info["role_tier"] == tier

assert "checkoutcom" in discover.slug_candidates("Checkout.com")
assert "starling" in discover.slug_candidates("Starling Bank")

print("All self-tests passed.")
