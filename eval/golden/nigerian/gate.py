#!/usr/bin/env python3
"""Offline regression gate for the Nigerian golden sets.

This reads the committed Scribe baseline, applies the same corrections the
product ships, folds spoken numbers to digits, and fails when WER moves past
the gate. It never calls a paid provider, so it can run on every pull request.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import jiwer

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "eval"))

from score import normalize_text  # noqa: E402

CORRECTIONS_PATH = ROOT / "server/api/nigerian-corrections.json"

# Percentages. English has a real 5% target. Pidgin is gated at its measured
# ceiling because Scribe normalises Pidgin into standard English, which a name
# correction table cannot safely undo.
GATES = {
    "english": {"overall": 5.0},
    "pidgin": {"overall": 19.0},
    "combined": {"overall": 11.5, "nigerian_english": 5.0, "pidgin": 19.0},
}

UNITS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19,
}
TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}
SCALES = {
    "hundred": 100,
    "thousand": 1_000,
    "million": 1_000_000,
    "billion": 1_000_000_000,
    "trillion": 1_000_000_000_000,
}


def load_corrections(path: Path = CORRECTIONS_PATH) -> list[tuple[re.Pattern, str]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    entries = []
    for entry in data.get("corrections", []):
        target = str(entry.get("to") or "").strip()
        if not target:
            continue
        for source in entry.get("from", []):
            source = str(source or "").strip()
            if not source:
                continue
            pattern = re.compile(rf"(?<![\w]){re.escape(source)}(?![\w])", re.IGNORECASE)
            entries.append((pattern, target))
    entries.sort(key=lambda item: (len(item[0].pattern), item[0].pattern), reverse=True)
    return entries


def apply_corrections(text: str, entries: list[tuple[re.Pattern, str]]) -> str:
    value = str(text or "")
    for pattern, target in entries:
        value = pattern.sub(target, value)
    return value


def parse_number(tokens: list[str], start: int) -> tuple[int | None, int]:
    total = 0
    current = 0
    used = False
    index = start
    while index < len(tokens):
        token = tokens[index]
        if token.isdigit():
            current += int(token)
            used = True
            index += 1
            continue
        if token in UNITS:
            current += UNITS[token]
            used = True
            index += 1
            continue
        if token in TENS:
            current += TENS[token]
            used = True
            index += 1
            continue
        if token == "hundred":
            current = (current or 1) * 100
            used = True
            index += 1
            continue
        if token in ("thousand", "million", "billion", "trillion"):
            total += (current or 1) * SCALES[token]
            current = 0
            used = True
            index += 1
            continue
        if token == "and" and used:
            following = tokens[index + 1] if index + 1 < len(tokens) else ""
            if following in UNITS or following in TENS or following == "hundred":
                index += 1
                continue
        break
    if not used:
        return None, start
    return total + current, index


def fold_numbers(tokens: list[str]) -> list[str]:
    folded = []
    index = 0
    while index < len(tokens):
        value, end = parse_number(tokens, index)
        if value is not None and end > index:
            folded.append(f"#{value}")
            index = end
        else:
            folded.append(tokens[index])
            index += 1
    return folded


def _count(chunks) -> int:
    if isinstance(chunks, int):
        return chunks
    return sum(max(1, chunk.end - chunk.start) for chunk in chunks)


def word_stats(reference: str, hypothesis: str) -> dict:
    ref = normalize_text(reference)
    hyp = normalize_text(hypothesis)
    strict = jiwer.process_words(ref, hyp)
    ref_words = _count(strict.hits) + _count(strict.substitutions) + _count(strict.deletions)
    errors = _count(strict.substitutions) + _count(strict.deletions) + _count(strict.insertions)
    folded_ref = " ".join(fold_numbers(ref.split()))
    folded_hyp = " ".join(fold_numbers(hyp.split()))
    folded = jiwer.process_words(folded_ref, folded_hyp)
    folded_words = _count(folded.hits) + _count(folded.substitutions) + _count(folded.deletions)
    folded_errors = _count(folded.substitutions) + _count(folded.deletions) + _count(folded.insertions)
    return {
        "refWords": ref_words,
        "errors": errors,
        "strict": errors / ref_words if ref_words else 0.0,
        "foldedRefWords": folded_words,
        "foldedErrors": folded_errors,
        "folded": folded_errors / folded_words if folded_words else 0.0,
        "reference": folded_ref,
        "hypothesis": folded_hyp,
    }


def load_set(name: str, baseline_dir: Path) -> tuple[dict, dict]:
    baseline_path = baseline_dir / f"{name}.json"
    if not baseline_path.exists():
        raise SystemExit(
            f"Missing {baseline_path}. Run: node eval/py.mjs eval/golden/nigerian/freeze_baseline.py"
        )
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    manifest_path = HERE / str(baseline.get("manifest") or f"bench-{name}.json")
    if not manifest_path.exists():
        raise SystemExit(f"Missing manifest {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    return baseline, manifest


def score_set(name: str, baseline_dir: Path, corrections: list[tuple[re.Pattern, str]]) -> dict:
    baseline, manifest = load_set(name, baseline_dir)
    transcripts = {clip.get("id"): clip for clip in baseline.get("clips", [])}
    rows = []
    missing = []
    for clip in manifest.get("clips", []):
        found = transcripts.get(clip.get("id"))
        if not found:
            missing.append(clip.get("id"))
            continue
        hypothesis = apply_corrections(found.get("transcript") or "", corrections)
        stats = word_stats(clip.get("reference") or "", hypothesis)
        rows.append(
            {
                "id": clip["id"],
                "category": clip.get("category") or found.get("category") or "",
                **stats,
            }
        )
    if missing:
        raise SystemExit(f"{name}: baseline has no transcript for {', '.join(missing[:5])}")
    unknown = sorted(set(transcripts) - {clip.get("id") for clip in manifest.get("clips", [])})
    if unknown:
        raise SystemExit(f"{name}: baseline has clips that are not in the manifest: {', '.join(unknown[:5])}")
    total = {
        "refWords": sum(row["refWords"] for row in rows),
        "errors": sum(row["errors"] for row in rows),
        "foldedRefWords": sum(row["foldedRefWords"] for row in rows),
        "foldedErrors": sum(row["foldedErrors"] for row in rows),
    }
    total["strict"] = total["errors"] / total["refWords"] if total["refWords"] else 0.0
    total["folded"] = total["foldedErrors"] / total["foldedRefWords"] if total["foldedRefWords"] else 0.0
    categories = {}
    for row in rows:
        bucket = categories.setdefault(
            row["category"],
            {"clips": 0, "refWords": 0, "errors": 0, "foldedRefWords": 0, "foldedErrors": 0},
        )
        bucket["clips"] += 1
        bucket["refWords"] += row["refWords"]
        bucket["errors"] += row["errors"]
        bucket["foldedRefWords"] += row["foldedRefWords"]
        bucket["foldedErrors"] += row["foldedErrors"]
    for bucket in categories.values():
        bucket["strict"] = bucket["errors"] / bucket["refWords"] if bucket["refWords"] else 0.0
        bucket["folded"] = (
            bucket["foldedErrors"] / bucket["foldedRefWords"] if bucket["foldedRefWords"] else 0.0
        )
    return {
        "set": name,
        "clips": rows,
        "overall": {**total, "clips": len(rows)},
        "categories": categories,
        "frozenAt": baseline.get("frozenAt"),
        "reader": baseline.get("reader"),
    }


def gate_status(value: float, limit: float) -> str:
    return "pass" if value * 100 <= limit + 1e-9 else "FAIL"


def print_set(result: dict) -> bool:
    name = result["set"]
    gates = GATES.get(name, {})
    overall = result["overall"]
    limit = gates.get("overall")
    status = gate_status(overall["folded"], limit) if limit is not None else "n/a"
    print(
        f"{name:<9} overall            {overall['clips']:>3} clips {overall['refWords']:>5} words  "
        f"strict {overall['strict'] * 100:>5.1f}%  folded {overall['folded'] * 100:>5.1f}%  "
        f"gate <= {limit:.1f}%  {status.upper() if status != 'n/a' else 'N/A'}"
    )
    ok = status != "FAIL"
    for category, bucket in sorted(result["categories"].items()):
        category_limit = gates.get(category)
        if category_limit is None:
            print(
                f"{'':<9} {category:<18} {bucket['clips']:>3} clips {bucket['refWords']:>5} words  "
                f"strict {bucket['strict'] * 100:>5.1f}%  folded {bucket['folded'] * 100:>5.1f}%"
            )
            continue
        category_status = gate_status(bucket["folded"], category_limit)
        ok = ok and category_status != "FAIL"
        print(
            f"{'':<9} {category:<18} {bucket['clips']:>3} clips {bucket['refWords']:>5} words  "
            f"strict {bucket['strict'] * 100:>5.1f}%  folded {bucket['folded'] * 100:>5.1f}%  "
            f"gate <= {category_limit:.1f}%  {category_status.upper()}"
        )
    return ok


def print_worst(result: dict, count: int) -> None:
    rows = [row for row in result["clips"] if row["foldedErrors"] > 0]
    rows.sort(key=lambda row: row["folded"], reverse=True)
    if not rows:
        return
    print(f"\n{result['set']} worst clips (after corrections, numbers folded):")
    for row in rows[:count]:
        print(f"  {row['id']:<20} {row['category']:<18} {row['folded'] * 100:>5.1f}%")
        print(f"    ref: {row['reference']}")
        print(f"    hyp: {row['hypothesis']}")


def self_test() -> int:
    checks = []

    def check(name: str, condition: bool) -> None:
        checks.append((name, condition))
        print(f"{'ok  ' if condition else 'FAIL'} {name}")

    entries = load_corrections()
    check("correction: wey skit", apply_corrections("wey skit", entries) == "Wizkid")
    check("correction: ambiguous campo stays", apply_corrections("campo", entries) == "campo")
    check(
        "numbers: words equal digits",
        fold_numbers(normalize_text("thirty seven million dollars").split())
        == fold_numbers(normalize_text("37 million dollars").split()),
    )
    check(
        "numbers: twelve equals 12",
        fold_numbers(normalize_text("twelve states").split())
        == fold_numbers(normalize_text("12 states").split()),
    )
    check(
        "numbers: folded WER is zero",
        word_stats("the original twelve states", "the original 12 states")["folded"] == 0.0,
    )
    failed = [name for name, condition in checks if not condition]
    if failed:
        print(f"\n{len(failed)} self-test checks failed", file=sys.stderr)
        return 1
    print(f"\n{len(checks)} self-test checks passed")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Offline Nigerian golden-set regression gate.")
    parser.add_argument("--baseline-dir", type=Path, default=HERE / "baseline")
    parser.add_argument("--set", choices=["english", "pidgin", "combined", "all"], default="all")
    parser.add_argument("--list", type=int, default=0, metavar="N", help="Print the N worst clips per set.")
    parser.add_argument("--json", type=Path, default=None, help="Write machine-readable results.")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--no-corrections", action="store_true", help="Score raw Scribe output.")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    corrections = [] if args.no_corrections else load_corrections()
    names = list(GATES) if args.set == "all" else [args.set]
    results = [score_set(name, args.baseline_dir, corrections) for name in names]
    print("Nigerian accuracy gate (offline, no reader calls)")
    print("")
    ok = True
    for result in results:
        ok = print_set(result) and ok
        if args.list:
            print_worst(result, args.list)
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print("")
    if ok:
        print("gate: PASS")
        return 0
    print("gate: FAIL")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
