#!/usr/bin/env python3
"""Deterministic transform: raw Notion export (list of row dicts) -> public/words.json.

Usage: python3 scripts/transform.py raw/notion_export.json public/words.json [--synced-at ISO]
Raw row keys (from Notion SQL query): url, createdTime, "英文词 / 短语", "中文", "类别",
"例句或用法", "材质英文通用名".
"""
import json, re, sys, hashlib, datetime

def parse_examples(text):
    examples, usage, notes = [], [], []
    if not text:
        return examples, "", ""
    for raw in re.split(r"\n+", text.strip()):
        line = raw.strip()
        if not line:
            continue
        m = re.match(r"^(例|例句)\s*\d*\s*[：:]\s*(.*)$", line)
        if m:
            body = m.group(2).strip()
            i = body.find("（")
            if i == -1:
                i = body.find(" (")  # fallback half-width paren
            if i > 0 and body.endswith(("）", ")")):
                en, zh = body[:i].strip(), body[i+1:-1].strip()
            else:
                en, zh = body, ""
            examples.append({"en": en, "zh": zh})
            continue
        m = re.match(r"^用法\s*[：:]\s*(.*)$", line)
        if m:
            usage.append(m.group(1).strip()); continue
        notes.append(line)
    return examples, "\n".join(usage), "\n".join(notes)

def variants(term):
    base = re.sub(r"\s*[（(][^）)]*[）)]\s*", " ", term).strip()
    parts = [p.strip() for t in (term, base) for p in re.split(r"\s*/\s*", t) if p.strip()]
    if base.lower().startswith("alumin"):
        parts += [base.replace("Aluminum", "Aluminium").replace("aluminum", "aluminium")]
    return sorted(set(parts + [term.strip()]), key=len, reverse=True)

def find_hit(en, term):
    """Return the exact substring of `en` that matches the term (allowing simple inflections)."""
    for v in variants(term):
        pat = r"(?<![A-Za-z])" + re.escape(v).replace(r"\ ", r"[\s-]+").replace(r"\-", r"[\s-]?") + r"(?:s|es|d|ed|ing)?(?![A-Za-z])"
        m = re.search(pat, en, re.I)
        if m:
            return m.group(0)
        if len(v) > 4 and v.lower().endswith("e"):  # e.g. coordinate -> coordinating
            m = re.search(r"(?<![A-Za-z])" + re.escape(v[:-1]) + r"(?:ing|ed|es)(?![A-Za-z])", en, re.I)
            if m:
                return m.group(0)
        if v.lower().endswith("y"):
            m = re.search(r"(?<![A-Za-z])" + re.escape(v[:-1]) + r"ies(?![A-Za-z])", en, re.I)
            if m:
                return m.group(0)
    return None

def main():
    src, dst = sys.argv[1], sys.argv[2]
    synced = None
    if "--synced-at" in sys.argv:
        synced = sys.argv[sys.argv.index("--synced-at") + 1]
    rows = json.load(open(src, encoding="utf-8"))
    words = []
    for r in rows:
        en = (r.get("英文词 / 短语") or "").strip()
        if not en:
            continue
        exs, usage, notes = parse_examples(r.get("例句或用法") or "")
        for e in exs:
            h = find_hit(e["en"], en)
            if h:
                e["hit"] = h
        url = r.get("url") or ""
        wid = hashlib.sha1((url or en).encode()).hexdigest()[:10]
        words.append({
            "id": wid,
            "en": en,
            "zh": (r.get("中文") or "").strip(),
            "cat": (r.get("类别") or "其他").strip() or "其他",
            "examples": exs,
            "usage": usage,
            "notes": notes,
            "material": (r.get("材质英文通用名") or "").strip(),
            "created": r.get("createdTime") or "",
        })
    words.sort(key=lambda w: (w["created"], w["en"].lower()))
    out = {
        "syncedAt": synced or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Notion 英语复习词库",
        "count": len(words),
        "words": words,
    }
    json.dump(out, open(dst, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"wrote {len(words)} words -> {dst}")

if __name__ == "__main__":
    main()
