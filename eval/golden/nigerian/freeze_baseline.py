#!/usr/bin/env python3
"""Freeze the latest Scribe predictions into the committed regression baseline.

The baseline is text only. It lets CI check corrections, number folding and
thresholds without downloading audio or spending paid reader time.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent

SETS = {
    "english": ("bench-english.json", "eval/results/scribe-nigerian-english/predictions.json"),
    "pidgin": ("bench-pidgin.json", "eval/results/scribe-pidgin-fresh-17/predictions.json"),
    "combined": ("bench-combined.json", "eval/results/scribe-nigerian-combined/predictions.json"),
}


def freeze(name: str, manifest_name: str, predictions_path: str, out_dir: Path) -> Path:
    manifest = json.loads((HERE / manifest_name).read_text(encoding="utf-8"))
    predictions = json.loads((ROOT / predictions_path).read_text(encoding="utf-8"))
    by_id = {clip.get("id"): clip for clip in predictions.get("clips", [])}
    clips = []
    missing = []
    for clip in manifest.get("clips", []):
        found = by_id.get(clip.get("id"))
        if not found or found.get("status") != "ok":
            missing.append(clip.get("id"))
            continue
        clips.append(
            {
                "id": clip["id"],
                "category": clip.get("category") or found.get("category") or "",
                "transcript": found.get("transcript") or "",
            }
        )
    if missing:
        raise SystemExit(f"{name}: no Scribe transcript for {', '.join(missing[:5])}")
    frozen_at = str(predictions.get("startedAt") or "")[:10]
    payload = {
        "set": name,
        "manifest": manifest_name,
        "reader": "scribe_v3",
        "frozenAt": frozen_at,
        "clips": clips,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{name}.json"
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description="Freeze Scribe predictions as the regression baseline.")
    parser.add_argument("--out", type=Path, default=HERE / "baseline")
    parser.add_argument("--set", choices=[*SETS, "all"], default="all")
    args = parser.parse_args()
    names = list(SETS) if args.set == "all" else [args.set]
    for name in names:
        manifest_name, predictions_path = SETS[name]
        target = freeze(name, manifest_name, predictions_path, args.out)
        print(f"wrote {target.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
