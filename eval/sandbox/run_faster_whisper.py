#!/usr/bin/env python3
"""Score an open-weight Whisper checkpoint on a JotBox manifest, on CPU.

Runs faster-whisper (CTranslate2 int8) over the clips and writes a JotBox
predictions.json that eval/score.py can read. No network calls except the
one-time model download.

    python eval/sandbox/run_faster_whisper.py \
      --manifest eval/.cache/pidgin-fresh-100/manifest.json \
      --model amn-raw/naijavox-2.0-int8-ct2 --name naijavox-2.0 \
      --out eval/results/naijavox-fresh-100 --limit 20

Pidgin has no ISO-639-1 code in Whisper's list, so faster-whisper rejects
--language pcm. Use en; the checkpoint carries the Pidgin behaviour.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from faster_whisper import WhisperModel
from huggingface_hub import snapshot_download


def resolve_model(repo: str, cache: Path, feature_size: int | None) -> Path:
    local = Path(repo)
    if local.is_dir():
        target = local.resolve()
    else:
        target = cache / repo.replace("/", "__")
        if not target.joinpath("model.bin").exists():
            print(f"Downloading {repo} -> {target}", flush=True)
            snapshot_download(repo_id=repo, local_dir=target)

    config = target / "preprocessor_config.json"
    if feature_size and not config.exists():
        # Some third-party CT2 conversions ship without this file, which makes
        # faster-whisper feed 80 mel bins to a large-v3 (128 bin) encoder.
        config.write_text(
            json.dumps(
                {
                    "feature_size": feature_size,
                    "sampling_rate": 16000,
                    "hop_length": 160,
                    "chunk_length": 30,
                    "n_fft": 400,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"Wrote {config} (feature_size={feature_size})", flush=True)
    return target


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--model", required=True, help="Hugging Face repo id or local CT2 folder")
    parser.add_argument("--name", required=True, help="provider label written into predictions")
    parser.add_argument("--out", required=True)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--language", default="en")
    parser.add_argument("--beam", type=int, default=5)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--feature-size", type=int, default=0, help="write preprocessor_config.json if missing")
    parser.add_argument("--models", default="eval/.cache/models")
    args = parser.parse_args()

    manifest_path = Path(args.manifest).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    base = manifest_path.parent
    clips = manifest["clips"][args.offset :]
    clips = clips[: args.limit or None]

    path = resolve_model(args.model, Path(args.models).resolve(), args.feature_size or None)
    print(f"Loading {path}", flush=True)
    model = WhisperModel(str(path), device="cpu", compute_type=args.compute_type, cpu_threads=args.threads)

    started = time.time()
    rows = []
    total_audio = 0.0
    total_run = 0.0
    for index, clip in enumerate(clips, 1):
        audio_path = base / clip["audio"]
        tick = time.time()
        segments, info = model.transcribe(
            str(audio_path),
            language=args.language,
            task="transcribe",
            beam_size=args.beam,
            condition_on_previous_text=False,
            vad_filter=False,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        elapsed = time.time() - tick
        total_audio += info.duration
        total_run += elapsed
        rows.append(
            {
                "id": clip["id"],
                "category": clip.get("category", "pidgin"),
                "status": "ok",
                "transcript": text,
                "words": len(text.split()),
                "provider": args.name,
                "seconds": round(info.duration, 2),
            }
        )
        print(
            f"[{index}/{len(clips)}] {clip['id']} {info.duration:.1f}s audio "
            f"{elapsed:.1f}s run ({info.duration / elapsed:.2f}x realtime)",
            flush=True,
        )

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    predictions = {
        "run": args.name,
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started)),
        "manifest": str(manifest_path),
        "variant": {"glossary": False, "normalize": False, "language": args.language},
        "providers": {"reading": args.name, "writing": None},
        "clips": rows,
    }
    target = out / "predictions.json"
    target.write_text(json.dumps(predictions, indent=2), encoding="utf-8")
    print(
        f"Wrote {target} | {total_audio:.1f}s audio in {total_run:.1f}s "
        f"({total_audio / max(total_run, 0.001):.2f}x realtime)",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
