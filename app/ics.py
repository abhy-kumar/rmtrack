"""Upcoming fixtures as an iCalendar feed."""
from datetime import UTC, datetime, timedelta

STAMP = "%Y%m%dT%H%M%SZ"


def _esc(s):
    return (s or "").replace("\\", "\\\\").replace(",", "\\,").replace(";", r"\;").replace("\n", "\\n")


def calendar(name, rows, now=None):
    """VCALENDAR text for every fixture that hasn't been played yet."""
    stamp = (now or datetime.now(UTC)).strftime(STAMP)
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//rmtrack//fixtures//EN", "CALSCALE:GREGORIAN",
        f"X-WR-CALNAME:{_esc(name)}", "X-PUBLISHED-TTL:PT6H",
    ]
    for f in rows:
        if f["status"]["state"] == "post" or not f["date"]:
            continue
        start = datetime.fromisoformat(f["date"].replace("Z", "+00:00"))
        end = start + timedelta(hours=2)
        tv = f.get("tv") or []
        lines += [
            "BEGIN:VEVENT",
            f"UID:{f['id']}@rmtrack",
            f"DTSTAMP:{stamp}",
            f"DTSTART:{start.strftime(STAMP)}",
            f"DTEND:{end.strftime(STAMP)}",
            f"SUMMARY:{_esc(f['home'].get('name') + ' v ' + f['away'].get('name'))}",
            f"DESCRIPTION:{_esc(f['comp'] + (' - ' + ', '.join(tv) if tv else ''))}",
            f"LOCATION:{_esc(f.get('venue'))}",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"
