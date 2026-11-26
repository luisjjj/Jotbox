#!/usr/bin/env python3
"""Merge a Pidgin run and an English run into one combined predictions file.

The combined bench exists so a Nigerian report covers both speech modes without
paying Scribe twice. Each run keeps its own language setting; this only joins
the finished transcripts.

    python eval/golden/nigerian/combine_bench.py \
      --pidgin eval/results/scribe-pidgin-fresh-17/predictions.json \
      --english eval/results/scribe-nigerian-english/predictions.json

Then score with bench-combined.json.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
GOLDEN = ROOT / "eval/golden/nigerian"


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pidgin", type=Path, required=True)
    parser.add_argument("--english", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=ROOT / "eval/results/scribe-nigerian-combined")
    args = parser.parse_args()

    pidgin_bench = load(GOLDEN / "bench-pidgin.json")
    english_bench = load(GOLDEN / "bench-english.json")
    combined_bench = load(GOLDEN / "bench-combined.json")
    expected = {clip["id"] for clip in combined_bench["clips"]}

    pidgin = load(args.pidgin)
    english = load(args.english)
    clips = pidgin["clips"] + english["clips"]
    ids = [clip["id"] for clip in clips]
    if len(ids) != len(set(ids)):
        raise SystemExit("Duplicate clip ids across the two runs.")
    missing = expected - set(ids)
    extra = set(ids) - expected
    if missing or extra:
        raise SystemExit(f"Clip mismatch. missing={sorted(missing)} extra={sorted(extra)}")
    if len(pidgin_bench["clips"]) + len(english_bench["clips"]) != len(expected):
        raise SystemExit("bench-combined.json is out of date; rebuild it from the two bench manifests.")

    out = {
        "run": args.out.name,
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "manifest": str(GOLDEN / "bench-combined.json"),
        "variant": {"glossary": False, "normalize": False, "noNames": False, "mock": False, "language": "pcm+en"},
        "providers": {
            "transcribe": sorted({clip.get("provider") for clip in clips if clip.get("provider")}),
            "notes": [],
        },
        "clips": clips,
    }
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "predictions.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {args.out / 'predictions.json'} with {len(clips)} clips")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
