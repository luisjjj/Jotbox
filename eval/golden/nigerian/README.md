# Nigerian golden sets

Fixed reference corpora for the two speech modes JotBox serves in Nigeria: Nigerian Pidgin and Nigerian accented English. The shipped reader is Scribe v3, and these sets are how any change to the reader, prompt, keyterms or matcher is measured.

## What is saved

| Set | Source | License | Clips | Audio | Words |
| --- | --- | --- | --- | --- | --- |
| Pidgin | [asr-nigerian-pidgin/nigerian-pidgin-1.0](https://huggingface.co/datasets/asr-nigerian-pidgin/nigerian-pidgin-1.0) | CC-BY-4.0 | 4,277 | 8.6 h | 73,096 |
| Accented English | [benjaminogbonna/nigerian_accented_english_dataset](https://huggingface.co/datasets/benjaminogbonna/nigerian_accented_english_dataset) | apache-2.0 on the card | 3,402 | 11.1 h | 80,920 |

The complete reference manifests are committed:

- `pidgin-full.json`: every row with split, source filename, reference and duration.
- `english-full.json`: the same for the accented English corpus, with the source path instead of a speaker id.
- `datasets.json`: pinned revision, file sizes and SHA256 for every parquet file.

The audio itself stays in the local dataset cache (`eval/.cache/pidgin-asr` and `eval/.cache/nigerian-golden/english`). It is not committed because the two Pidgin training shards are 298 MB and 307 MB, above GitHub's 100 MB file limit, and the two corpora together are about 1.1 GB. The manifests, the hashes and the pinned revision are the durable copy. `prepare_goldenset.py` restores the exact audio.

## Bench slices

The full corpora are for reference and future fine-tuning. Paid Scribe runs use a fixed slice so the three minute audio cap holds.

| Bench | Clips | Audio | Words |
| --- | --- | --- | --- |
| Pidgin head-to-head | 17 | 116.2 s | 292 |
| Accented English | 26 | 167.8 s | 333 |
| Combined | 43 | 284.0 s evaluated | 625 |

`bench-english.json` is selected deterministically from the test split: 4 to 12 second clips, one per sentence, spread across the split. `bench-pidgin.json` is the exact 17 fresh test clips used for the Scribe comparison. The combined report reuses the Pidgin predictions, so it costs no new Scribe audio.

## Scores, 26 November 2026

Scribe v3 through the product gateway, no notes pass, shipped prompts. Strict WER is the
raw scorer. Folded WER treats a spoken number and its digits as the same token on both
sides, so `twelve states` and `12 states` score as a match. The release gate uses the
folded production number.

| Set | Raw strict | Raw folded | Production strict | Production folded |
| --- | --- | --- | --- | --- |
| Accented English | 6.6% | 4.5% | 5.7% | **3.6%** |
| Pidgin | 20.1% | 19.9% | 18.8% | 18.6% |
| Combined | 12.9% | 11.7% | 11.8% | **10.6%** |

"Production" applies the shipped name table in `server/api/nigerian-corrections.json`.
The table is deliberately smaller than the diagnostic table in `corrections.txt`: it keeps
only variants that are not ordinary English words. Ambiguous readings such as `campo`,
`ogbe`, `obi ano` and `azuri` stay out because they can be real names.

The English set meets the 5% target once numbers are folded and the shipped names are
applied. Pidgin does not and cannot with this reader. The combined figure is word
weighted, so the Pidgin half sets the ceiling.

What the errors are:

- English: 19 of 26 clips are exact after production corrections. The remaining misses are
  word choices (`doughnut` for `donut`), one spelling (`edikang ikong` for `edikaikong`)
  and a rare bird name. Number formatting is no longer an error because both sides are
  folded.
- Pidgin: Scribe often normalises Pidgin to English (`di` to `the`, `moni` to `money`,
  `pipo` to `people`) and misses names (`Wizkid` as `wey skit`, `Arkwright` as
  `uppwide`). The name table fixes the names it can prove. The register changes are the
  known cost of the hosted reader, not a missing word, and a safe string table cannot
  undo them.
- The combined number is a benchmark, not a meeting-room promise. Both sets are short read
  speech. Cross-talk and far-field rooms remain untested.

The detailed report is in [reports/scribe-2026-11-26.md](reports/scribe-2026-11-26.md).

## How the sets reach production

Scribe is hosted and has no training or fine-tuning endpoint, so saving audio does not
make the model learn it. The sets reach production in three measured ways:

1. **Name corrections.** `server/api/nigerian-corrections.json` is the shipped table, and
   `server/api/nigerian-corrections.mjs` applies it to the final transcript for English
   and Pidgin sessions only. It matches whole words, preserves word timing and trailing
   punctuation, and skips live caption chunks because a phrase can straddle two chunks.
   Pidgin register words are never rewritten.
2. **Regression gate.** The committed baseline and `gate.py` catch a reader, prompt,
   correction or scoring change that moves WER. This is the automatic check.
3. **Keyterms.** Scribe accepts up to 100 names and room words. Names and the configured
   vocabulary are already sent on every plan. A default list of Nigerian terms was not
   enabled because it would make every session pay the keyterm rate; see the cost note
   below.

For model-level learning, an open checkpoint such as NaijaVox would have to be fine-tuned
on these corpora. That is a separate decision, and Scribe remains the shipped reader.

## Automatic regression gate

The gate is offline. It reads the committed Scribe baseline, applies the shipped
corrections, folds numbers and checks per-category WER. It needs no audio, no API key and
spends nothing:

```bash
npm run eval:nigerian:gate          # all three sets, exits 1 on a regression
npm run eval:nigerian:gate:self     # checks the gate's own number and correction logic
```

The same check runs on every pull request in
[.github/workflows/nigerian-accuracy.yml](../../../.github/workflows/nigerian-accuracy.yml).

Gates are the measured ceiling plus a small guard, not an aspiration:

| Set | Gate | Measured |
| --- | --- | --- |
| Accented English | <= 5.0% folded | 3.6% |
| Pidgin | <= 19.0% folded | 18.6% |
| Combined | <= 11.5% folded | 10.6% |

A single 5% target for the combined set is not reachable while Pidgin sits near 19%.
Scribe translates Pidgin into standard English even when the prompt says not to, and
reversing that with a string table would corrupt ordinary English. English is the set
that can hold a 5% gate.

To measure a fresh reader or prompt, run one paid set at a time. Each manifest is under
the three minute cap, and the script refuses anything longer:

```bash
ALLOW_PAID_EVAL=1 npm run eval:nigerian:live -- --set english
ALLOW_PAID_EVAL=1 npm run eval:nigerian:live -- --set pidgin
```

`live_run.mjs` prints the audio seconds and estimated cost before it calls Scribe. It
reuses the other set's last run for the combined check, freezes the fresh transcripts
under `eval/results/naija-live-baseline`, and scores them without overwriting the
committed baseline. Refresh the committed baseline only when a new score is accepted:

```bash
npm run eval:nigerian:freeze
```

## Production path and cost

The final recording takes this path:

1. The client records and uploads the full audio when the session stops
   (`apps/web/src/engine/SessionEngine.tsx:877`). Live captions are a separate preview.
2. The server job reads the audio with Scribe v3, using the session language, diarization
   and the roster keyterms (`server/api/jobs.mjs:163`).
3. The reader output is normalised, then the Nigerian name table runs on the final
   transcript (`server/api/ai.mjs:949`).
4. Words become transcript lines (`server/api/jobs.mjs:22`) and the notes chain runs
   (`server/api/ai.mjs:1341`).

Cost does not change. The corrections are local string replacements, the score gate is
offline, and the golden audio never reaches production storage. Scribe already charges the
keyterm rate on sessions that carry roster names; enabling a default Nigerian keyterm list
would add $0.05 per final audio hour to sessions that currently have no names. That is why
the default list stays off. The notes pass is unchanged.

## Prepare and run

```bash
npm run eval:setup
npm run eval:nigerian:prepare
```

`eval:prepare` downloads both datasets at the pinned revisions, writes the full manifests, writes the English bench if it is missing, and extracts the two bench audio folders. Add `--extract all --set english` to materialise the full English corpus as 16 kHz WAV, about 1.8 GB for both languages. `--force` rebuilds committed manifests.

Run the English bench:

```bash
node --env-file-if-exists=.env --env-file-if-exists=.env.local eval/run_pipeline.mjs --manifest eval/golden/nigerian/bench-english.json --out eval/results/scribe-nigerian-english --no-notes --language en
PYTHONIOENCODING=utf-8 eval/.venv/Scripts/python.exe eval/score.py --manifest eval/golden/nigerian/bench-english.json --predictions eval/results/scribe-nigerian-english/predictions.json
```

Run the Pidgin bench:

```bash
node --env-file-if-exists=.env --env-file-if-exists=.env.local eval/run_pipeline.mjs --manifest eval/golden/nigerian/bench-pidgin.json --out eval/results/scribe-pidgin-fresh-17 --no-notes --language pcm
```

Build the combined report from two existing runs:

```bash
python eval/golden/nigerian/combine_bench.py --pidgin eval/results/scribe-pidgin-fresh-17/predictions.json --english eval/results/scribe-nigerian-english/predictions.json
PYTHONIOENCODING=utf-8 eval/.venv/Scripts/python.exe eval/score.py --manifest eval/golden/nigerian/bench-combined.json --predictions eval/results/scribe-nigerian-combined/predictions.json
```

## Caveats

- The English card declares apache-2.0, but the clips look Common Voice derived (sentence prompts, `clips/` paths, `client_id`, and a Common Voice identity clause in the card). Check the source terms before redistributing audio.
- The English split includes long open-ended recordings as well as read sentences. The bench filters to 4 to 12 second clips, so it measures sentence reading, not monologue.
- The Pidgin test split is read sentence audio from ten speakers in quiet settings. It is not a room recording.
- Neither set has noise-only clips, entity annotations or action facts, so hallucination, keyword recall and briefing retention stay unscored here.
- The 26 and 17 clip slices are regression checks, not final accuracy levels. Widen them before quoting a launch number.
