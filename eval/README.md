# JotBox Gold Standard Evaluation Suite

A repeatable harness for changes to audio filters, the reading prompt, the glossary, the notes prompt, and the provider chain. It runs the same [transcribeAudio](../server/api/ai.mjs) and [enhanceSession](../server/api/ai.mjs) functions the product uses, then scores the output against human-typed transcripts.

Nothing here writes to the app database and nothing here runs in production.

## What it measures

| Gate | How | Target |
| --- | --- | --- |
| Word error rate | `jiwer` over lowercased, punctuation-free text, micro-averaged across clips and per category | 12% or less |
| Keyword and entity recall | Proper nouns, acronyms, amounts, dates and Pidgin keywords from the manifest must appear in the transcript | 95% or more |
| Hallucination rate | Noise-only clips marked `noise` must return zero words | 0% |
| Briefing fact retention | An LLM judge scores actions, deadlines, decisions and inventions from 1 to 10 | 8 or more |

The scorer also reports deterministic fact recall, a per-category WER guard, prompt coverage when the glossary variant is on, and a coverage table for the 20 to 30 clip target.

## Layout

```text
eval/
  README.md                 this file
  DATASETS.md               public voice data banks, licenses and download notes
  score.py                  WER, keyword recall, hallucination, briefing judge, reports
  run_pipeline.mjs          runs the real reader and note writer over the manifest
  requirements.txt          jiwer
  golden/
    manifest.json           categories, thresholds and clip list
    glossary.txt            shared names and terms for the glossary variant
    audio/                  private recordings, gitignored
    transcripts/            human transcripts, committed
  fixtures/
    manifest.json           no-audio fixture for testing the scorer
    predictions.json        sample output for the fixture demo
```

## Quick start

Python 3.10 or newer is required. The npm scripts use `eval/.venv` automatically when it exists.

```bash
npm run eval:setup
```

Or set up the environment by hand:

```bash
python -m venv eval/.venv
```

Windows Git Bash:

```bash
source eval/.venv/Scripts/activate
python -m pip install -r eval/requirements.txt
```

macOS or Linux:

```bash
source eval/.venv/bin/activate
python -m pip install -r eval/requirements.txt
```

Check the scorer without any recordings:

```bash
npm run eval:test
npm run eval:demo
```

`eval:demo` writes a sample report to `.shots/eval-demo/report.md`. It uses the fixtures and the offline mock judge, so it makes no network calls.

## Record the first five clips

You do not need 20 clips to start. Record five 60-second clips this week:

1. Pidgin with code-switching into work English.
2. A phone across the room with a fan or generator running.
3. Nigerian names, acronyms, amounts and dates spoken quickly.
4. Fast cross-talk with interruptions and laughter.
5. A noise-only clip of room tone, fan or traffic.

For the first four, type the exact words into `eval/golden/transcripts/`. Keep Pidgin verbatim. Do not clean up grammar, do not translate, and do not add words that were not said. Mark speaker turns if the labels help you check names. A bare `Speaker 1:` label is ignored by the scorer. A named label like `Ada:` keeps the name, because names are part of entity recall.

Put the recordings in `eval/golden/audio/` and reference them from the manifest. Audio in that folder is gitignored. Review transcripts before committing in case they contain customer details.

Keep two rules while recording:

- Do not run `shapeRoomAudio` or any denoiser on the golden files. The point is to test the reader under the same conditions the product will meet. Put preprocessing behind the `--normalize` variant instead.
- Use the same phone and room for a category when you compare runs over time. Changing the room changes the result more than prompt tweaks do.

## Manifest

Each clip looks like this:

```json
{
  "id": "pidgin-01",
  "category": "pidgin",
  "audio": "audio/pidgin-01.m4a",
  "transcript": "transcripts/pidgin-01.txt",
  "seconds": 60,
  "title": "Friday payout review",
  "names": ["Ada", "Chinedu"],
  "keywords": ["Friday payout", "Ada", "Chinedu", ["before four", "before 4"], "duplicate"],
  "facts": [
    "Same-day payout is paused until the cutoff holds",
    "Ada will send the merchant note before four"
  ],
  "noise": false
}
```

- `category` must match one of the categories in the manifest. The release gate checks WER per category.
- `keywords` holds what must survive: names, acronyms, amounts, dates and Pidgin words. Use an array of alternatives when the same term can be spoken or written two ways.
- `facts` feeds the briefing gate. Write only facts that are actually in the clip. The notes writer should keep each one.
- `noise: true` turns a clip into a hallucination test. Set `reference` to an empty string or leave the transcript out. Any returned word counts as a hallucination.
- `reference` can hold the transcript inline instead of a file. The fixtures use this so the scorer can be tested without audio.

## Run the pipeline

Baseline, using whatever providers are in `.env`:

```bash
npm run eval:run
```

Glossary injection through `JOTBOX_STT_VOCAB`, which is the same budget and prompt path the app uses:

```bash
npm run eval:glossary
```

ffmpeg preprocessing, the variant for testing loudness and room tone:

```bash
npm run eval:normalize
```

Both at once:

```bash
node --env-file-if-exists=.env eval/run_pipeline.mjs --glossary --normalize
```

Useful flags:

- `--only=pidgin,far_field` filters by category.
- `--id=pidgin-01` runs one clip.
- `--limit=5` runs the first five selected clips.
- `--pause=3200` waits between reader calls. Groq's free whisper tier allows 20 requests per minute.
- `--retries=3` retries rate limits and 5xx responses with backoff. The default is 3.
- `--no-notes` skips the note writer and only tests reading.
- `--mock` uses the local demo reader, so it works with no API key and no audio.
- `--out=path` chooses the run folder. The default is `eval/results/<timestamp>/`.

