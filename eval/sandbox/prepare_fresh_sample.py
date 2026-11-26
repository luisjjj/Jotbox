#!/usr/bin/env python3
"""Build a fresh clip pack from the Nigerian Pidgin ASR test split.

The shipped public pack in eval/public/pidgin-asr is 30 clips. This script takes a
stride sample of the rest of the split, so open-model scores are not measured on
the same sentences that tuned the JotBox prompt and glossary.

Download the split first (about 950 MB):

    python -c "from huggingface_hub import snapshot_download; snapshot_download('asr-nigerian-pidgin/nigerian-pidgin-1.0', repo_type='dataset', local_dir='eval/.cache/pidgin-asr-full', allow_patterns=['data/*.parquet'])"

Then:

    python eval/sandbox/prepare_fresh_sample.py
"""

from __future__ import annotations

import argparse
import io
import json
from pathlib import Path

import pyarrow.parquet as pq
import soundfile as sf


def existing_rows(manifest: Path) -> tuple[set[int], set[str]]:
    if not manifest.exists():
        return set(), set()
    data = json.loads(manifest.read_text(encoding="utf-8"))
    rows: set[int] = set()
    sentences: set[str] = set()
    for clip in data["clips"]:
        row = (clip.get("source") or {}).get("row")
        if isinstance(row, int):
            rows.add(row)
        if clip.get("reference"):
            sentences.add(clip["reference"].strip().lower())
    return rows, sentences


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="eval/.cache/pidgin-asr-full")
    parser.add_argument("--out", default="eval/.cache/pidgin-fresh-100")
    parser.add_argument("--exclude", default="eval/public/pidgin-asr/manifest.json")
    parser.add_argument("--stride", type=int, default=6)
    parser.add_argument("--count", type=int, default=100)
    parser.add_argument("--min-seconds", type=float, default=4)
    parser.add_argument("--max-seconds", type=float, default=20)
    args = parser.parse_args()

    root = Path(args.root).resolve()
    out = Path(args.out).resolve()
    audio_dir = out / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    parquet = next((root / "data").glob("test-*.parquet"))
    skip_rows, skip_sentences = existing_rows(Path(args.exclude))
    para = pq.ParquetFile(parquet)
    wanted = set(range(0, para.metadata.num_rows, args.stride))

    clips = []
    seen = set(skip_sentences)
    row_index = 0
    for batch in para.iter_batches(batch_size=8, columns=["sentence", "filename", "audio"]):
        for item in batch.to_pylist():
            index = row_index
            row_index += 1
            if index not in wanted or index in skip_rows:
                continue
            sentence = (item.get("sentence") or "").strip()
            if not sentence:
                continue
            key = sentence.lower()
            if key in seen:
                continue
            try:
                audio, rate = sf.read(io.BytesIO(item["audio"]["bytes"]), dtype="float32")
            except Exception:
                continue
            seconds = len(audio) / rate
            if seconds < args.min_seconds or seconds > args.max_seconds:
                continue
            seen.add(key)
            clip_id = f"pidgin-fresh-{len(clips) + 1:03d}"
            path = audio_dir / f"{clip_id}.wav"
            sf.write(path, audio, rate, subtype="PCM_16")
            clips.append(
                {
                    "id": clip_id,
                    "category": "pidgin",
                    "audio": str(path.relative_to(out)).replace("\\", "/"),
                    "reference": sentence,
                    "seconds": round(seconds, 2),
                    "noise": False,
                    "source": {
                        "dataset": "asr-nigerian-pidgin/nigerian-pidgin-1.0",
                        "split": "test",
                        "row": index,
                        "filename": item.get("filename"),
                    },
                }
            )
            if len(clips) >= args.count:
                break
        if len(clips) >= args.count:
            break

    manifest = {
        "version": 1,
        "name": f"Nigerian Pidgin ASR fresh {len(clips)}",
        "description": (
            "Stride sample of the public Nigerian Pidgin ASR v1.0 test split, "
            "excluding the 30 clips in eval/public/pidgin-asr."
        ),
        "license": "CC-BY-4.0",
        "source": "asr-nigerian-pidgin/nigerian-pidgin-1.0",
        "thresholds": {"wer": 0.12, "categoryWer": 0.35, "keywordRecall": 0.95},
        "categories": {"pidgin": {"label": "Nigerian Pidgin, sentence level", "target": args.count}},
        "clips": clips,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    words = sum(len(clip["reference"].split()) for clip in clips)
    seconds = sum(clip["seconds"] for clip in clips)
    print(f"Wrote {len(clips)} clips, {words} words, {seconds:.1f}s audio -> {out / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
