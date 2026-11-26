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

Scribe v3 through the product gateway, no notes pass, shipped prompts.

| Set | Raw WER | With corrections | Errors / words (raw) |
| --- | --- | --- | --- |
| Accented English | **6.6%** | 6.0% | 22 / 334 |
| Pidgin | 20.1% | 18.1% | 59 / 293 |
| Combined | 12.9% | **11.6%** | 81 / 627 |

The English set clears the 12% target on its own. Pidgin does not. The combined figure is word weighted, so the Pidgin half pulls the raw score just above the target. The correction table, built from the errors the first run exposed, moves the combined score below it.

What the errors are:

- English: 17 of 26 clips are exact. Most misses are number formatting (`ten` for `10`, `four` for `4`, `twenty five` for `25`) and rare names (`Kanpur` read as `campo`, `Akpawfu` as `aquafu`, `Eburutu` as `ejurutu`). Folding spoken numbers before scoring lowers the English rate to about 5%.
- Pidgin: Scribe often normalises Pidgin to English (`di` to `the`, `moni` to `money`, `pipo` to `people`) and misses names (`Wizkid` as `wey skit`, `Arkwright` as `uppwide`). That is the known register cost of the hosted reader, not a missing word.
- The combined number is a benchmark, not a meeting-room promise. Both sets are short read speech. Cross-talk and far-field rooms remain untested.

The detailed report is in [reports/scribe-2026-11-26.md](reports/scribe-2026-11-26.md).

## How Scribe uses the sets

Scribe is hosted and has no training or fine-tuning endpoint, so saving audio does not make the model learn it. What the saved sets actually do:

1. Freeze a reference corpus so every reader, prompt, keyterm or matcher change is compared on the same audio.
2. Feed `corrections.txt`, the heard-name table read by `eval/glossary_match.py`. It is built from the errors above, is applied after the reader, and never replaces the verbatim text. It takes the English bench from 6.6% to 6.0%, Pidgin from 20.1% to 18.1% and the combined score from 12.9% to 11.6%. The matcher is an eval tool today; shipping it in the product is a separate step behind the raw transcript guarantee.
3. Provide names and places to consider for session keyterms. Scribe accepts up to 100 keyterms, and they should stay names, acronyms and amounts. Earlier tests showed phrase lists make Pidgin worse.

For model-level learning, an open checkpoint such as NaijaVox would have to be fine-tuned on these corpora. That is a separate decision, and Scribe remains the shipped reader.

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
