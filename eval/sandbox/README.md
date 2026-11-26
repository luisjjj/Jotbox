# Open-weight Pidgin model sandbox

Offline scores for open-weight Nigerian Pidgin readers, measured on 26 November 2026 before any change to the app. Nothing here runs in production and nothing writes to the database.

The shipped reader is hosted. These checkpoints come from Nigerian teams and published fine-tunes, so the question is whether a self-hosted reader would be more accurate and affordable than the hosted path. Answer that with numbers first.

## Hardware

Consumer Windows laptop, 8 CPU cores, 7.8 GB RAM. CTranslate2 int8 on 4 threads, no GPU. The speed column describes this laptop only. Do not read it as server latency.

## Fresh clip set

`prepare_fresh_sample.py` takes a stride sample of the public [Nigerian Pidgin ASR v1.0](https://huggingface.co/datasets/asr-nigerian-pidgin/nigerian-pidgin-1.0) test split, skipping the rows and sentences already used by the 30 clip pack in `eval/public/pidgin-asr`. That matters: the shipped Pidgin prompt, glossary and matcher were tuned on those 30 clips, so scoring open models there would compare a tuned baseline against untuned candidates.

The full pack is 100 clips, 1,702 reference words, 710.1 seconds of audio, CC-BY-4.0. The runs below score the first 20 clips (333 words, 130.9 seconds) because that fits this machine's memory and time budget. Audio and manifests stay under `eval/.cache/`, which is gitignored.

## Results

Corpus level WER from `eval/score.py`, same 20 clips and same references for every row.

| Reader | Checkpoint | License | WER | Errors / words | Speed |
| --- | --- | --- | --- | --- | --- |
| NaijaVox-2.0 | `amn-raw/naijavox-2.0-int8-ct2` | Apache-2.0 upstream (`Axiveri/NaijaVox-2.0`, Whisper large-v3 fine-tune) | **16.5%** | 55 / 333 | 0.16x realtime |
| African Voices Naija turbo | `Africanvoice/african_voices_naija_turbo` converted to int8 CT2 | Apache-2.0 (`openai/whisper-large-v3-turbo` fine-tune) | 21.0% | 70 / 333 | 0.23x realtime |
| Whisper large-v3-turbo, base | `deepdml/faster-whisper-large-v3-turbo-ct2` | MIT (OpenAI weights) | 48.6% | 162 / 333 | 0.25x realtime |

Per clip spread:

| Reader | Median | Best | Worst |
| --- | --- | --- | --- |
| NaijaVox-2.0 | 16.2% | 0.0% | 40.0% |
| African Voices Naija turbo | 21.2% | 0.0% | 50.0% |
| Whisper large-v3-turbo, base | 59.2% | 33.3% | 93.3% |

NaijaVox beats the base turbo on all 20 clips and the African Voices fine-tune on 12 of 20, with 4 ties. The 32 point gap to base turbo is the fine-tune, not the sample: both fine-tunes see the same audio, references and decoder settings.

The best model still misses the 12% release target in `eval/public/pidgin-asr/manifest.json` on this harder sample. Treat that target as aspirational for read Pidgin until a model clears it.

## What the transcripts show

Base Whisper translates Pidgin into English and drops the register, which is exactly what JotBox must not do:

```text
reference: say dem di oda 3 dey give am heat dats why him change him mind
base:      Send them the other three to give them heat. That's why I'm changing my mind.
naijavox:  say dem dey only 3 dey give am head dat's why hin change him mind
```

Both fine-tunes keep Pidgin word order and spelling. The remaining errors are names, not grammar:

```text
reference: ... she don com again con dey beg wizkid for
naijavox:  ... she don com again con dey beg race kids for
reference: ... according to paul arkwright
naijavox:  ... according to paul upward
```

Names, brands and amounts are the reason the glossary matcher and keyterms exist. A fine-tune does not remove that work. Score entity recall before deciding the reader.

## Speed and production shape

At 0.16x to 0.25x realtime on 4 laptop CPU threads, a 45 minute meeting needs 3 to 4.7 hours of compute. That rules out in-process inference in a Vercel function, which also caps memory and wall time, and it rules out a small CPU worker for live captions.

The production shape is a GPU worker behind `WHISPER_BASE_URL` or a hosted endpoint, with the existing gateway unchanged. Before that, measure on the target GPU, because CTranslate2 int8 is several times faster on a CUDA device.

One more caveat on memory: the NaijaVox conversion repo `amn-raw/naijavox-2.0-int8-ct2` is a third-party upload with no model card. It ships without `preprocessor_config.json`, so `run_faster_whisper.py --feature-size 128` writes one locally; without it faster-whisper feeds 80 mel bins to a 128 bin encoder and fails. Weights are unchanged. Prefer converting the upstream checkpoint yourself for anything beyond a sandbox.

## Reproduce

```bash
python -m pip install -r eval/sandbox/requirements.txt
python -c "from huggingface_hub import snapshot_download; snapshot_download('asr-nigerian-pidgin/nigerian-pidgin-1.0', repo_type='dataset', local_dir='eval/.cache/pidgin-asr-full', allow_patterns=['data/*.parquet'])"
python eval/sandbox/prepare_fresh_sample.py
python eval/sandbox/run_faster_whisper.py --manifest eval/.cache/pidgin-fresh-100/manifest.json --model amn-raw/naijavox-2.0-int8-ct2 --name naijavox-2.0 --out eval/results/naijavox-fresh --limit 20 --threads 4 --feature-size 128
eval/.venv/Scripts/python.exe eval/score.py --manifest eval/.cache/pidgin-fresh-100/manifest.json --predictions eval/results/naijavox-fresh/predictions.json
```

For a transformers checkpoint that has no CT2 build, convert it first. The African Voices model is fp16 safetensors, which needs about 3 GB to load as fp32 on CPU, so int8 conversion keeps the subsequent runs inside this laptop's memory:

```bash
ct2-transformers-converter --model Africanvoice/african_voices_naija_turbo --output_dir eval/.cache/models/africanvoice-ct2-int8 --quantization int8 --low_cpu_mem_usage
```

Then run `run_faster_whisper.py --model eval/.cache/models/africanvoice-ct2-int8 --feature-size 128`.

## Caveats

- 20 clips only, all read speech from one public corpus. Meeting rooms, cross-talk and generator noise are untested.
- No noise clips here, so hallucination is unscored. No keywords either, so entity recall is unscored.
- The fresh set comes from the same corpus family as the previous 30 clips, so it measures model quality on that corpus, not on JotBox users.
- `--language en` is deliberate. faster-whisper rejects `pcm` because Pidgin has no Whisper language code; the Pidgin behaviour has to come from the checkpoint.
- Paid hosted readers were not run on this sample. Comparing against the shipped Scribe path costs audio and needs approval first.

## Next steps

1. Run the full 100 clips for NaijaVox and the African Voices model. Roughly 2 hours each on this hardware.
2. Add keyword and entity annotations so the models are scored on names, amounts and dates, not only WER.
3. Test the winning checkpoint on a GPU worker behind `WHISPER_BASE_URL` and measure realtime factor and cost per hour against Scribe.
4. Keep the private golden set as the release gate. A public corpus cannot approve a production switch.
