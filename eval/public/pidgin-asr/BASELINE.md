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

All variants read the same 30 clips, same 591 reference words, same reader and the same pacing.

| Variant | WER | Errors / words | Keyword recall | Target | Status |
| --- | --- | --- | --- | --- | --- |
| Baseline, English prompt | 47.5% | 281 / 591 | 78 / 120 (65.0%) | WER <= 12%, recall >= 95% | fail |
| Injected glossary only | 46.5% | 275 / 591 | 80 / 120 (66.7%) | WER <= 12%, recall >= 95% | fail |
| Pidgin-first prompt | 43.5% | 257 / 591 | 75 / 120 (62.5%) | WER <= 12%, recall >= 95% | fail |
| Pidgin prompt + glossary | 39.1% | 231 / 591 | 86 / 120 (71.7%) | WER <= 12%, recall >= 95% | fail |
| + pronunciation matcher, names and amounts | 37.6% | 222 / 591 | 90 / 120 (75.0%) | WER <= 12%, recall >= 95% | fail |
| + Pidgin word restoration | 36.9% | 218 / 591 | 90 / 120 (75.0%) | WER <= 12%, recall >= 95% | fail |
| ffmpeg normalized, English prompt | 48.6% | 287 / 591 | 72 / 120 (60.0%) | WER <= 12%, recall >= 95% | fail |

End to end, mishearing drops from 47.5% to 36.9%, which is **10.6 points absolute, or 22.3%
relative**. Keyword recall rises from 65.0% to 75.0%, which is 10 points or 15.4% relative.

Most of the gain comes from the prompt. Telling the reader to keep Pidgin verbatim, then injecting
the room glossary, is worth 8.4 points before any matching runs. The matcher adds another 2.2
points, and word restoration another 0.7.

The ffmpeg chain (`highpass`, `loudnorm`, `dynaudnorm`, 16 kHz mono) does not help this corpus.
The clips are already clean, quiet, single-speaker recordings, so loudness conditioning adds no
signal and changes a few borderline words. The app still benefits from that chain on room audio,
but this dataset cannot prove it.

## Pronunciation matcher

`eval/glossary_match.py` takes a correction table (`corrections.txt`) with the shape
`term | heard variants | meaning | kind`. It runs two passes over a finished transcript:

1. **Phonetic names and amounts.** It folds each token to a consonant skeleton (so `Olutope` and
   `olu tokpe` meet), compares surface and phonetic similarity, and only replaces names and amounts
   that clear both thresholds. Digit amounts must match exactly after commas are stripped.
2. **Explicit aliases.** Longest phrase first, including Pidgin words such as `talk` to `tok` and
   `government` to `govment`. Word replacements are off unless `--restore-words` is passed, because
   a word like `matter` can be legitimate English in a mixed sentence.

On this sample the entity pass made 5 corrections: `Achika ike` to `Chikaike`, `wan dey ko` to
`Wande Coal`, `Yu elochi` to `Yul Edochie`, `Whiskey Day` to `Wizkid Day`, and `464,000` to
`464000`. Turning on word restoration added 8 more, including `talk` to `tok`, `matter` to `mata`,
`another` to `anoda`, `people` to `pipo`, `because` to `becos`, and `government` to `govment`.

The matcher does not rewrite by default and the output keeps `rawTranscript` beside the corrected
text, so the verbatim field can stay in the product. One known false positive: `local government`
in clip 22 became `local govment` and cost a word. Context-aware correction is the next fix.

Hallucination and briefing gates were not scored. The public corpus has no silence or noise clips
and no annotated actions, deadlines or decisions. Those gates stay on the private golden set.

## What the baseline shows

1. **The reader translates Pidgin into standard English.** This is the largest error source, not
   acoustic mishearing. Example:

   > Reference: `i no fit tok say becos no matter wetin i dey respect di pipo wey i dey togeda with`
   >
   > Reader: `I know it's toxic because no matter what we think, we are still people we are there together with.`

   Whisper treats Pidgin as English and rewrites it. A dedicated prompt (`eval/prompts/pidgin.txt`)
   fixes part of this: it names Pidgin markers such as `wetin dey happen`, `pikin`, `abeg` and
   `sotey`, and it refuses translation explicitly. That variant is worth 4.0 points of WER on its
   own. It is not a full fix, because the model still normalizes grammar, but it is the cheapest
   lever measured so far.

2. **Names and amounts are fragile.** Missed keywords include `Adeyleke`, `Olutope`, `Chikaike`,
   `Edochie`, `Fayose`, `govment`, `464000` and `pikin`. Injecting the glossary into the prompt and
   then running the pronunciation matcher recovers most of them: keyword recall goes from 65.0% to
   75.0% on the same clips.

3. **Keyword recall tracks WER.** Both variants fail for the same reason: substituted standard
   English loses the Pidgin tokens the scorer looks for.

## Fine-tuning status

Fine-tuning is not running on the current workstation. The machine is a 4-core i7-8550U with 8 GB
of RAM, Intel UHD 620 graphics and no CUDA GPU, and the repo has no training loop. A real Whisper
fine-tune needs a GPU and hours of compute; the public corpus is also read speech from quiet rooms,
so a model trained only on it would not transfer to far-field meetings with cross-talk.

The plan is to wait for the private golden set, then fine-tune a LoRA adapter on `whisper-small`
with the public Pidgin clips mixed in. That can run on a free Kaggle or Colab T4, or a rented GPU
if the team approves the cost. Until then, prompt and glossary work is the measured path.

## Limits

- Sentence-level, read speech in quiet rooms. No far-field, cross-talk, fast chat or silence.
- One public sample of 30 clips. Confidence intervals are wide, so treat small deltas as noise.
- Speaker labels are not in the corpus, so diarization cannot be scored here.
- This does not train or adapt a model. It records what the shipped pipeline does before tuning.
- The correction aliases were written after looking at these 30 clips, so the matcher numbers are an
  upper bound. The prompt and prompt-plus-glossary numbers are the cleaner signal.
- One run per variant. Hosted Whisper is stochastic, so rerun before trusting a delta under 2 points.

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

# prompt and glossary variants
npm run eval:public:glossary
npm run eval:public:pidgin
npm run eval:public:score:pidgin
npm run eval:public:pidgin:glossary
npm run eval:public:score:pidgin:glossary

# pronunciation matcher on the best run
npm run eval:glossary:test
npm run eval:glossary:apply
npm run eval:public:score:glossary
npm run eval:glossary:apply:words
npm run eval:public:score:glossary:words
```

Raw runs live in `eval/results/`, which is gitignored. `audio/` is also gitignored, so recordings
never enter the repository.

## 2026-11 shipped prompt check

The mixed-register set changed the Pidgin prompt to "Nigerian English mixed with Nigerian Pidgin"
and added the cross-talk line. This public pack was re-run with that shipped prompt and no
glossary on 2026-11-19: 43.8% WER and 60.0% keyword recall, against 43.5% and 62.5% for the
previous Pidgin prompt. The change is neutral on clean single-speaker Pidgin and wins on the
Brekete cross-talk clips, so the public floor still holds.

## Next step

Run the private golden set. It is the only place that can score hallucination on noise, briefing
fact retention, far-field rooms and cross-talk, which is where the product actually lives. When it
lands, add it to `eval/golden/manifest.json` and use the same correction table format to measure the
real matcher gain instead of this alias-informed upper bound.
