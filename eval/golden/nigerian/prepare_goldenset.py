#!/usr/bin/env python3
"""Save the full Nigerian Pidgin and Nigerian accented English corpora.

The audio is kept in the local dataset cache, pinned to the revisions in
datasets.json. The committed artifacts are the full reference manifests, the
dataset metadata and a short bench manifest per corpus. Bench audio is
extracted to eval/golden/audio/, which is gitignored.

    python eval/golden/nigerian/prepare_goldenset.py --download --build
    python eval/golden/nigerian/prepare_goldenset.py --extract benches
    python eval/golden/nigerian/prepare_goldenset.py --extract all --set english

"all" audio is about 1.8 GB of 16 kHz WAV. The default extracts only the bench
slice, which keeps Scribe spending inside the approved three minute cap.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import subprocess
from pathlib import Path

import pyarrow.parquet as pq
import soundfile as sf
from huggingface_hub import HfApi, hf_hub_download

ROOT = Path(__file__).resolve().parents[3]
GOLDEN = ROOT / "eval/golden/nigerian"
AUDIO = ROOT / "eval/golden/audio"
CACHE = ROOT / "eval/.cache/nigerian-golden"

DATASETS = {
    "pidgin": {
        "repo": "asr-nigerian-pidgin/nigerian-pidgin-1.0",
        "revision": "87c615091844ac1b44b91d8831683641b02df447",
        "license": "CC-BY-4.0",
        "category": "pidgin",
        "audio_dir": "nigerian-pidgin",
        "cache": ROOT / "eval/.cache/pidgin-asr",
        "text_field": "sentence",
        "source_field": "filename",
        "id_prefix": "pidgin",
    },
    "english": {
        "repo": "benjaminogbonna/nigerian_accented_english_dataset",
        "revision": "23063ce074a2e7b930475d7e776e505c2027d69d",
        "license": "apache-2.0",
        "category": "nigerian_english",
        "audio_dir": "nigerian-english",
        "cache": CACHE / "english",
        "text_field": "sentence",
        "source_field": "path",
        "id_prefix": "english",
    },
}


def ffmpeg_binary() -> str:
    candidates = [
        os.environ.get("FFMPEG_PATH", ""),
        shutil.which("ffmpeg") or "",
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        str(Path.home() / "AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe"),
        r"C:\ProgramData\chocolatey\bin\ffmpeg.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    raise SystemExit("ffmpeg not found. Set FFMPEG_PATH or install ffmpeg.")


def split_files(repo: str, revision: str, split: str) -> list[str]:
    files = HfApi().list_repo_files(repo, repo_type="dataset", revision=revision)
    return sorted(f for f in files if f.startswith(f"data/{split}-") and f.endswith(".parquet"))


def download_split(dataset: dict, split: str, force: bool) -> list[Path]:
    cache = dataset["cache"]
    cache.mkdir(parents=True, exist_ok=True)
    paths = []
    for remote in split_files(dataset["repo"], dataset["revision"], split):
        target = cache / remote
        if target.exists() and not force:
            paths.append(target)
            continue
        paths.append(
            Path(
                hf_hub_download(
                    dataset["repo"],
                    remote,
                    repo_type="dataset",
                    revision=dataset["revision"],
                    local_dir=str(cache),
                )
            )
        )
    return paths


def iter_split(paths: list[Path]):
    for path in paths:
        for batch in pq.ParquetFile(path).iter_batches(batch_size=64):
            for item in batch.to_pylist():
                yield item


def duration(payload: bytes) -> float:
    info = sf.info(io.BytesIO(payload))
    return round(info.frames / info.samplerate, 2)


def audio_path(dataset: dict, clip_id: str) -> str:
    return f"../audio/{dataset['audio_dir']}/{clip_id}.wav"


def build_full(dataset: dict, split_paths: dict[str, list[Path]]) -> dict:
    clips = []
    seconds = 0.0
    rows = 0
    for split in ("train", "validation", "test"):
        row = 0
        for item in iter_split(split_paths[split]):
            reference = (item.get(dataset["text_field"]) or "").strip()
            payload = (item.get("audio") or {}).get("bytes")
            if not reference or not payload:
                row += 1
                continue
            clip_id = f"{dataset['id_prefix']}-{split}-{row:04d}"
            secs = duration(payload)
            seconds += secs
            clips.append(
                {
                    "id": clip_id,
                    "category": dataset["category"],
                    "audio": audio_path(dataset, clip_id),
                    "reference": reference,
                    "seconds": secs,
                    "noise": False,
                    "source": {
                        "dataset": dataset["repo"],
                        "revision": dataset["revision"],
                        "split": split,
                        "row": row,
                        dataset["source_field"]: item.get(dataset["source_field"]),
                    },
                }
            )
            rows += 1
            row += 1

    manifest = {
        "version": 1,
        "name": f"{dataset['repo']} full corpus",
        "description": "Complete public corpus saved as a fixed reference for reader changes.",
        "license": dataset["license"],
        "source": {
            "dataset": dataset["repo"],
            "revision": dataset["revision"],
        },
        "thresholds": {"wer": 0.12, "categoryWer": 0.35, "keywordRecall": 0.95},
        "categories": {
            dataset["category"]: {
                "label": f"{dataset['category']}, read sentences",
                "target": rows,
            }
        },
        "stats": {"clips": rows, "seconds": round(seconds, 1), "words": sum(len(c["reference"].split()) for c in clips)},
        "clips": clips,
    }
    return manifest


def write_json(path: Path, payload: dict, force: bool) -> None:
    if path.exists() and not force:
        print(f"keep {path.relative_to(ROOT)}")
        return
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)}")


def select_english_bench(test_paths: list[Path], budget: float) -> tuple[dict, dict[str, bytes]]:
    candidates = []
    row = 0
    for item in iter_split(test_paths):
        reference = (item.get("sentence") or "").strip()
        payload = (item.get("audio") or {}).get("bytes")
        if payload and reference and "[" not in reference and "(" not in reference:
            secs = duration(payload)
            if 4.0 <= secs <= 12.0:
                candidates.append((row, reference, secs, item.get("path"), payload))
        row += 1

    seen = set()
    unique = []
    for candidate in candidates:
        key = candidate[1].lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)

    # Walk the split with a stride so different speakers are covered.
    stride = max(1, len(unique) // 60)
    pool = unique[::stride]
    selected = []
    total = 0.0
    for candidate in pool:
        if total + candidate[2] > budget:
            continue
        selected.append(candidate)
        total += candidate[2]
        if total >= budget - 4:
            break

    for candidate in unique:
        if len(selected) >= 18 or total >= budget - 4:
            break
        if candidate in selected:
            continue
        if total + candidate[2] > budget:
            continue
        selected.append(candidate)
        total += candidate[2]

    selected.sort(key=lambda item: item[0])
    clips = []
    payloads = {}
    for index, (row, reference, secs, path, payload) in enumerate(selected, start=1):
        clip_id = f"english-test-{row:03d}"
        clips.append(
            {
                "id": clip_id,
                "category": "nigerian_english",
                "language": "en",
                "audio": f"../audio/nigerian-english/{clip_id}.wav",
                "reference": reference,
                "seconds": secs,
                "noise": False,
                "source": {
                    "dataset": DATASETS["english"]["repo"],
                    "revision": DATASETS["english"]["revision"],
                    "split": "test",
                    "row": row,
                    "path": path,
                },
            }
        )
        payloads[clip_id] = payload

    manifest = {
        "version": 1,
        "name": "Nigerian accented English Scribe bench",
        "description": "Deterministic slice of the accented English test split, capped for paid Scribe runs.",
        "license": DATASETS["english"]["license"],
        "source": {
            "dataset": DATASETS["english"]["repo"],
            "revision": DATASETS["english"]["revision"],
        },
        "thresholds": {"wer": 0.12, "categoryWer": 0.35, "keywordRecall": 0.95},
        "categories": {
            "nigerian_english": {
                "label": "Nigerian accented English, read sentences",
                "target": len(clips),
            }
        },
        "stats": {
            "clips": len(clips),
            "seconds": round(sum(c["seconds"] for c in clips), 1),
            "words": sum(len(c["reference"].split()) for c in clips),
            "budgetSeconds": budget,
        },
        "clips": clips,
    }
    return manifest, payloads


def extract(ffmpeg: str, dataset: dict, manifest_path: Path, payload_lookup) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    out_dir = AUDIO / dataset["audio_dir"]
    out_dir.mkdir(parents=True, exist_ok=True)
    for clip in manifest["clips"]:
        dest = out_dir / f"{clip['id']}.wav"
        if dest.exists() and dest.stat().st_size > 44:
            continue
        payload = payload_lookup(clip)
        if not payload:
            raise SystemExit(f"No audio bytes for {clip['id']}")
        subprocess.run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                "pipe:0",
                "-ar",
                "16000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                str(dest),
            ],
            input=payload,
            check=True,
        )
    print(f"extracted {len(manifest['clips'])} clips to {out_dir.relative_to(ROOT)}")


def extract_all(ffmpeg: str, dataset: dict, full_manifest_path: Path, split_paths: dict[str, list[Path]]) -> None:
    full = json.loads(full_manifest_path.read_text(encoding="utf-8"))
    by_id = {clip["id"]: clip for clip in full["clips"]}
    out_dir = AUDIO / dataset["audio_dir"]
    out_dir.mkdir(parents=True, exist_ok=True)
    for split in ("train", "validation", "test"):
        row = 0
        for item in iter_split(split_paths[split]):
            clip = by_id.get(f"{dataset['id_prefix']}-{split}-{row:04d}")
            row += 1
            if not clip:
                continue
            dest = out_dir / f"{clip['id']}.wav"
            if dest.exists() and dest.stat().st_size > 44:
                continue
            payload = (item.get("audio") or {}).get("bytes")
            if not payload:
                continue
            subprocess.run(
                [
                    ffmpeg,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    "pipe:0",
                    "-ar",
                    "16000",
                    "-ac",
                    "1",
                    "-c:a",
                    "pcm_s16le",
                    str(dest),
                ],
                input=payload,
                check=True,
            )
    print(f"extracted full corpus to {out_dir.relative_to(ROOT)}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--set", choices=["all", "pidgin", "english"], default="all")
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--extract", choices=["none", "benches", "all"], default="none")
    parser.add_argument("--bench-seconds", type=float, default=170.0)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    GOLDEN.mkdir(parents=True, exist_ok=True)
    names = ["pidgin", "english"] if args.set == "all" else [args.set]
    ffmpeg = ffmpeg_binary() if args.extract != "none" else None

    split_paths = {}
    for name in names:
        dataset = DATASETS[name]
        split_paths[name] = {}
        for split in ("train", "validation", "test"):
            if args.download:
                split_paths[name][split] = download_split(dataset, split, args.force)
            else:
                split_paths[name][split] = sorted((dataset["cache"] / "data").glob(f"{split}-*.parquet"))
            if not split_paths[name][split]:
                raise SystemExit(f"Missing {name} {split} parquet. Run with --download.")

    if args.build:
        revisions = {}
        for name in names:
            dataset = DATASETS[name]
            full = build_full(dataset, split_paths[name])
            full_path = GOLDEN / f"{name}-full.json"
            write_json(full_path, full, args.force)
            revisions[name] = {
                "repo": dataset["repo"],
                "revision": dataset["revision"],
                "license": dataset["license"],
                "stats": full["stats"],
                "files": [
                    {
                        "path": str(path.relative_to(dataset["cache"])).replace("\\", "/"),
                        "bytes": path.stat().st_size,
                        "sha256": sha256(path),
                    }
                    for split in ("train", "validation", "test")
                    for path in split_paths[name][split]
                ],
            }
        write_json(GOLDEN / "datasets.json", revisions, args.force)

        english_bench, _ = select_english_bench(split_paths["english"]["test"], args.bench_seconds)
        write_json(GOLDEN / "bench-english.json", english_bench, args.force)

    if args.extract != "none":
        for name in names:
            dataset = DATASETS[name]
            full_path = GOLDEN / f"{name}-full.json"
            if args.extract == "all":
                extract_all(ffmpeg, dataset, full_path, split_paths[name])
            elif name == "english":
                bench_path = GOLDEN / "bench-english.json"
                bench = json.loads(bench_path.read_text(encoding="utf-8"))
                wanted = {clip["id"]: clip for clip in bench["clips"]}
                payloads = {}
                row = 0
                for item in iter_split(split_paths[name]["test"]):
                    clip_id = f"english-test-{row:03d}"
                    if clip_id in wanted:
                        payloads[clip_id] = (item.get("audio") or {}).get("bytes")
                    row += 1
                extract(ffmpeg, dataset, bench_path, lambda clip: payloads.get(clip["id"]))
            else:
                bench_path = GOLDEN / "bench-pidgin.json"
                if not bench_path.exists():
                    raise SystemExit("bench-pidgin.json is missing; restore it from git first.")
                bench = json.loads(bench_path.read_text(encoding="utf-8"))
                wanted = {(clip["source"]["split"], clip["source"]["row"]): clip["id"] for clip in bench["clips"]}
                payloads = {}
                for split in ("train", "validation", "test"):
                    row = 0
                    for item in iter_split(split_paths[name][split]):
                        clip_id = wanted.get((split, row))
                        row += 1
                        if clip_id:
                            payloads[clip_id] = (item.get("audio") or {}).get("bytes")
                extract(ffmpeg, dataset, bench_path, lambda clip: payloads.get(clip["id"]))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
