# Nigerian Pidgin ASR v1.0 baseline

First reading baseline for the JotBox speech pipeline on public Nigerian Pidgin speech.
This is an evaluation baseline, not model training. The repo has no fine-tuning loop, so the
number below measures the current Groq `whisper-large-v3` path as shipped.

## Setup

| Item | Value |
| --- | --- |
| Dataset | [`asr-nigerian-pidgin/nigerian-pidgin-1.0`](https://huggingface.co/datasets/asr-nigerian-pidgin/nigerian-pidgin-1.0) |
| License | CC-BY-4.0 |
| Split | `test` (892 sentence clips) |
| Sample | 30 clips, deterministic SHA-256 rank, then sorted by filename |
| Length filter | 4 to 20 seconds per clip, first unique sentence wins |
| Audio | 244.6 seconds total, 16 kHz mono WAV |
| Reference | 591 words |
| Reader | Groq `whisper-large-v3`, free tier, `--no-notes` |
| Date | 2026-11-16 |

The sample favors lexical variety: duplicate sentences are dropped before selection. Keywords are
derived from each reference (amounts, capitalized names, then long content words), so keyword recall
is a lexical check, not a hand-curated entity list.

## Results

| Variant | WER | Errors / words | Keyword recall | Target | Status |
| --- | --- | --- | --- | --- | --- |
| Baseline | 47.5% | 281 / 591 | 78 / 120 (65.0%) | WER <= 12%, recall >= 95% | fail |
| ffmpeg normalized | 48.6% | 287 / 591 | 72 / 120 (60.0%) | WER <= 12%, recall >= 95% | fail |

The ffmpeg chain (`highpass`, `loudnorm`, `dynaudnorm`, 16 kHz mono) does not help this corpus.
The clips are already clean, quiet, single-speaker recordings, so loudness conditioning adds no
signal and changes a few borderline words. The app still benefits from that chain on room audio,
but this dataset cannot prove it.

Hallucination and briefing gates were not scored. The public corpus has no silence or noise clips
and no annotated actions, deadlines or decisions. Those gates stay on the private golden set.

## What the baseline shows

1. **The reader translates Pidgin into standard English.** This is the largest error source, not
   acoustic mishearing. Example:

   > Reference: `i no fit tok say becos no matter wetin i dey respect di pipo wey i dey togeda with`
   >
   > Reader: `I know it's toxic because no matter what we think, we are still people we are there together with.`

   Whisper treats Pidgin as English and rewrites it. The STT prompt already says "Keep Pidgin as
   spoken; do not translate", but the base model overrides the prompt on this corpus. Any serious
   Pidgin path needs a reader that preserves the creole, or a post-check that rejects a transcript
   whose Pidgin markers disappeared.

2. **Names and amounts are fragile.** Missed keywords include `Adeyleke`, `Olutope`, `Chikaike`,
   `Edochie`, `Fayose`, `govment`, `464000` and `pikin`. Dynamic glossary injection is the planned
   lever here, and `eval:public:run` can be rerun with `--glossary` to measure it.

3. **Keyword recall tracks WER.** Both variants fail for the same reason: substituted standard
   English loses the Pidgin tokens the scorer looks for.

## Limits

- Sentence-level, read speech in quiet rooms. No far-field, cross-talk, fast chat or silence.
- One public sample of 30 clips. Confidence intervals are wide, so treat small deltas as noise.
- Speaker labels are not in the corpus, so diarization cannot be scored here.
- This does not train or adapt a model. It records what the shipped pipeline does before tuning.

## Reproduce

```bash
# one time: install tooling and download the corpus
node eval/py.mjs -m pip install -r eval/requirements.txt
node eval/py.mjs -c "from huggingface_hub import snapshot_download; snapshot_download('asr-nigerian-pidgin/nigerian-pidgin-1.0', repo_type='dataset', local_dir='eval/.cache/pidgin-asr', allow_patterns=['data/*.parquet'])"

# build the 30 clip pack
npm run eval:public:import

# baseline, then ffmpeg normalized (paced for the Groq free tier)
npm run eval:public:run
npm run eval:public:score
npm run eval:public:normalize
npm run eval:public:score:normalized
```

Raw runs live in `eval/results/public-baseline/` and `eval/results/public-normalized/`, which are
gitignored. `audio/` is also gitignored, so recordings never enter the repository.

## Next step

Compare `--glossary` against this baseline, then run the private golden set. The private set is the
only place that can score hallucination on noise, briefing fact retention, far-field rooms and
cross-talk, which is where the product actually lives.
