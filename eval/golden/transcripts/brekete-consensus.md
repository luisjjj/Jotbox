# Brekete mixed-register set

Five 90 second windows from the Brekete Family Programme broadcast of 18 November 2026.
The show mixes Nigerian English with heavy Pidgin, callers, prayers, a word game and
frequent cross-talk, which is the condition the private golden set was missing.

| Clip | Category | Content |
| --- | --- | --- |
| `brekete-mixed-1490` | pidgin | A panel discusses leadership and advice in mixed English and Pidgin |
| `brekete-talk-1920` | fast | Overlapping discussion about teaching, understanding and age |
| `brekete-pidgin-3440` | pidgin | A pension and gratuity follow-up with the ordinary president |
| `brekete-wordgame-6950` | fast | A fast word game with several voices over each other |
| `brekete-caller-11960` | pidgin | A caller thanks the show in heavy Pidgin |

Audio stays in `eval/golden/audio/` and is gitignored. The source file is a 3 hour 34
minute MP3 at 48 kHz stereo; the clips were cut at 16 kHz mono, 64 kbps. No denoiser or
normalizer was applied, so the reader meets the same broadcast sound a user would record.

## Reference method

There is no human transcript of this broadcast. The committed references are a
**consensus of three `whisper-large-v3` passes** over each clip:

1. The English prompt.
2. The Pidgin-first prompt.
3. The mixed-register prompt.

The longest transcript is the backbone. Each pass is aligned to it with
`difflib.SequenceMatcher`, and each slot takes the word that at least two passes agree on.
Insertions outside the backbone are kept, deletions are ignored.

Treat these numbers as a comparison against a **machine reference**, the same way the
Adichie lecture set uses its corrected YouTube captions. Absolute WER is not a human
accuracy figure, and the mixed-register prompt is one of the three votes, so its own score
is optimistic. Use the table to compare prompt families and to catch regressions, not to
claim a field accuracy rate.

Scoring strips punctuation and case, and maps number words to digits, exactly as the rest
of the harness does.

## Results, 19 November 2026

Five clips, 1,156 reference words, Groq `whisper-large-v3`, no notes. Each family was run
twice unless marked. WER is the mean of the runs.

| Prompt family | Runs | WER | Keyword recall | Pidgin markers per 1k words |
| --- | --- | --- | --- | --- |
| Reference | | | | 50.2 |
| English prompt, before this set | 2 | 42.0% | 76.4% | 17.4 |
| English prompt made Pidgin-aware | 3 | 25.7% | 86.1% | 48.1 |
| Pidgin prompt, before this set | 2 | 14.5% | 95.8% | 48.6 |
| Pidgin prompt plus cross-talk line | 2 | 15.0% | 94.4% | 52.2 |
| Mixed-register prompt | 3 | 7.0% | 97.2% | 51.7 |
| Mixed-register prompt plus glossary | 1 | 34.4% | 91.7% | 28.0 |

The marker count checks language retention. It counts `dey, don, na, wetin, abeg, wahala,
wey, im, di, sabi, wuna, una, shey, sotey, pikin, chop, oga` per thousand words.

Final check after the prompts were wired into the app, one run each: the shipped English
prompt scored 18.3% WER with 94.4% keyword recall, and the shipped Pidgin prompt scored
10.6% with 94.4%. The public 30 clip Pidgin set, re-run with the shipped Pidgin prompt and
no glossary, scored 43.8% against 43.5% for the previous Pidgin prompt, so the public floor
held.

## Names-only biasing check

The runner gained a `--no-names` switch on 19 November 2026. It leaves the clip names out of
the reader prompt while the title, focus line and provider stay the same, so name biasing can
be measured in isolation. Two complete runs per variant, shipped English prompt, no notes:

| Set | Names off | Names on |
| --- | --- | --- |
| Adichie lecture, 954 words | 7.2% WER, 84.6% recall (both runs) | 7.3% WER, 84.6% recall (both runs) |
| Brekete mixed, 1,156 words | 26.6% and 35.3% WER, 94.4% and 72.2% recall | 21.5% and 20.2% WER, 100% and 94.4% recall |

On Adichie the top line does not move. The prompt fixed `Chika Okeke-Agulu`, but it turned
`Africa World Initiative` and `Africa World Lectures` into `Africa Wold ...`, so the name gain
and the phrase loss cancel. On Brekete the mean improves by about 10 points, but one names-off
run returned an empty wordgame transcript, and that clip has no names, so that run is a filter
failure rather than a biasing effect. Per clip, names helped the mixed panel (54.8% to 11.8%),
the caller (18.5% to 12.3%-14.2%) and the teaching clip (5.0% to 3.7%), and hurt the pension
clip (19.7% to 25.4%-36.0%).

The honest read is that names are not a reliable English lever. Keep them, because the roster
is already part of a session and the Brekete average improves, but do not widen the hint to
keywords or phrases. The glossary run above already showed that turns a 7.0% prompt into
34.4%. A third pass was stopped by Groq's hourly audio cap of 7,200 seconds, so the means use
two complete runs per variant.

Raw runs are in `eval/results/brekete-*/` on the machine that produced this report and
are gitignored.

## What the numbers say

1. **An English-only prompt translates Pidgin and drops overlapping turns.** It scores
   42.0% WER, keeps only 17.4 Pidgin markers per thousand words against the reference's
   50.2, and misses a quarter of the target names and phrases. This is a content loss, not
   just spelling.
2. **Making the English prompt Pidgin-aware recovers most of it.** WER falls 16.3 points
   and keyword recall rises 9.7 points. The shipped English prompt now carries the Pidgin
   clause, the marker list and the cross-talk rule from that variant.
3. **The Pidgin-first prompt was already close on this set.** It keeps the language but the
   mixed-register wording is still 7.5 points better on WER and 1.4 points better on
   keyword recall, so both language settings now use the mixed wording.
4. **Do not inject multi-word Pidgin phrases as room vocabulary.** The glossary run added
   the clip keywords to the 896 character prompt and WER jumped to 34.4%, with longer
   decodes and more content that does not match the reference. The harness already warns
   about prompt echo; this set shows a second failure mode on overlapping speech. Keep
   `JOTBOX_STT_VOCAB` to names, acronyms and amounts.
5. **Cross-talk is still the weak spot.** Even the best family misses 3 percent of target
   terms, and single-run WER moves by 5 to 8 points. The reader has no speaker boundary to
   lean on, which is the diarization gap below.

## Diarization

The Groq endpoint accepts `diarize=true` but returns `SPEAKER_00` for every word with
`speaker_confidence` 0 on all five clips and on a 30 second probe, so the field is a
placeholder. The xAI reader is the only provider wired for diarization
(`diarize: true` in `transcribeWithXai`), and the key in this environment is empty.
Nothing in this set can measure real speaker turns yet.

Two product changes shipped with this batch:

- `normalizeTranscription` now maps provider labels such as `SPEAKER_00` and `speaker_1`
  to turn indexes, so a future diarizing provider needs no client change.
- The transcript labels a recording with no diarization as **Speaker 1** instead of leaving
  lines anonymous. `TranscriptView` shows the label once at the top of a run, and the People
  card offers the usual rename. When a provider does diarize, the numbered turns appear the
  same way.

A real diarization pass needs either a diarizing hosted reader, a self-hosted WhisperX or
pyannote worker, or overlapping speech separation before the reader. This set is ready for
all three: score speaker turn assignment separately from WER, and never let diarization
change the transcript words.
