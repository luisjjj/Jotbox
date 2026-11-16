#!/usr/bin/env python3
"""Import a deterministic sample of the Nigerian Pidgin ASR v1.0 dataset.

The corpus is public, CC-BY-4.0, and sentence-level. This writes a JotBox
manifest plus local audio so the eval runner can score the real pipeline
against native Pidgin speech without committing the recordings.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import wave
from dataclasses import dataclass
from pathlib import Path

try:
    import pyarrow.parquet as pq
except ImportError:  # pragma: no cover - guidance only
    print("pyarrow is missing. Run: node eval/py.mjs -m pip install pyarrow", file=sys.stderr)
    raise SystemExit(2)

REPO = "asr-nigerian-pidgin/nigerian-pidgin-1.0"
LICENSE = "CC-BY-4.0"
CITATION = (
    "Rufai, A. M., Abeeb, A., Oduntan, E., Arulogun, T., Adegboro, O., & Ajisafe, D. (2025). "
    "Towards End-to-End Training of Automatic Speech Recognition for Nigerian Pidgin. "
    "arXiv:2010.11123. https://arxiv.org/abs/2010.11123"
)

STOPWORDS = {
    "a", "an", "and", "as", "at", "be", "but", "by", "dey", "dem", "do", "e", "for",
    "from", "go", "he", "her", "him", "his", "i", "if", "in", "is", "it", "make",
    "me", "my", "na", "no", "not", "of", "on", "or", "our", "say", "she", "so",
    "that", "the", "their", "them", "this", "to", "us", "was", "we", "wet", "wey",
    "when", "with", "you", "your",
}


@dataclass
class Candidate:
    sentence: str
    filename: str
    audio: bytes
    seconds: float
    split: str
    row: int

    @property
    def rank(self) -> str:
        return hashlib.sha256(f"{self.split}:{self.filename}:{self.sentence}".encode("utf8")).hexdigest()


def decode_audio(value) -> bytes | None:
    if value is None:
        return None
    if isinstance(value, dict):
        return bytes(value.get("bytes") or b"") or None
    if isinstance(value, (bytes, bytearray)):
        return bytes(value) or None
    return None


def wav_seconds(data: bytes) -> float:
    try:
        with wave.open(io.BytesIO(data), "rb") as handle:
            frames = handle.getnframes()
            rate = handle.getframerate() or 1
            return frames / float(rate)
    except (wave.Error, EOFError):
        return 0.0


def read_split(source: Path, split: str) -> list[Candidate]:
    files = sorted(source.glob(f"data/{split}-*.parquet"))
    if not files:
        raise FileNotFoundError(f"No parquet files for split '{split}' under {source / 'data'}")
    rows: list[Candidate] = []
    for path in files:
        table = pq.read_table(path)
        columns = table.to_pydict()
        for index, sentence in enumerate(columns.get("sentence", [])):
            audio = decode_audio(columns.get("audio", [None])[index])
            if not audio:
                continue
            text = " ".join(str(sentence or "").split())
            if len(text.split()) < 4:
                continue
            filename = str(columns.get("filename", [f"row-{index}"])[index] or f"row-{index}")
            rows.append(
                Candidate(
                    sentence=text,
                    filename=filename,
                    audio=audio,
                    seconds=wav_seconds(audio),
                    split=split,
                    row=index,
                )
            )
    return rows


def pick(candidates: list[Candidate], count: int, min_seconds: float, max_seconds: float) -> list[Candidate]:
    pool = [item for item in candidates if min_seconds <= item.seconds <= max_seconds]
    if len(pool) < count:
        pool = candidates
    pool.sort(key=lambda item: item.rank)
    chosen: list[Candidate] = []
    seen: set[str] = set()
    for item in pool:
        key = item.sentence.lower()
        if key in seen:
            continue
        seen.add(key)
        chosen.append(item)
        if len(chosen) == count:
            break
    chosen.sort(key=lambda item: item.filename)
    return chosen


def keywords(sentence: str, limit: int = 4) -> list[str]:
    text = sentence.replace("’", "'")
    words = re.findall(r"[A-Za-z0-9₦$][A-Za-z0-9'’.,₦$-]*", text)
    picked: list[str] = []
    seen: set[str] = set()

    def add(term: str) -> None:
        cleaned = term.strip(".,!?;:\"'")
        if not cleaned or cleaned.lower() in seen:
            return
        seen.add(cleaned.lower())
        picked.append(cleaned)

    for word in words:
        if any(ch.isdigit() for ch in word):
            add(word)
    for index, word in enumerate(words):
        if index == 0:
            continue
        if word[:1].isupper() and word.lower() not in STOPWORDS:
            add(word)
    if len(picked) < limit:
        ranked = sorted(
            (word for word in words if word.lower() not in STOPWORDS and word.lower() not in seen),
            key=lambda word: (-len(word), word.lower()),
        )
        for word in ranked:
            if len(picked) >= limit:
                break
            add(word)
    return picked[:limit]


def write_pack(candidates: list[Candidate], out: Path) -> dict:
    audio_dir = out / "audio"
    text_dir = out / "transcripts"
    audio_dir.mkdir(parents=True, exist_ok=True)
    text_dir.mkdir(parents=True, exist_ok=True)

    clips = []
    for index, item in enumerate(candidates, start=1):
        clip_id = f"pidgin-{item.split}-{index:03d}"
        audio_name = f"{clip_id}.wav"
        (audio_dir / audio_name).write_bytes(item.audio)
        (text_dir / f"{clip_id}.txt").write_text(item.sentence + "\n", encoding="utf8")
        clips.append(
            {
                "id": clip_id,
                "category": "pidgin",
                "audio": f"audio/{audio_name}",
                "reference": item.sentence,
                "seconds": round(item.seconds, 2),
                "title": f"Nigerian Pidgin ASR {item.split} clip {index:03d}",
                "keywords": keywords(item.sentence),
                "noise": False,
                "source": {
                    "dataset": REPO,
                    "split": item.split,
                    "row": item.row,
                    "filename": item.filename,
                    "license": LICENSE,
                },
            }
        )

    manifest = {
        "version": 1,
        "name": "Nigerian Pidgin ASR v1.0 public baseline",
        "description": (
            "Deterministic sample of the public Nigerian Pidgin ASR v1.0 test split. "
            "Sentence-level clips, quiet recording conditions, no annotated facts."
        ),
        "license": LICENSE,
        "citation": CITATION,
        "source": REPO,
        "thresholds": {
            "wer": 0.12,
            "categoryWer": 0.35,
            "keywordRecall": 0.95,
            "hallucinationRate": 0,
            "briefScore": 8,
        },
        "categories": {"pidgin": {"label": "Nigerian Pidgin, sentence level", "target": len(clips)}},
        "glossary": "glossary.txt",
        "clips": clips,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf8")

    terms: list[str] = []
    seen: set[str] = set()
    for clip in clips:
        for term in clip["keywords"]:
            if term.lower() not in seen:
                seen.add(term.lower())
                terms.append(term)
    (out / "glossary.txt").write_text("\n".join(terms[:50]) + "\n", encoding="utf8")

    total_seconds = sum(clip["seconds"] for clip in clips)
    (out / "ATTRIBUTION.md").write_text(
        "# Nigerian Pidgin ASR v1.0 baseline pack\n\n"
        f"Source: `{REPO}` on Hugging Face, {LICENSE}.\n\n"
        f"`audio/` holds {len(clips)} clips ({total_seconds:.1f} seconds) sampled deterministically from the "
        f"test split. Audio is gitignored. Transcripts are stored in `transcripts/` and inline in the manifest.\n\n"
        "Recreate the pack with:\n\n"
        "```bash\n"
        "node eval/py.mjs eval/import_pidgin_asr.py --split test --count 30\n"
        "```\n\n"
        "## Citation\n\n"
        f"{CITATION}\n",
        encoding="utf8",
    )
    (out / ".gitignore").write_text("audio/*\n!audio/.gitkeep\n", encoding="utf8")
    (audio_dir / ".gitkeep").write_text("", encoding="utf8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Import a Nigerian Pidgin ASR v1.0 baseline pack.")
    parser.add_argument("--source", type=Path, default=Path("eval/.cache/pidgin-asr"))
    parser.add_argument("--out", type=Path, default=Path("eval/public/pidgin-asr"))
    parser.add_argument("--split", default="test", choices=["train", "validation", "test"])
    parser.add_argument("--count", type=int, default=30)
    parser.add_argument("--min-seconds", type=float, default=4.0)
    parser.add_argument("--max-seconds", type=float, default=20.0)
    args = parser.parse_args()

    if not args.source.exists():
        print(f"Dataset not found at {args.source}. Download it first, see eval/DATASETS.md.", file=sys.stderr)
        return 2

    candidates = read_split(args.source, args.split)
    chosen = pick(candidates, args.count, args.min_seconds, args.max_seconds)
    if not chosen:
        print(f"No usable {args.split} clips found in {args.source}.", file=sys.stderr)
        return 2

    manifest = write_pack(chosen, args.out)
    seconds = sum(clip["seconds"] for clip in manifest["clips"])
    print(f"Imported {len(manifest['clips'])} {args.split} clips ({seconds:.1f}s) into {args.out}")
    print(f"Manifest: {args.out / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
