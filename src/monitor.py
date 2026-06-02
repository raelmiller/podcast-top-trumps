"""Monitor run: poll every resolved company, filter for relevant roles, diff
against state, write a digest, and notify on anything new."""
from __future__ import annotations
import datetime as dt
import json
import os
import smtplib
from email.mime.text import MIMEText
from pathlib import Path

import requests
import yaml

from . import ats as ats_mod
from . import discover as discover_mod
from . import filters as filt

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DOCS = ROOT / "docs"
PRUNE_DAYS = 90
NOW = dt.datetime.now(dt.timezone.utc)


def _load_yaml(p):
    return yaml.safe_load(Path(p).read_text())


def gather():
    roles = _load_yaml(ROOT / "config" / "roles.yaml")
    resolved_path = DATA / "resolved.json"
    if not resolved_path.exists():
        print("No data/resolved.json - running discovery first.")
        discover_mod.run()
    resolved = json.loads(resolved_path.read_text())

    matches = []
    for name, r in resolved.items():
        if not r.get("token"):
            continue
        jobs = ats_mod.fetch(r["ats"], r["token"], company=name, company_tier=r.get("tier", ""))
        for j in jobs:
            ok, info = filt.classify(j, roles)
            if ok:
                j.update(info)
                matches.append(j)
    matches.sort(key=lambda m: (m.get("company_tier", "Z"), m.get("role_priority", 9), m["title"]))
    return matches


def diff_state(matches):
    state_path = DATA / "state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    current_ids = {m["id"] for m in matches}

    new = [m for m in matches if m["id"] not in state]
    for m in matches:
        rec = state.get(m["id"], {"first_seen": NOW.isoformat()})
        rec["last_seen"] = NOW.isoformat()
        rec["title"], rec["company"] = m["title"], m["company"]
        state[m["id"]] = rec

    cutoff = NOW - dt.timedelta(days=PRUNE_DAYS)
    for jid in list(state):
        if jid not in current_ids:
            try:
                if dt.datetime.fromisoformat(state[jid]["last_seen"]) < cutoff:
                    del state[jid]
            except Exception:
                pass

    state_path.write_text(json.dumps(state, indent=2))
    return new


def write_digest(matches, new):
    DATA.mkdir(exist_ok=True); DOCS.mkdir(exist_ok=True)
    new_ids = {m["id"] for m in new}
    (DATA / "digest.json").write_text(json.dumps(
        {"generated": NOW.isoformat(), "total": len(matches), "new": len(new), "matches": matches}, indent=2))

    def row_md(m):
        tag = " **NEW**" if m["id"] in new_ids else ""
        loc = m["location"] or m.get("loc_note", "")
        return (f"- [{m['company_tier']}] **{m['company']}** - [{m['title']}]({m['url']}) "
                f"- {m['role_tier']} - {loc} - {m['seniority']}{tag}")

    md = [f"# Role monitor - {NOW:%Y-%m-%d %H:%M UTC}",
          f"{len(matches)} live matches, {len(new)} new since last run.\n"]
    if new:
        md.append("## New this run")
        md += [row_md(m) for m in new] + [""]
    md.append("## All current matches")
    md += [row_md(m) for m in matches]
    (DOCS / "digest.md").write_text("\n".join(md))

    rows = "".join(
        f"<tr><td>{m['company_tier']}</td><td>{m['company']}</td>"
        f"<td><a href='{m['url']}'>{m['title']}</a></td><td>{m['role_tier']}</td>"
        f"<td>{m['location'] or m.get('loc_note','')}</td><td>{m['seniority']}</td></tr>"
        for m in matches)
    (DOCS / "index.html").write_text(
        "<!doctype html><meta charset=utf-8><title>Role monitor</title>"
        "<style>body{font:14px system-ui;margin:2rem;max-width:1100px}"
        "table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e2e8f0;padding:6px 10px;text-align:left}"
        "th{background:#1e3a5f;color:#fff}</style>"
        f"<h1>Role monitor</h1><p>{NOW:%Y-%m-%d %H:%M UTC} - {len(matches)} live matches, {len(new)} new.</p>"
        "<table><tr><th>Tier</th><th>Company</th><th>Role</th><th>Type</th><th>Location</th><th>Seniority</th></tr>"
        f"{rows}</table>")
    return new_ids


def _digest_text(new):
    lines = [f"{len(new)} new relevant role(s):\n"]
    for m in new:
        lines.append(f"[{m['company_tier']}] {m['company']} - {m['title']} ({m['role_tier']}, "
                     f"{m['location'] or 'location?'})\n  {m['url']}")
    return "\n".join(lines)


def notify(new):
    if not new:
        print("No new matches; no notifications sent.")
        return
    body = _digest_text(new)
    subject = f"[role-monitor] {len(new)} new role(s)"

    if all(os.getenv(k) for k in ("SMTP_HOST", "SMTP_USER", "SMTP_PASS", "NOTIFY_TO")):
        try:
            msg = MIMEText(body)
            msg["Subject"] = subject
            msg["From"] = os.getenv("SMTP_USER")
            msg["To"] = os.getenv("NOTIFY_TO")
            with smtplib.SMTP(os.getenv("SMTP_HOST"), int(os.getenv("SMTP_PORT", "587"))) as s:
                s.starttls(); s.login(os.getenv("SMTP_USER"), os.getenv("SMTP_PASS"))
                s.send_message(msg)
            print("Emailed digest.")
        except Exception as e:
            print(f"Email failed: {e}")

    if os.getenv("NOTIFY_GITHUB_ISSUE") == "1" and os.getenv("GITHUB_TOKEN") and os.getenv("GITHUB_REPOSITORY"):
        try:
            repo = os.getenv("GITHUB_REPOSITORY")
            r = requests.post(
                f"https://api.github.com/repos/{repo}/issues",
                headers={"Authorization": f"Bearer {os.getenv('GITHUB_TOKEN')}",
                         "Accept": "application/vnd.github+json"},
                json={"title": subject, "body": body, "labels": ["role-match"]}, timeout=20)
            print("Opened GitHub issue." if r.ok else f"GitHub issue failed: {r.status_code}")
        except Exception as e:
            print(f"GitHub issue failed: {e}")

    if os.getenv("SLACK_WEBHOOK_URL"):
        try:
            requests.post(os.getenv("SLACK_WEBHOOK_URL"), json={"text": f"*{subject}*\n{body}"}, timeout=20)
            print("Posted to Slack.")
        except Exception as e:
            print(f"Slack failed: {e}")


def main():
    matches = gather()
    new = diff_state(matches)
    write_digest(matches, new)
    notify(new)
    print(f"Done. {len(matches)} live matches, {len(new)} new.")


if __name__ == "__main__":
    main()
