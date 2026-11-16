#!/usr/bin/env python3
"""Correct near-sounding transcript terms with a pronunciation glossary.

The glossary keeps the canonical spelling, optional heard variants, a meaning,
and a kind (name, amount or word). Names and amounts use phonetic matching.
Pidgin words are only restored when --restore-words is passed, because
rewriting standard English back to Pidgin is a product policy, not a safe
default.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path

DIGITS_RE = re.compile(r"\d+")


@dataclass
class Entry:
    term: str
    aliases: list[str] = field(default_factory=list)
    meaning: str = ""
    kind: str = "word"


def fold(text: str) -> str:
    value = re.sub(r"[^a-z0-9]", "", text.lower())
    if not value:
        return ""
    for source, target in (("ph", "f"), ("th", "t"), ("sh", "s"), ("ch", "c"), ("ck", "k"), ("qu", "kw")):
        value = value.replace(source, target)
    value = re.sub(r"[zvq]", lambda match: {"z": "s", "v": "f", "q": "k"}[match.group()], value)
    value = value.replace("x", "ks")
    head, tail = value[0], re.sub(r"[aeiouy]", "", value[1:])
    return head + tail


def plain(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", text.lower()).strip()


def amount(text: str) -> str:
    return "".join(DIGITS_RE.findall(text))


def core(token: str) -> tuple[str, str, str]:
    match = re.fullmatch(r"([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)", token)
    if not match:
        return "", token, ""
    return match.group(1), match.group(2), match.group(3)


def infer_kind(term: str, declared: str) -> str:
    if declared in {"name", "amount", "word"}:
        return declared
    if amount(term):
        return "amount"
    if re.search(r"[A-Z]", term):
        return "name"
    return "word"


def load_glossary(path: Path) -> list[Entry]:
    entries: list[Entry] = []
    for number, raw in enumerate(path.read_text(encoding="utf8").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = [part.strip() for part in line.split("|")]
        if len(parts) < 1 or not parts[0]:
            print(f"{path}:{number}: missing term", file=sys.stderr)
            continue
        term = parts[0]
        aliases = [item.strip() for item in (parts[1] if len(parts) > 1 else "").split(",") if item.strip()]
        meaning = parts[2] if len(parts) > 2 else ""
        kind = infer_kind(term, parts[3] if len(parts) > 3 else "")
        entries.append(Entry(term=term, aliases=aliases, meaning=meaning, kind=kind))
    return entries


def phrase_map(entries: list[Entry]) -> dict[str, Entry]:
    mapping: dict[str, Entry] = {}
    for entry in entries:
        for alias in entry.aliases:
            key = plain(alias)
            if key:
                mapping[key] = entry
        key = plain(entry.term)
        if key:
            mapping.setdefault(key, entry)
    return mapping


def same_shape(left: str, right: str) -> bool:
    left_digits = bool(amount(left))
    right_digits = bool(amount(right))
    return left_digits == right_digits


def score_entity(candidate: str, entry: Entry) -> float:
    if not same_shape(candidate, entry.term):
        return 0.0
    if entry.kind == "amount":
        if not re.fullmatch(r"\d[\d,]*", candidate.strip()):
            return 0.0
        return 1.0 if amount(candidate) == amount(entry.term) else 0.0
    surface = SequenceMatcher(None, plain(candidate), plain(entry.term)).ratio()
    sounds = SequenceMatcher(None, fold(candidate), fold(entry.term)).ratio()
    if sounds >= 0.9 and surface >= 0.55:
        return sounds
    return 0.0


def apply_alias(
    tokens: list[str],
    mapping: dict[str, Entry],
    corrections: list[dict],
    allow_words: bool,
) -> set[int]:
    touched: set[int] = set()
    phrases = sorted(mapping, key=lambda item: len(item.split()), reverse=True)
    max_words = max((len(item.split()) for item in phrases), default=1)
    index = 0
    while index < len(tokens):
        lead, body, _ = core(tokens[index])
        if not body:
            index += 1
            continue
        matched = False
        for size in range(min(max_words, len(tokens) - index), 0, -1):
            parts = [core(token)[1] for token in tokens[index : index + size]]
            if any(not part for part in parts):
                continue
            key = plain(" ".join(parts))
            entry = mapping.get(key)
            if not entry or key == plain(entry.term):
                continue
            if entry.kind == "word" and not allow_words:
                continue
            last_trail = core(tokens[index + size - 1])[2]
            tokens[index] = lead + entry.term + last_trail
            for offset in range(1, size):
                tokens[index + offset] = ""
            touched.add(index)
            corrections.append(
                {"from": " ".join(parts), "to": entry.term, "kind": "alias", "score": 1.0, "meaning": entry.meaning}
            )
            matched = True
            index += size
            break
        if not matched:
            index += 1
    return touched


def apply_fuzzy(
    tokens: list[str],
    entries: list[Entry],
    corrections: list[dict],
    touched: set[int],
) -> set[int]:
    candidates = [entry for entry in entries if entry.kind in {"name", "amount"}]
    max_words = max((len(entry.term.split()) for entry in candidates), default=1)
    index = 0
    while index < len(tokens):
        if index in touched:
            index += 1
            continue
        best: tuple[float, Entry, str] | None = None
        for size in range(min(max_words, len(tokens) - index), 0, -1):
            parts = [core(token)[1] for token in tokens[index : index + size]]
            if any(not part for part in parts):
                continue
            candidate = " ".join(parts)
            for entry in candidates:
                if len(entry.term.split()) != size:
                    continue
                if candidate == entry.term:
                    continue
                if entry.kind != "amount" and plain(candidate) == plain(entry.term):
                    continue
                score = score_entity(candidate, entry)
                if score > 0 and (best is None or score > best[0]):
                    best = (score, entry, candidate)
        if best is None:
            index += 1
            continue
        score, entry, original = best
        size = len(entry.term.split())
        lead, _, _ = core(tokens[index])
        last_trail = core(tokens[index + size - 1])[2]
        tokens[index] = lead + entry.term + last_trail
        for offset in range(1, size):
            tokens[index + offset] = ""
        touched.add(index)
        corrections.append(
            {
                "from": original,
                "to": entry.term,
                "kind": entry.kind,
                "score": round(score, 2),
                "meaning": entry.meaning,
            }
        )
        index += size
    return touched


def correct(text: str, entries: list[Entry], restore_words: bool) -> tuple[str, list[dict]]:
    tokens = text.split()
    corrections: list[dict] = []
    mapping = phrase_map(entries)
    touched = apply_alias(tokens, mapping, corrections, restore_words)
    apply_fuzzy(tokens, entries, corrections, touched)
    return " ".join(token for token in tokens if token), corrections


def self_test() -> int:
    failures = 0

    def check(name: str, condition: bool) -> None:
        nonlocal failures
        if not condition:
            failures += 1
        print(f"{'ok  ' if condition else 'FAIL'} {name}")

    entries = [
        Entry("Adeyleke", kind="name"),
        Entry("Chikaike", ["achika ike"], "person's name", "name"),
        Entry("Wande Coal", ["wan dey ko"], "musician", "name"),
        Entry("Italy", kind="name"),
        Entry("Nigeria", kind="name"),
        Entry("10", kind="amount"),
        Entry("464000", [], "population", "amount"),
        Entry("pipo", ["people"], "people", "word"),
        Entry("pikin", ["pidgin"], "child", "word"),
    ]
    check(
        "fold keeps consonant skeleton",
        SequenceMatcher(None, fold("Olutope"), fold("olu tokpe")).ratio() >= 0.85,
    )
    check("fold matches chika iki", fold("Chikaike") == fold("chika iki"))
    check("amount strips commas", amount("464,000") == "464000")

    text = "Adeleke wey be teacher for di school."
    out, fixes = correct(text, entries, restore_words=False)
    check("fuzzy name corrected", "Adeyleke" in out and len(fixes) == 1)
    check("punctuation kept", out.endswith("school."))

    out, fixes = correct("italk be di president", entries, restore_words=False)
    check("weak name match rejected", out == "italk be di president" and not fixes)

    out, fixes = correct("more than 20 million Nigerians", entries, restore_words=False)
    check("demonym not collapsed", out == "more than 20 million Nigerians" and not fixes)

    out, fixes = correct("dem win 1-0", entries, restore_words=False)
    check("score not collapsed", out == "dem win 1-0" and not fixes)

    text = "Thank you, Achika ike for me."
    out, fixes = correct(text, entries, restore_words=False)
    check("alias phrase corrected", "Chikaike" in out and out.endswith("me."))

    text = "Only 464,000 pikin dem born."
    out, fixes = correct(text, entries, restore_words=False)
    check("amount corrected", "464000" in out)

    out, fixes = correct("people dey come", entries, restore_words=False)
    check("words stay put without restore", out == "people dey come" and not fixes)
    out, fixes = correct("people dey come", entries, restore_words=True)
    check("words restored with restore", out == "pipo dey come" and len(fixes) == 1)

    print("")
    print(f"self-test: {failures} failed")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply a pronunciation glossary to transcripts.")
    parser.add_argument("--predictions", type=Path, default=None)
    parser.add_argument("--glossary", type=Path, default=Path("eval/public/pidgin-asr/corrections.txt"))
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--restore-words", action="store_true", help="Also restore Pidgin spellings from near-sounding words.")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()
    if args.predictions is None:
        parser.error("--predictions is required unless --self-test is used")

    entries = load_glossary(args.glossary)
    if not entries:
        print(f"No glossary entries in {args.glossary}", file=sys.stderr)
        return 2
    payload = json.loads(args.predictions.read_text(encoding="utf8"))
    total = 0
    for clip in payload.get("clips", []):
        text = clip.get("transcript") or ""
        if not text:
            continue
        raw = clip.get("rawTranscript") or text
        clip.setdefault("rawTranscript", raw)
        corrected, corrections = correct(text, entries, args.restore_words)
        clip["transcript"] = corrected
        if corrections:
            clip["corrections"] = corrections
            total += len(corrections)
    output = args.out or args.predictions.with_name("predictions.glossary.json")
    output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    print(f"Applied {total} correction{'s' if total != 1 else ''} to {len(payload.get('clips', []))} clips")
    print(f"Wrote {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
