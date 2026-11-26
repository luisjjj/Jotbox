#!/usr/bin/env python3
"""Build a small clips pack from a FLEURS language split.

FLEURS is public and carries Igbo, Yoruba and Hausa for Nigeria. Its audio is
packed in large parquet/tar files, so this reads the test parquet and extracts
only the rows it picks. One manifest per language, because the JotBox runner
takes a single language code per run.

    python eval/sandbox/prepare_fleurs_sample.py --language ig_ng --count 2
    python eval/sandbox/prepare_fleurs_sample.py --language yo_ng --count 2
    python eval/sandbox/prepare_fleurs_sample.py --language ha_ng --count 2

Audio and manifests land in eval/.cache/, which is gitignored.

References keep their tone marks. A reader that drops diacritics will score
worse here than one that keeps them, so compare models against each other
rather than treating the number as absolute accuracy.
"""

from __future__ import annotations

import argparse
import io
import json
from pathlib import Path

import pyarrow.parquet as pq
import soundfile as sf
from huggingface_hub import hf_hub_download

CATEGORY = {"ig_ng": "igbo", "yo_ng": "yoruba", "ha_ng": "hausa"}
LANGUAGE = {"ig_ng": "ig", "yo_ng": "yo", "ha_ng": "ha"}


def audio_bytes(value) -> bytes | None:
    if isinstance(value, dict):
        return value.get("bytes")
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--language", required=True, choices=sorted(CATEGORY))
    parser.add_argument("--count", type=int, default=2)
    parser.add_argument("--min-seconds", type=float, default=7)
    parser.add_argument("--max-seconds", type=float, default=11)
    parser.add_argument("--out", default="")
    parser.add_argument("--cache", default="eval/.cache/fleurs-parquet")
    args = parser.parse_args()

    out = Path(args.out or f"eval/.cache/fleurs-{args.language}")
    audio_dir = out / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    parquet = Path(
        hf_hub_download(
            "google/fleurs",
            f"parquet-data/{args.language}/test-00000-of-00001.parquet",
            repo_type="dataset",
            local_dir=args.cache,
        )
    )

    candidates = []
    seen = set()
    row_index = 0
    para = pq.ParquetFile(parquet)
    for batch in para.iter_batches(batch_size=32):
        for item in batch.to_pylist():
            index = row_index
            row_index += 1
            reference = (item.get("transcription") or "").strip()
            payload = audio_bytes(item.get("audio"))
            if not reference or not payload or reference.lower() in seen:
                continue
            samples = int(item.get("num_samples") or 0)
            if not samples:
                continue
            seconds = samples / 16000
            if seconds < args.min_seconds or seconds > args.max_seconds:
                continue
            seen.add(reference.lower())
            candidates.append((index, reference, payload, seconds, item.get("filename")))

    if not candidates:
        raise SystemExit(f"No FLEURS rows between {args.min_seconds}s and {args.max_seconds}s")

    step = max(1, len(candidates) // args.count)
    picks = candidates[::step][: args.count]

    clips = []
    for index, reference, payload, seconds, filename in picks:
        audio, rate = sf.read(io.BytesIO(payload), dtype="float32")
        clip_id = f"{CATEGORY[args.language]}-{len(clips) + 1:02d}"
        dest = audio_dir / f"{clip_id}.wav"
        sf.write(dest, audio, rate, subtype="PCM_16")
        clips.append(
            {
                "id": clip_id,
                "category": CATEGORY[args.language],
                "language": LANGUAGE[args.language],
                "audio": str(dest.relative_to(out)).replace("\\", "/"),
                "reference": reference,
                "seconds": round(len(audio) / rate, 2),
                "noise": False,
                "source": {
                    "dataset": "google/fleurs",
                    "split": "test",
                    "row": index,
                    "filename": filename,
                },
            }
        )

    manifest = {
        "version": 1,
        "name": f"FLEURS {CATEGORY[args.language]} sample",
        "description": f"FLEURS test-split rows for {CATEGORY[args.language]}.",
        "license": "CC-BY-4.0",
        "source": "google/fleurs",
        "thresholds": {"wer": 0.12, "categoryWer": 0.35, "keywordRecall": 0.95},
        "categories": {
            CATEGORY[args.language]: {
                "label": f"FLEURS {CATEGORY[args.language]}, read sentences",
                "target": args.count,
            }
        },
        "clips": clips,
    }
    target = out / "manifest.json"
    target.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    total = sum(clip["seconds"] for clip in clips)
    words = sum(len(clip["reference"].split()) for clip in clips)
    print(f"Wrote {len(clips)} clips, {words} words, {total:.1f}s -> {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
