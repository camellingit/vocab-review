#!/usr/bin/env python3
"""Generate en-GB-RyanNeural MP3s for every string the app speaks.

Usage (from the vocab-app root):
  /home/box/tts-venv/bin/python scripts/gen_audio.py
  /home/box/tts-venv/bin/python scripts/gen_audio.py --words public/words.json --outdir public/audio

Reads public/words.json, writes:
  public/audio/<sha1(voice+tts_text)[:12]>.mp3
  public/audio/index.json   (maps original text -> filename)

Spoken texts (must stay in sync with public/app.js):
  - each word's `en`
  - each example's `en`

TTS text is normalized the same way app.js used to feed speechSynthesis:
  slashes become commas, parentheses are stripped.
Incremental: existing non-empty mp3s are skipped. Orphan mp3s are deleted.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import sys
import time
from pathlib import Path

VOICE = "en-GB-RyanNeural"
CONCURRENCY = 4
RETRIES = 3
INDEX_NAME = "index.json"

ROOT = Path(__file__).resolve().parent.parent


def tts_text(raw: str) -> str:
    """Match app.js: replace / with comma, strip parentheses, collapse space."""
    s = re.sub(r"\s*/\s*", ", ", raw)
    s = re.sub(r"[()（）]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def audio_hash(spoken: str) -> str:
    return hashlib.sha1(f"{VOICE}\0{spoken}".encode("utf-8")).hexdigest()[:12]


def collect_texts(words_path: Path) -> list[str]:
    data = json.loads(words_path.read_text(encoding="utf-8"))
    words = data.get("words") or []
    seen: dict[str, None] = {}
    for w in words:
        en = (w.get("en") or "").strip()
        if en:
            seen.setdefault(en, None)
        for ex in w.get("examples") or []:
            ex_en = (ex.get("en") or "").strip()
            if ex_en:
                seen.setdefault(ex_en, None)
    return list(seen)


async def synthesize(text: str, dest: Path, sem: asyncio.Semaphore) -> None:
    import edge_tts

    tmp = dest.with_suffix(dest.suffix + ".tmp")
    last_err: Exception | None = None
    async with sem:
        for attempt in range(1, RETRIES + 1):
            try:
                if tmp.exists():
                    tmp.unlink()
                communicate = edge_tts.Communicate(text, VOICE)
                await communicate.save(str(tmp))
                if not tmp.exists() or tmp.stat().st_size < 200:
                    raise RuntimeError(f"empty or tiny output ({tmp.stat().st_size if tmp.exists() else 0} bytes)")
                tmp.replace(dest)
                return
            except Exception as e:
                last_err = e
                if tmp.exists():
                    try:
                        tmp.unlink()
                    except OSError:
                        pass
                await asyncio.sleep(0.8 * attempt)
        raise RuntimeError(f"failed after {RETRIES} tries: {last_err}")


async def run(words_path: Path, outdir: Path) -> int:
    texts = collect_texts(words_path)
    outdir.mkdir(parents=True, exist_ok=True)

    jobs: list[tuple[str, str, Path]] = []  # raw, spoken, dest
    index: dict[str, str] = {}
    skipped = 0
    for raw in texts:
        spoken = tts_text(raw) or raw
        name = audio_hash(spoken) + ".mp3"
        dest = outdir / name
        index[raw] = name
        if dest.exists() and dest.stat().st_size >= 200:
            skipped += 1
        else:
            jobs.append((raw, spoken, dest))

    # Deduplicate generate jobs that share the same dest (same spoken text)
    uniq: dict[Path, str] = {}
    for raw, spoken, dest in jobs:
        uniq.setdefault(dest, spoken)
    unique_jobs = list(uniq.items())

    print(f"texts: {len(texts)}  unique audio: {len(set(index.values()))}  "
          f"to generate: {len(unique_jobs)}  skip existing: {skipped}")

    sem = asyncio.Semaphore(CONCURRENCY)
    ok = 0
    failed: list[tuple[Path, str]] = []
    t0 = time.time()

    async def one(dest: Path, spoken: str) -> None:
        nonlocal ok
        try:
            await synthesize(spoken, dest, sem)
            ok += 1
            if ok % 25 == 0 or ok == len(unique_jobs):
                elapsed = time.time() - t0
                print(f"  generated {ok}/{len(unique_jobs)}  ({elapsed:.1f}s)", flush=True)
        except Exception as e:
            failed.append((dest, f"{spoken[:80]}…  {e}" if len(spoken) > 80 else f"{spoken}  {e}"))

    if unique_jobs:
        await asyncio.gather(*(one(dest, spoken) for dest, spoken in unique_jobs))

    if failed:
        print(f"FAILED {len(failed)}:", file=sys.stderr)
        for dest, msg in failed:
            print(f"  {dest.name}: {msg}", file=sys.stderr)
        # Drop failed entries from the index so the app falls back to speechSynthesis
        failed_names = {dest.name for dest, _ in failed}
        index = {k: v for k, v in index.items() if v not in failed_names}

    # Delete orphaned mp3s (not in the new index, and not tmp)
    keep = set(index.values())
    removed = 0
    for p in outdir.glob("*.mp3"):
        if p.name not in keep:
            p.unlink()
            removed += 1
    for p in outdir.glob("*.tmp"):
        p.unlink()
        removed += 1

    payload = {
        "voice": VOICE,
        "count": len(index),
        "files": index,
    }
    (outdir / INDEX_NAME).write_text(
        json.dumps(payload, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )

    mp3s = list(outdir.glob("*.mp3"))
    total = sum(p.stat().st_size for p in mp3s)
    print(
        f"wrote {len(mp3s)} mp3s + {INDEX_NAME} -> {outdir}  "
        f"({total / 1024 / 1024:.2f} MB)  new={ok}  failed={len(failed)}  orphans_removed={removed}"
    )
    return 1 if failed else 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate RyanNeural MP3s for the vocab app.")
    ap.add_argument("--words", type=Path, default=ROOT / "public" / "words.json")
    ap.add_argument("--outdir", type=Path, default=ROOT / "public" / "audio")
    args = ap.parse_args()
    words_path = args.words.resolve()
    outdir = args.outdir.resolve()
    if not words_path.is_file():
        print(f"words.json not found: {words_path}", file=sys.stderr)
        return 2
    return asyncio.run(run(words_path, outdir))


if __name__ == "__main__":
    sys.exit(main())
