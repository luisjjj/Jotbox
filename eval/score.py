#!/usr/bin/env python3
"""Score JotBox golden-set runs.

Four release gates:
1. Word error rate with jiwer.
2. Keyword and entity recall.
3. Hallucination rate on noise-only clips.
4. Briefing fact retention, judged 1 to 10 by an LLM or a mock heuristic.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    import jiwer
except ImportError:
    jiwer = None

EVAL_DIR = Path(__file__).resolve().parent
DEFAULT_MANIFEST = EVAL_DIR / "golden" / "manifest.json"


class ScoreError(Exception):
    pass


NUMBER_WORDS = {
    "zero": "0",
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9",
    "ten": "10",
    "eleven": "11",
    "twelve": "12",
    "thirteen": "13",
    "fourteen": "14",
    "fifteen": "15",
    "sixteen": "16",
    "seventeen": "17",
    "eighteen": "18",
    "nineteen": "19",
    "twenty": "20",
    "thirty": "30",
    "forty": "40",
    "fifty": "50",
    "sixty": "60",
    "seventy": "70",
    "eighty": "80",
    "ninety": "90",
}

CURRENCY_RE = re.compile(r"(?:₦|ngn)\s*([\d,.]+)", re.IGNORECASE)
SPEAKER_LABEL_RE = re.compile(
    r"(?:^|(?<=\s))(?:[Ss]peaker\s*\d+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*:\s*"
)

STOPWORDS = {
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "to",
    "of",
    "for",
    "in",
    "on",
    "at",
    "by",
    "with",
    "from",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "will",
    "would",
    "should",
    "shall",
    "can",
    "could",
    "may",
    "might",
    "must",
    "do",
    "does",
    "did",
    "has",
    "have",
    "had",
    "that",
    "this",
    "these",
    "those",
    "it",
    "its",
    "we",
    "our",
    "you",
    "your",
    "they",
    "their",
    "he",
    "she",
    "his",
    "her",
    "them",
    "i",
    "me",
    "my",
    "as",
    "if",
    "then",
    "than",
    "so",
    "not",
    "no",
    "yes",
    "about",
    "into",
    "still",
}

JUDGE_SYSTEM = (
    "You grade meeting notes against a reference transcript and a short list of facts that must survive. "
    "Check four things: actions and owners, deadlines and dates, decisions, and inventions. "
    "The notes are written in clear English while the reference may be Nigerian Pidgin. A faithful paraphrase or translation is supported, and do not treat paraphrase as an invention. "
    "The room, the team and Team are allowed collective subjects. Team, Unassigned and You are allowed owner labels. A named owner is invented only when the reference does not show that person taking or accepting the action. "
    "An invention is a name, number, owner, deadline, decision or commitment that the reference does not support and cannot be reasonably inferred from it. "
    "Score 1 to 10. A 10 means every required fact survives, nothing is invented, and Nigerian Pidgin wording that carries a decision is kept. "
    "A 1 means the notes miss the point or invent content. "
    'Return only a JSON object: {"score":1,"missing":["string"],"invented":["string"],"verdict":"string"}'
)


def strip_speaker_labels(text: str) -> str:
    def replace(match: re.Match) -> str:
        label = match.group(0).strip().rstrip(":").strip()
        return " " if label.lower().startswith("speaker ") else f" {label} "

    return SPEAKER_LABEL_RE.sub(replace, str(text or ""))


def normalize_text(text: str) -> str:
    value = strip_speaker_labels(text)
    value = value.lower()
    value = CURRENCY_RE.sub(r" \1 naira ", value)
    value = value.replace("&", " and ")
    value = value.replace("'", "").replace("’", "")
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def match_tokens(text: str) -> list[str]:
    tokens = []
    for token in normalize_text(text).split():
        if token == "naira":
            continue
        tokens.append(NUMBER_WORDS.get(token, token))
    return tokens


def contains_sequence(haystack: list[str], needle: list[str]) -> bool:
    if not needle:
        return False
    for start in range(0, len(haystack) - len(needle) + 1):
        if haystack[start : start + len(needle)] == needle:
            return True
    return False


def keyword_found(keyword, hypothesis: str) -> bool:
    alternatives = keyword if isinstance(keyword, list) else [keyword]
    haystack = match_tokens(hypothesis)
    return any(
        contains_sequence(haystack, match_tokens(alternative))
        for alternative in alternatives
        if isinstance(alternative, str) and alternative.strip()
    )


def keyword_label(keyword) -> str:
    if isinstance(keyword, list):
        return " | ".join(str(item) for item in keyword if str(item).strip())
    return str(keyword)


def _count_chunks(value) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, (list, tuple)):
        total = 0
        for chunk in value:
            if hasattr(chunk, "start") and hasattr(chunk, "end"):
                total += max(1, int(chunk.end) - int(chunk.start))
            else:
                total += 1
        return total
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def word_error_stats(reference: str, hypothesis: str) -> dict | None:
    if jiwer is None:
        raise ScoreError("jiwer is not installed. Run: python -m pip install -r eval/requirements.txt")
    ref = normalize_text(reference)
    hyp = normalize_text(hypothesis)
    if not ref:
        return None
    try:
        output = jiwer.process_words(ref, hyp)
    except Exception as error:  # noqa: BLE001 - jiwer error types vary by version
        raise ScoreError(f"WER failed: {error}") from error
    hits = _count_chunks(output.hits)
    substitutions = _count_chunks(output.substitutions)
    deletions = _count_chunks(output.deletions)
    insertions = _count_chunks(output.insertions)
    ref_words = hits + substitutions + deletions
    if ref_words <= 0:
        ref_words = len(ref.split())
    errors = substitutions + deletions + insertions
    return {
        "wer": errors / ref_words if ref_words else 0.0,
        "refWords": ref_words,
        "errors": errors,
        "substitutions": substitutions,
        "deletions": deletions,
        "insertions": insertions,
    }


def flatten_notes(notes) -> str:
    if not isinstance(notes, dict):
        return ""
    parts = [notes.get("title", ""), notes.get("summary", "")]
    for field in ("highlights", "decisions"):
        value = notes.get(field)
        if isinstance(value, list):
            parts.extend(str(item) for item in value)
    for action in notes.get("actions") or []:
        if isinstance(action, dict):
            parts.append(f"{action.get('owner', '')} {action.get('text', '')}")
        elif isinstance(action, str):
            parts.append(action)
    for section in notes.get("sections") or []:
        if isinstance(section, dict):
            parts.append(str(section.get("heading", "")))
            parts.extend(str(item) for item in section.get("bullets") or [])
    return " ".join(part for part in parts if part)


def fact_tokens(fact: str) -> list[str]:
    return [
        token
        for token in match_tokens(fact)
        if token not in STOPWORDS and (len(token) > 2 or token.isdigit())
    ]


def facts_kept(facts: list[str], notes_text: str) -> tuple[list[str], list[str]]:
    haystack = set(match_tokens(notes_text))
    kept: list[str] = []
    missing: list[str] = []
    for fact in facts:
        want = fact_tokens(fact)
        if not want:
            kept.append(fact)
            continue
        overlap = sum(1 for token in want if token in haystack) / len(want)
        if overlap >= 0.6:
            kept.append(fact)
        else:
            missing.append(fact)
    return kept, missing


def parse_json_object(content: str) -> dict:
    text = str(content or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ScoreError("The judge did not return a JSON object.")
    try:
        value = json.loads(text[start : end + 1])
    except json.JSONDecodeError as error:
        raise ScoreError(f"The judge returned invalid JSON: {error}") from error
    if not isinstance(value, dict):
        raise ScoreError("The judge returned JSON that is not an object.")
    return value


def judge_with_groq(reference: str, notes: dict, facts: list[str]) -> dict:
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not api_key:
        raise ScoreError("GROQ_API_KEY is not set. Add it to .env, or use --judge-mock.")
    model = os.environ.get("GROQ_NOTES_MODEL", "").strip() or "openai/gpt-oss-120b"
    user = "\n".join(
        [
            "Reference transcript:",
            reference.strip() or "(none)",
            "",
            "Facts that must survive:",
            "\n".join(f"- {fact}" for fact in facts) or "- (none listed)",
            "",
            "Notes JSON:",
            json.dumps(notes, ensure_ascii=False, indent=2),
        ]
    )
    payload = {
        "model": model,
        "temperature": 0.1,
        "max_tokens": 700,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": JUDGE_SYSTEM},
            {"role": "user", "content": user},
        ],
    }
    request = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "JotBox-Eval/1.0 (+https://jotbox-eight.vercel.app)",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:300]
        raise ScoreError(f"Judge failed with HTTP {error.code}: {detail}") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise ScoreError(f"Judge failed: {error}") from error
    content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
    value = parse_json_object(content)
    try:
        score = int(round(float(value.get("score"))))
    except (TypeError, ValueError) as error:
        raise ScoreError("The judge did not return a numeric score.") from error
    missing = value.get("missing") if isinstance(value.get("missing"), list) else []
    invented = value.get("invented") if isinstance(value.get("invented"), list) else []
    return {
        "score": max(1, min(10, score)),
        "missing": [str(item)[:200] for item in missing][:10],
        "invented": [str(item)[:200] for item in invented][:10],
        "verdict": str(value.get("verdict", ""))[:400],
    }


def mock_judge(notes: dict, facts: list[str]) -> dict:
    kept, missing = facts_kept(facts, flatten_notes(notes))
    recall = len(kept) / len(facts) if facts else 1.0
    score = max(1, min(10, round(1 + 9 * recall)))
    return {
        "score": score,
        "missing": missing,
        "invented": [],
        "verdict": "Heuristic mock judge. Run with --judge for the live LLM score.",
    }


def metric_status(value, target, lower_is_better: bool):
    if value is None or target is None:
        return None
    ok = value <= target if lower_is_better else value >= target
    return "pass" if ok else "fail"


def pct(value) -> str:
    return "n/a" if value is None else f"{value:.1%}"


def md_cell(value) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ").strip()


def load_manifest(path: Path) -> dict:
    if not path.exists():
        raise ScoreError(f"Manifest not found: {path}")
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ScoreError(f"Manifest is not valid JSON: {error}") from error
    if not isinstance(manifest, dict):
        raise ScoreError("Manifest must be a JSON object.")
    return manifest


def load_predictions(path: Path) -> dict:
    if not path.exists():
        raise ScoreError(f"Predictions not found: {path}")
    try:
        predictions = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ScoreError(f"Predictions are not valid JSON: {error}") from error
    if not isinstance(predictions, dict) or not isinstance(predictions.get("clips"), list):
        raise ScoreError("Predictions must be an object with a clips list.")
    return predictions


def latest_predictions() -> Path:
    results = EVAL_DIR / "results"
    candidates = sorted(results.glob("*/predictions.json"), key=lambda item: item.stat().st_mtime, reverse=True)
    if not candidates:
        raise ScoreError(
            "No predictions found. Run `npm run eval:run` first, or pass --predictions path/to/predictions.json."
        )
    return candidates[0]


def resolve_reference(clip: dict, manifest_dir: Path) -> str:
    inline = clip.get("reference")
    if isinstance(inline, str) and inline.strip():
        return inline
    relative = clip.get("transcript")
    if not relative:
        return ""
    path = (manifest_dir / relative).resolve()
    if not path.exists():
        raise ScoreError(f"Transcript not found for {clip.get('id')}: {path}")
    return path.read_text(encoding="utf-8").strip()


def build_report(
    manifest: dict,
    manifest_path: Path,
    predictions: dict,
    judge: bool,
    judge_mock: bool,
) -> dict:
    clips = manifest.get("clips") or []
    predictions_by_id = {
        clip.get("id"): clip for clip in predictions.get("clips", []) if isinstance(clip, dict)
    }
    thresholds = manifest.get("thresholds") or {}

    speech: list[dict] = []
    noise: list[dict] = []
    brief_clips: list[dict] = []
    prompt_coverages: list[float] = []
    skipped: list[dict] = []

    for clip in clips:
        clip_id = clip.get("id") or "(no id)"
        category = clip.get("category") or "uncategorized"
        prediction = predictions_by_id.get(clip_id)
        if prediction is None:
            skipped.append({"id": clip_id, "reason": "no-prediction"})
            continue
        if prediction.get("status") != "ok":
            skipped.append({"id": clip_id, "reason": prediction.get("status") or "not-ok"})
            continue
        hypothesis = prediction.get("transcript") or ""

        if clip.get("noise"):
            words = len(normalize_text(hypothesis).split())
            noise.append({"id": clip_id, "category": category, "words": words, "text": hypothesis.strip()})
            continue

        try:
            reference = resolve_reference(clip, manifest_path.parent)
        except ScoreError as error:
            skipped.append({"id": clip_id, "reason": str(error)})
            continue
        if not reference.strip():
            skipped.append({"id": clip_id, "reason": "no-reference"})
            continue

        stats = word_error_stats(reference, hypothesis)
        if stats is None:
            skipped.append({"id": clip_id, "reason": "empty-reference"})
            continue

        coverage = prediction.get("promptCoverage")
        if isinstance(coverage, (int, float)):
            prompt_coverages.append(float(coverage))

        targets = clip.get("keywords") or []
        misses = []
        for keyword in targets:
            if not keyword_found(keyword, hypothesis):
                misses.append({"id": clip_id, "category": category, "keyword": keyword_label(keyword)})

        item = {
            "id": clip_id,
            "category": category,
            "wer": stats["wer"],
            "refWords": stats["refWords"],
            "errors": stats["errors"],
            "keywordsFound": len(targets) - len(misses),
            "keywordsTotal": len(targets),
            "misses": misses,
            "notes": prediction.get("notes"),
            "facts": clip.get("facts") or [],
            "factKept": [],
            "factMissing": [],
        }
        speech.append(item)

        facts = clip.get("facts") or []
        if facts and isinstance(prediction.get("notes"), dict):
            kept, missing = facts_kept(facts, flatten_notes(prediction["notes"]))
            item["factKept"] = kept
            item["factMissing"] = missing
            judged = {
                "id": clip_id,
                "score": None,
                "kept": len(kept),
                "total": len(facts),
                "missing": missing,
                "invented": [],
                "verdict": "",
                "error": None,
            }
            if judge or judge_mock:
                try:
                    result = (
                        mock_judge(prediction["notes"], facts)
                        if judge_mock
                        else judge_with_groq(reference, prediction["notes"], facts)
                    )
                    judged.update(result)
                    judged["kept"] = len(kept)
                    judged["total"] = len(facts)
                except ScoreError as error:
                    judged["error"] = str(error)
            brief_clips.append(judged)

    by_category: dict[str, dict] = {}
    for item in speech:
        bucket = by_category.setdefault(
            item["category"],
            {
                "clips": 0,
                "refWords": 0,
                "errors": 0,
                "keywordsFound": 0,
                "keywordsTotal": 0,
                "misses": [],
            },
        )
        bucket["clips"] += 1
        bucket["refWords"] += item["refWords"]
        bucket["errors"] += item["errors"]
        bucket["keywordsFound"] += item["keywordsFound"]
        bucket["keywordsTotal"] += item["keywordsTotal"]
        bucket["misses"].extend(item["misses"])

    total_ref = sum(item["refWords"] for item in speech)
    total_errors = sum(item["errors"] for item in speech)
    overall_wer = total_errors / total_ref if total_ref else None

    for bucket in by_category.values():
        bucket["wer"] = bucket["errors"] / bucket["refWords"] if bucket["refWords"] else None
        bucket["keywordRecall"] = (
            bucket["keywordsFound"] / bucket["keywordsTotal"] if bucket["keywordsTotal"] else None
        )

    keywords_found = sum(item["keywordsFound"] for item in speech)
    keywords_total = sum(item["keywordsTotal"] for item in speech)
    keyword_recall = keywords_found / keywords_total if keywords_total else None
    misses = [miss for item in speech for miss in item["misses"]]

    hallucinated = [item for item in noise if item["words"] > 0]
    hallucination_rate = len(hallucinated) / len(noise) if noise else None

    judged_scores = [item["score"] for item in brief_clips if isinstance(item["score"], int)]
    brief_score = sum(judged_scores) / len(judged_scores) if judged_scores else None
    fact_kept = sum(len(item["factKept"]) for item in speech)
    fact_total = sum(len(item["facts"]) for item in speech if isinstance(item.get("notes"), dict))
    fact_recall = fact_kept / fact_total if fact_total else None

    coverage_by_category: dict[str, dict] = {}
    for clip in clips:
        category = clip.get("category") or "uncategorized"
        bucket = coverage_by_category.setdefault(
            category,
            {"inManifest": 0, "scored": 0, "target": (manifest.get("categories", {}).get(category) or {}).get("target")},
        )
        bucket["inManifest"] += 1
    for item in speech:
        coverage_by_category[item["category"]]["scored"] += 1
    for item in noise:
        coverage_by_category[item["category"]]["scored"] += 1

    wer_target = thresholds.get("wer")
    category_target = thresholds.get("categoryWer")
    keyword_target = thresholds.get("keywordRecall")
    hallucination_target = thresholds.get("hallucinationRate")
    brief_target = thresholds.get("briefScore")

    checks = [
        {
            "name": "Word error rate",
            "value": overall_wer,
            "target": wer_target,
            "direction": "lower",
            "status": metric_status(overall_wer, wer_target, True),
        },
        {
            "name": "Keyword recall",
            "value": keyword_recall,
            "target": keyword_target,
            "direction": "higher",
            "status": metric_status(keyword_recall, keyword_target, False),
        },
        {
            "name": "Hallucination rate",
            "value": hallucination_rate,
            "target": hallucination_target,
            "direction": "lower",
            "status": metric_status(hallucination_rate, hallucination_target, True),
        },
        {
            "name": "Briefing score",
            "value": brief_score,
            "target": brief_target,
            "direction": "higher",
            "status": metric_status(brief_score, brief_target, False),
        },
    ]
    for category, bucket in sorted(by_category.items()):
        checks.append(
            {
                "name": f"WER {category}",
                "value": bucket["wer"],
                "target": category_target,
                "direction": "lower",
                "status": metric_status(bucket["wer"], category_target, True),
            }
        )

    return {
        "run": predictions.get("run"),
        "startedAt": predictions.get("startedAt"),
        "scoredAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "manifest": str(manifest_path),
        "variant": predictions.get("variant") or {},
        "providers": predictions.get("providers") or {},
        "clips": {
            "manifest": len(clips),
            "scored": len(speech) + len(noise),
            "skipped": skipped,
        },
        "coverage": {
            "byCategory": coverage_by_category,
            "promptCoverage": sum(prompt_coverages) / len(prompt_coverages) if prompt_coverages else None,
        },
        "wer": {
            "overall": overall_wer,
            "target": wer_target,
            "categoryTarget": category_target,
            "status": metric_status(overall_wer, wer_target, True),
            "clips": len(speech),
            "refWords": total_ref,
            "errors": total_errors,
            "byCategory": by_category,
        },
        "keywordRecall": {
            "overall": keyword_recall,
            "target": keyword_target,
            "status": metric_status(keyword_recall, keyword_target, False),
            "found": keywords_found,
            "total": keywords_total,
            "byCategory": {
                category: {
                    "found": bucket["keywordsFound"],
                    "total": bucket["keywordsTotal"],
                    "recall": bucket["keywordRecall"],
                }
                for category, bucket in by_category.items()
            },
            "misses": misses,
        },
        "hallucination": {
            "rate": hallucination_rate,
            "target": hallucination_target,
            "status": metric_status(hallucination_rate, hallucination_target, True),
            "clips": len(noise),
            "hallucinated": len(hallucinated),
            "words": sum(item["words"] for item in hallucinated),
            "details": noise,
        },
        "briefing": {
            "score": brief_score,
            "target": brief_target,
            "status": metric_status(brief_score, brief_target, False),
            "judged": len(judged_scores),
            "factRecall": {
                "overall": fact_recall,
                "kept": fact_kept,
                "total": fact_total,
            },
            "clips": brief_clips,
            "note": None
            if judged_scores
            else "Briefing was not judged. Run with --judge (live Groq) or --judge-mock (offline heuristic).",
        },
        "checks": checks,
    }


def build_markdown(report: dict) -> str:
    gates = [
        ("Word error rate", pct(report["wer"]["overall"]), report["wer"]["target"], report["wer"]["status"]),
        (
            "Keyword recall",
            f"{report['keywordRecall']['found']}/{report['keywordRecall']['total']} "
            f"({pct(report['keywordRecall']['overall'])})",
            report["keywordRecall"]["target"],
            report["keywordRecall"]["status"],
        ),
        (
            "Hallucination rate",
            pct(report["hallucination"]["rate"]),
            report["hallucination"]["target"],
            report["hallucination"]["status"],
        ),
        (
            "Briefing score",
            "n/a" if report["briefing"]["score"] is None else f"{report['briefing']['score']:.1f}/10",
            report["briefing"]["target"],
            report["briefing"]["status"],
        ),
    ]

    def target_text(value, lower: bool) -> str:
        if value is None:
            return "n/a"
        return f"<= {value:.1%}" if lower else f">= {value:.1%}"

    def gate_status(value) -> str:
        return value if value else "not scored"

    lines = [
        "# JotBox golden set report",
        "",
        f"Run: `{report.get('run') or 'n/a'}`  ",
        f"Manifest: `{report.get('manifest')}`  ",
        f"Variant: glossary={report['variant'].get('glossary')} normalize={report['variant'].get('normalize')} "
        f"mock={report['variant'].get('mock')}  ",
        f"Providers: reading={report['providers'].get('reading') or 'none'} "
        f"writing={report['providers'].get('writing') or 'none'}",
        "",
        "## Release gates",
        "",
        "| Gate | Result | Target | Status |",
        "| --- | --- | --- | --- |",
    ]
    targets = [
        target_text(report["wer"]["target"], True),
        target_text(report["keywordRecall"]["target"], False),
        target_text(report["hallucination"]["target"], True),
        ">= 8/10" if report["briefing"]["target"] is not None else "n/a",
    ]
    for (name, result, _target, status), target in zip(gates, targets):
        lines.append(f"| {name} | {result} | {target} | {gate_status(status)} |")

    lines.extend(["", "## Reading accuracy", ""])
    if report["wer"]["clips"]:
        lines.extend(
            [
                "| Category | Clips | Reference words | Errors | WER | Status |",
                "| --- | --- | --- | --- | --- | --- |",
            ]
        )
        for category, bucket in sorted(report["wer"]["byCategory"].items()):
            category_status = metric_status(bucket["wer"], report["wer"].get("categoryTarget"), True)
            lines.append(
                f"| {md_cell(category)} | {bucket['clips']} | {bucket['refWords']} | {bucket['errors']} | "
                f"{pct(bucket['wer'])} | {category_status or 'n/a'} |"
            )
        lines.append("")
        lines.append(
            f"Overall: {pct(report['wer']['overall'])} over {report['wer']['refWords']} reference words "
            f"from {report['wer']['clips']} clips."
        )
        if report["wer"].get("categoryTarget") is not None:
            lines.append(
                f"Category status uses the {pct(report['wer']['categoryTarget'])} guard. "
                f"The overall release target is {pct(report['wer']['target'])}."
            )
    else:
        lines.append("No speech clips were scored.")

    lines.extend(["", "## Keyword and entity recall", ""])
    if report["keywordRecall"]["total"]:
        lines.append(
            f"Found {report['keywordRecall']['found']} of {report['keywordRecall']['total']} target terms "
            f"({pct(report['keywordRecall']['overall'])})."
        )
        if report["keywordRecall"]["byCategory"]:
            lines.extend(["", "| Category | Found | Total | Recall |", "| --- | --- | --- | --- |"])
            for category, bucket in sorted(report["keywordRecall"]["byCategory"].items()):
                lines.append(
                    f"| {md_cell(category)} | {bucket['found']} | {bucket['total']} | {pct(bucket['recall'])} |"
                )
        if report["keywordRecall"]["misses"]:
            lines.extend(["", "Missed terms:", ""])
            for miss in report["keywordRecall"]["misses"][:20]:
                lines.append(f"- `{miss['id']}`: {md_cell(miss['keyword'])}")
    else:
        lines.append("No keywords were scored. Add `keywords` to the manifest clips.")

    lines.extend(["", "## Hallucination on noise", ""])
    if report["hallucination"]["clips"]:
        lines.append(
            f"{report['hallucination']['hallucinated']} of {report['hallucination']['clips']} noise clips returned words "
            f"({pct(report['hallucination']['rate'])}), {report['hallucination']['words']} invented words in total."
        )
        lines.extend(["", "| Clip | Words | Text |", "| --- | --- | --- |"])
        for item in report["hallucination"]["details"]:
            text = md_cell(item["text"]) if item["text"] else "(none)"
            lines.append(f"| `{item['id']}` | {item['words']} | {text[:160]} |")
    else:
        lines.append("No noise clips were scored. Add 5 silence or room-tone clips to test this gate.")

    lines.extend(["", "## Briefing fact retention", ""])
    briefing = report["briefing"]
    if briefing["factRecall"]["total"]:
        lines.append(
            f"Deterministic fact recall: {briefing['factRecall']['kept']} of {briefing['factRecall']['total']} "
            f"({pct(briefing['factRecall']['overall'])})."
        )
    if briefing["clips"]:
        lines.extend(
            [
                "",
                "| Clip | Judge | Facts kept | Missing | Invented |",
                "| --- | --- | --- | --- | --- |",
            ]
        )
        for item in briefing["clips"]:
            score = "n/a" if item["score"] is None else f"{item['score']}/10"
            if item["error"]:
                score = "error"
            missing = "; ".join(item["missing"]) if item["missing"] else "(none)"
            invented = "; ".join(item["invented"]) if item["invented"] else "(none)"
            kept = f"{item.get('kept', 0)}/{item.get('total', 0)}"
            lines.append(
                f"| `{item['id']}` | {score} | {kept} | {md_cell(missing)[:160]} | {md_cell(invented)[:80]} |"
            )
        for item in briefing["clips"]:
            if item["error"]:
                lines.append(f"- `{item['id']}` judge error: {md_cell(item['error'])}")
        if briefing["score"] is not None:
            lines.extend(["", f"Mean judge score: {briefing['score']:.1f}/10 over {briefing['judged']} clips."])
    else:
        lines.append("No notes were judged. Add `facts` to the manifest and run with --judge or --judge-mock.")
    if briefing.get("note"):
        lines.extend(["", f"_Note: {briefing['note']}_"])

    lines.extend(["", "## Coverage", "", "| Category | In manifest | Scored | Target |", "| --- | --- | --- | --- |"])
    for category, bucket in sorted(report["coverage"]["byCategory"].items()):
        target = bucket.get("target")
        lines.append(
            f"| {md_cell(category)} | {bucket['inManifest']} | {bucket['scored']} | "
            f"{'n/a' if target is None else target} |"
        )
    if report["coverage"].get("promptCoverage") is not None:
        lines.extend(
            [
                "",
                f"Glossary prompt coverage: {pct(report['coverage']['promptCoverage'])} of target terms reached the reader hint.",
            ]
        )

    if report["clips"]["skipped"]:
        lines.extend(["", "## Skipped", ""])
        for item in report["clips"]["skipped"]:
            lines.append(f"- `{item['id']}`: {md_cell(item['reason'])}")

    lines.extend(
        [
            "",
            "## Notes",
            "",
            "WER uses jiwer over lowercased, punctuation-free text. Bare speaker labels are ignored, while a named "
            "label keeps the name. Keyword recall matches contiguous terms after "
            "number words are mapped to digits, with optional alternatives per keyword. Hallucination counts any word "
            "returned by a clip marked `noise`. The briefing judge checks actions, deadlines, decisions and inventions.",
            "",
        ]
    )
    return "\n".join(lines)


def print_summary(report: dict, report_dir: Path) -> None:
    def line(label: str, value: str) -> None:
        print(f"{label.ljust(12)} {value}")

    line("Run", str(report.get("run") or "n/a"))
    line(
        "Scored",
        f"{report['wer']['clips']} speech, {report['hallucination']['clips']} noise, "
        f"{len(report['clips']['skipped'])} skipped",
    )
    for check in report["checks"]:
        if check["value"] is None:
            continue
        if check["name"].startswith("WER "):
            continue
        if check["name"] == "Word error rate":
            value = pct(check["value"])
            target = f"target <= {pct(check['target'])}"
        elif check["name"] == "Keyword recall":
            value = pct(check["value"])
            target = f"target >= {pct(check['target'])}"
        elif check["name"] == "Hallucination rate":
            value = pct(check["value"])
            target = f"target <= {pct(check['target'])}"
        else:
            value = f"{check['value']:.1f}/10"
            target = f"target >= {check['target']}/10" if check["target"] is not None else ""
        line(check["name"], f"{value}  {target}  {check['status']}")
    if report["briefing"]["score"] is None:
        judged = report["briefing"]["clips"]
        errors = [item for item in judged if item.get("error")]
        if errors:
            line("Briefing", f"judge failed ({len(errors)} clips), see report")
        else:
            line("Briefing", "not judged (use --judge or --judge-mock)")
    print(f"Report       {report_dir / 'report.md'}")


def self_test() -> int:
    failures: list[str] = []

    def check(name: str, condition: bool) -> None:
        if not condition:
            failures.append(name)
        print(f"{'ok  ' if condition else 'FAIL'} {name}")

    check("normalize whitespace", normalize_text("  Hello,   WORLD! ") == "hello world")
    check("speaker labels", normalize_text("Ada: hello\nSpeaker 2: hi") == "ada hello hi")
    check("currency tokens", match_tokens("₦450,000") == ["450", "000"])
    check("keyword amount", keyword_found("₦450,000", "the 450,000 naira limit"))
    check("keyword number words", keyword_found("before four", "before 4"))
    check("keyword alternatives", keyword_found(["standup", "stand up"], "quick stand up"))
    check("keyword tokenizer is exact", not keyword_found("standup", "stand up"))
    kept, missing = facts_kept(["Ada will send the merchant note before four"], "Ada sends the merchant note before 4")
    check("fact kept", len(kept) == 1 and not missing)
    kept, missing = facts_kept(
        ["KYC must be confirmed before the next batch is released"],
        "The team will pause the next batch until the cutoff holds.",
    )
    check("fact missed", not kept and len(missing) == 1)
    check("hallucination words", len(normalize_text("Thank you for watching").split()) == 4)
    check("judge parser", parse_json_object('```json\n{"score": 7}\n```')["score"] == 7)

    if jiwer is None:
        print("FAIL jiwer is not installed. Run: python -m pip install -r eval/requirements.txt")
        return 1
    stats = word_error_stats("a b c d", "a x c y")
    check("WER known case", stats is not None and abs(stats["wer"] - 0.5) < 1e-9)
    check("WER reference words", stats is not None and stats["refWords"] == 4)
    stats = word_error_stats("wetin dey happen", "wetin dey happen")
    check("WER perfect", stats is not None and stats["wer"] == 0)

    print("")
    print(f"self-test: {len(failures)} failed")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Score a JotBox golden-set run.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--predictions", type=Path, default=None)
    parser.add_argument("--out", type=Path, default=None, help="Report directory. Defaults to the predictions folder.")
    parser.add_argument("--judge", action="store_true", help="Score briefing notes with a live Groq judge.")
    parser.add_argument("--judge-mock", action="store_true", help="Use the offline heuristic judge.")
    parser.add_argument("--check", action="store_true", help="Exit 1 when a release gate fails.")
    parser.add_argument("--require-brief", action="store_true", help="With --check, fail if briefing was not judged.")
    parser.add_argument("--self-test", action="store_true", help="Run scorer unit checks.")
    args = parser.parse_args()

    if args.self_test:
        return self_test()
    if jiwer is None:
        print("jiwer is not installed. Run: python -m pip install -r eval/requirements.txt", file=sys.stderr)
        return 2

    try:
        manifest_path = args.manifest.resolve()
        predictions_path = (args.predictions or latest_predictions()).resolve()
        manifest = load_manifest(manifest_path)
        predictions = load_predictions(predictions_path)
        report = build_report(
            manifest,
            manifest_path,
            predictions,
            judge=args.judge,
            judge_mock=args.judge_mock,
        )
    except ScoreError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    out_dir = (args.out or predictions_path.parent).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (out_dir / "report.md").write_text(build_markdown(report), encoding="utf-8")

    print_summary(report, out_dir)

    if not args.check:
        return 0

    missing = []
    if not report["wer"]["clips"]:
        missing.append("no speech clips scored")
    if not report["keywordRecall"]["total"]:
        missing.append("no keywords scored")
    if not report["hallucination"]["clips"]:
        missing.append("no noise clips scored")
    if args.require_brief and not report["briefing"]["judged"]:
        missing.append("briefing was not judged")
    failures = [check for check in report["checks"] if check["status"] == "fail"]

    if report["briefing"]["factRecall"]["total"] and not report["briefing"]["judged"]:
        print("warning: briefing was not judged, so that gate was not enforced.", file=sys.stderr)

    if missing or failures:
        for item in missing:
            print(f"MISSING {item}", file=sys.stderr)
        for check in failures:
            print(f"FAIL {check['name']}: value={check['value']} target={check['target']}", file=sys.stderr)
        return 1
    print("All release gates passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