`--normalize` needs ffmpeg. The runner checks `FFMPEG_PATH`, then `PATH`, then the usual Windows winget and Chocolatey install folders:

```bash
winget install Gyan.FFmpeg
# or point at an existing binary
FFMPEG_PATH=/path/to/ffmpeg node eval/run_pipeline.mjs --normalize
```

It applies a highpass filter, `loudnorm` and `dynaudnorm`, then writes 16 kHz mono WAV into the run folder. The original golden file is never changed. If ffmpeg is missing, the runner stops instead of silently running the baseline.

Glossary coverage is recorded per clip. When a term is pushed out of the 896 character reader prompt, `promptCoverage` drops, which tells you the glossary is too long before the WER does. Amounts with commas, such as `₦450,000`, are kept as one vocabulary term instead of being split at the comma.

## Score a run

```bash
npm run eval:score
```

Without `--predictions`, the scorer reads the newest `eval/results/*/predictions.json`. It writes `report.json` and `report.md` beside the run.

Score the fixtures:

```bash
npm run eval:demo
```

Enforce the gates:

```bash
npm run eval:check
```

`eval:check` fails when WER, keyword recall or hallucination misses the target, or when no speech clips, keywords or noise clips were scored. By default the briefing gate is reported but not enforced because the live judge costs tokens.

Full gate with the live judge:

```bash
npm run eval:check:full
```

That runs `--judge --check --require-brief`. The judge calls the Groq chat endpoint with `GROQ_API_KEY` and `GROQ_NOTES_MODEL`, so keep those in `.env`. For offline work, `--judge-mock` scores with a deterministic fact-recall heuristic and labels the verdict as a mock.

Run one category or one run directory:

```bash
python eval/score.py --predictions eval/results/2026-11-16T09-00-00/predictions.json
```

The report includes:

- Overall and per-category WER with reference word counts.
- Keyword recall with the exact missed terms.
- Every noise clip and the invented text it returned.
- Judge score, missing facts and invented facts per clip.
- Deterministic fact recall, which works without an API key.
- Coverage against the 20 to 30 clip target.

## Public Pidgin baseline

The [Nigerian Pidgin ASR v1.0](DATASETS.md) corpus gives a fast regression floor on native Pidgin speech:

```bash
npm run eval:public:import       # deterministic 30 clip test-split pack
npm run eval:public:run          # Groq whisper-large-v3, reading only
npm run eval:public:score
npm run eval:public:normalize    # same clips, ffmpeg conditioned
npm run eval:public:score:normalized
```

Current numbers and caveats are in [eval/public/pidgin-asr/BASELINE.md](public/pidgin-asr/BASELINE.md). The public pack has no noise clips and no annotated facts, so it cannot score hallucination or briefing retention.

## Comparing changes

A change is only useful if it moves a gate without breaking another. Keep the run folders and compare the reports:

| Question | Baseline | Variant |
| --- | --- | --- |
| Did the glossary help names and acronyms? | `eval:run` | `eval:glossary` |
| Did loudness normalization help far-field? | `eval:run` | `eval:normalize` |
| Did the new notes prompt keep facts? | `eval:run` then judge | same run, new prompt |
| Did VAD stop noise hallucinations? | `eval:run` | VAD variant |

Record the variant names and the date in the run folder. Do not compare a baseline from one room with a variant from another room and call the difference a prompt win.

## Next upgrades to test

The harness is ready for these, but they are not wired into the product yet:

1. **Silero VAD.** Run Silero on the decoded audio before the reader, keep only speech segments, and join them with short pauses. The gate is the hallucination rate on `noise` clips, plus a check that clipped sentence starts do not raise WER. `ffmpeg` alone is not a VAD; do not label an energy filter as one in a report.
2. **Two-stage Pidgin and context normalization.** First keep the verbatim transcript, then run a second pass that only fixes spelling, names and acronyms from the glossary. Score the first pass for WER and the second for keyword recall. Never overwrite the verbatim text in the product.
3. **Speaker diarization.** Try pyannote or sherpa-onnx. Score speaker assignment separately from WER, for example by checking that each named owner in the notes matches the person who spoke. Diarization must not change the transcript wording.
4. **Self-hosted Whisper.** The runner already works with `WHISPER_BASE_URL`; compare it against Groq on the same golden set before switching a provider.

## Public data banks

[DATASETS.md](DATASETS.md) lists the usable Nigerian corpora with licenses, sizes and access rules. Short version:

- Use [Nigerian Pidgin ASR v1.0](https://huggingface.co/datasets/asr-nigerian-pidgin/nigerian-pidgin-1.0) (CC-BY-4.0, public) for a quick Pidgin WER floor.
- Add [Common Voice Nigerian Pidgin](https://mozilladatacollective.com/datasets/cmu5ufsxn007snq07xuxba0uc) for speaker variety.
- Use AfriSpeech-Countries for accent stress in development. It is CC BY-NC-SA, so keep it out of commercial evaluation.
- Record the private tough clips anyway. Public corpora do not cover far-field rooms, cross-talk, your users' names or silence hallucinations.

Public audio is not committed either. The same `eval/golden/audio/` rule applies.

## Privacy

- `eval/golden/audio/`, `eval/results/` and `eval/.cache/` are gitignored.
- Transcripts are text and can be committed, but review them for customer names, amounts and anything confidential first.
- Predictions and reports can contain raw transcripts. They stay in gitignored run folders.
- Deleting a run folder removes the normalized audio and the transcript copies for that run.
