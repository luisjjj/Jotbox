# Voice data banks for Nigerian ASR

Verified on 16 November 2026. Licenses and access rules change, so open the dataset card before you download and keep the license text with any copy you keep.

## Short answer

Yes. There are usable public corpora, but none of them cover the hard JotBox cases: far-field meeting rooms, generator noise, cross-talk, and silence that must produce no words. Use public data for a fast Pidgin WER floor and speaker variety. Keep the private golden set as the release gate.

## Corpora

| Dataset | What it covers | Size | License | Access | Use in JotBox eval |
| --- | --- | --- | --- | --- | --- |
| [Nigerian Pidgin ASR v1.0](https://huggingface.co/datasets/asr-nigerian-pidgin/nigerian-pidgin-1.0) | Nigerian Pidgin, 10 native speakers, everyday topics, 8 to 14 words per utterance | 4,277 clips, about 956 MB, 16 kHz WAV | CC-BY-4.0 | Public, not gated | Best quick Pidgin regression set. Import a sample into the manifest. |
| [Common Voice 27.0, Nigerian Pidgin](https://mozilladatacollective.com/datasets/cmu5ufsxn007snq07xuxba0uc) | Volunteer-read Nigerian Pidgin sentences, 60 speakers | 8,964 clips, about 14.45 h, 12.5 h validated | Mozilla Common Voice terms, generally CC0. Verify on the download page. | Mozilla Data Collective account | Speaker and pronunciation variety. Read speech only. |
| [AfriSpeech-200](https://huggingface.co/datasets/intronhealth/afrispeech-200) | African-accented English across 13 countries. Nigeria is the largest slice. | 200 h, 67,577 clips, 2,463 speakers. Nigeria: 45,875 clips, 1,979 speakers, about 120 GB | CC BY-NC-SA 4.0 | Gated, accept terms | Accent robustness in development only. It is accented English, not Pidgin, and the license is non-commercial. |
| [AfriSpeech-Countries](https://huggingface.co/datasets/intronhealth/afrispeech-countries) | Country slices of the same collection | 21,581 clips, 67.73 h, 536 MB. Nigeria: 8,567 clips, 28.28 h | CC BY-NC-SA 4.0 | Gated, accept terms | The small download to start with. Same non-commercial caveat. |
| [NaijaVoices](https://huggingface.co/datasets/naijavoices/naijavoices-dataset) | Igbo, Hausa and Yoruba speech, not Pidgin | 1,800 h, 5,000+ speakers, 500+ GB raw or about 84 GB compressed | CC BY-NC-SA 4.0 | Gated, accept terms | Not a Pidgin test. Only useful for name and accent phonetics. |
| [African Voices](https://africanvoices.io/download) | Pidgin, Yoruba, Hausa and Igbo | Nigerian Pidgin alone is 461.6 GB | CC BY-4.0 per the site | Account and download flow | Large, commercial-friendly Pidgin coverage if the download terms hold. Too large for routine runs. |
| [OpenSLR 70, Nigerian English](https://www.openslr.org/70/) | Read Nigerian English | See the SLR page | See the SLR page | Direct download | A small sanity check for Nigerian English. Not Pidgin. |

Catalogs worth watching:

- [ToNative dataset tools](https://tonative.org/dataset-tools)
- [Lacuna Fund datasets](https://lacunafund.org/datasets/language/)
- [Open Trusted Data Initiative catalog](https://the-ai-alliance.github.io/open-trusted-data-initiative/catalog/)

## What public corpora cannot tell you

- They are mostly short, clean, read or prompted utterances. Meeting audio is longer, quieter at the edge, and full of interruptions.
- They have no ground truth for hallucination. You need noise-only recordings to prove the reader returns nothing.
- They rarely contain the exact names, acronyms and amounts your users say. Entity recall has to come from your own glossary and clips.
- Pidgin coverage is still thin. Code-switching inside one sentence is especially rare.

This is why the manifest has a `noise` category and a private `audio/` folder even when public corpora are imported.

## Importing a public corpus

Install the Hugging Face client, accept the dataset terms on the website, then download:

```bash
python -m pip install -U "huggingface_hub[cli]"
huggingface-cli login
huggingface-cli download asr-nigerian-pidgin/nigerian-pidgin-1.0 --repo-type dataset --local-dir eval/.cache/pidgin-asr
```

The Pidgin corpus has `sentence`, `filename` and `audio` columns, split into 2,710 train, 677 validation and 892 test clips. Pick a fixed slice of the test split for regression runs so the score is comparable over time. The recordings were made in quiet settings with the LigAikuma app, but the card notes occasional doors, table knocks, laughter and hesitations that are not in the transcript. That noise is useful, but it is not the same as a far-field meeting room.

Common Voice, AfriSpeech and NaijaVoices are gated, so the download only works after the account has accepted the terms. Inspect the dataset card for the audio and transcript column names before exporting. Convert each selected clip to 16 kHz mono WAV and add a manifest entry:

```bash
ffmpeg -i input.wav -ar 16000 -ac 1 eval/golden/audio/pidgin-public-01.wav
```

Keep imported public clips in a separate id range, for example `public-pidgin-01`, so private and public results can be compared. Public audio cannot be committed either: `eval/golden/audio/` is gitignored.

## License guidance

- CC-BY-4.0 allows commercial use with attribution. Keep the dataset name and link in your notes.
- CC BY-NC-SA 4.0 is non-commercial. Do not use it for paid product evaluation or redistribute derivatives without checking the terms.
- Gated datasets add their own usage agreement on top of the license.
- Before shipping a model trained on any corpus, check whether the license covers model training and commercial deployment. The JotBox app currently calls hosted Whisper, so the eval use is testing, not training.
