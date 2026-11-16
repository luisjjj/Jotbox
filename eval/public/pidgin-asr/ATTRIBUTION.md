# Nigerian Pidgin ASR v1.0 baseline pack

Source: `asr-nigerian-pidgin/nigerian-pidgin-1.0` on Hugging Face, CC-BY-4.0.

`audio/` holds 30 clips (244.6 seconds) sampled deterministically from the test split. Audio is gitignored. Transcripts are stored in `transcripts/` and inline in the manifest.

Recreate the pack with:

```bash
node eval/py.mjs eval/import_pidgin_asr.py --split test --count 30
```

## Citation

Rufai, A. M., Abeeb, A., Oduntan, E., Arulogun, T., Adegboro, O., & Ajisafe, D. (2025). Towards End-to-End Training of Automatic Speech Recognition for Nigerian Pidgin. arXiv:2010.11123. https://arxiv.org/abs/2010.11123
