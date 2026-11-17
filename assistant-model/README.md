# Global SAR AI: knowledge base, classifier, live research and the language model

Acceptance test results, run live on 2026-11-16: [ACCEPTANCE.md](ACCEPTANCE.md). The optional language model and its
training pipeline: [MODEL.md](MODEL.md).

The assistant in the app ("Ask" in the top bar, and "Ask about this investigation") runs entirely in the
visitor's browser: no server, no account, and no question leaves the device. This folder holds what it is
built from.

## How it answers

1. **Understand the question.** Two signals are combined (`web/src/assistant/local/core.ts`):
   - a word search (BM25) with synonyms, Turkish stems and typo repair;
   - an **intent classifier trained on this project's own example questions**, which recognises a question even
     when it shares few words with the answer, and recognises questions outside the assistant's field.
   A follow-up such as "and its limits?" or "tell me more" is read together with the previous question.
2. **Gather sources.** Checked knowledge records (`web/public/data/assistant/kb.json`), the items open in the
   view (the investigation, its layers, probed products) and, for questions about events on the map, the
   catalog snapshot the globe draws (`web/public/data/context.json`).
3. **Research.** A question the knowledge base cannot answer with confidence ("Tell me about Türkiye", "How does
   gravity work?"), or one that asks for the latest news, is searched live on Wikipedia from the visitor's browser
   (`web/src/assistant/local/research.ts`), in Turkish first for a Turkish question. The answer is the page's own
   summary, cited with its link and the date the page was last edited, and labelled as not checked by the team. A
   page that does not mention the subject is skipped. When the search cannot run, the assistant says so.
4. **Answer.** The answer is the text of the best source or sources, each marked with its citation, followed by
   suggested follow-up questions. A catalog answer is counted from the catalog file, never estimated.

When the build offers the language model (`VITE_ASSISTANT_MODEL`) and the visitor loads it, it words the answer
from the same sources; its text is shown only when every citation names a source it was given. It is not deployed
on globalsar.earth today (see [ACCEPTANCE.md](ACCEPTANCE.md)).

Facts live in the knowledge base, where each has a source and can be corrected by editing a JSON file. The
classifier never supplies facts; it only decides which record a question is about. When nothing matches, the
assistant says what it can help with and offers questions instead of guessing.

## The knowledge base (177 records)

`node assistant-model/build_kb.mjs` builds it from:

| Source | Records | Checked how |
| --- | --- | --- |
| The app's own vetted text: radar explainers, the five investigations, 20 satellite layers and their legends | 72 | Copied as is from `web/src/content/explain.ts`, `events.json`, `layers.json` |
| App and project guide (`knowledge/app.json`, `knowledge/project.json`): tools, team, results, methods, pipeline, technology, glossary, small talk | 72 | Hand-written from what the app shows and from the project README; English and Turkish |
| Radar reference (`knowledge/radar_reference.json`): NISAR's orbit and radars, radar bands, scattering, geometry | 9 | Each claim checked against its cited NASA or ASF page on 2026-11-16; what the pages did not state was left out |
| General SAR / NISAR facts (`knowledge/verified_sar.json`) | 24 | Each checked against its cited NASA / USGS / NOAA / Earth Engine page on 2026-11-14 |

140 of the 177 records have a Turkish text. Where the app already has a Turkish translation of a text
(`web/src/i18n/tr.ts`) the builder uses it; a record without one is answered in English, with a note.

The 24 general facts come from 83 legacy records supplied with the first prototype. Of those, 41 had no source
and were dropped; of the 42 with a source, 6 were supported as written, 18 were trimmed to what the source
actually says, 10 were not supported by the page they cited and 8 cited a NASA PDF that no longer exists. Only
the 24 supported or trimmed ones are used. `verified_sar.json` keeps the verdict and the evidence for all 42.

## The intent classifier

`node assistant-model/train_intent.mjs` trains it and writes `web/public/data/assistant/intent.json` and
`intent.bin` (about 0.7 MB).

- **What it is:** a multinomial logistic regression over 4,096 hashed features of the question: its words, word
  pairs, synonyms and the 3 to 5 letter pieces of each word (which is what makes typos and Turkish suffixes land
  near the right word). One class per knowledge record plus an off-topic class: 178 classes.
- **Training data:** the records' example questions in English and Turkish (2,729 of them, in
  `knowledge/*.json` and `knowledge/paraphrases.json`), each also in roughened forms (a typo, a dropped word, a
  filler phrase), plus off-topic questions (`knowledge/offtopic.json`, `knowledge/offtopic_extra.json`):
  11,429 examples, 40 epochs, about ten seconds on a laptop CPU. No GPU and no downloaded weights are involved.
- **Deterministic:** the same knowledge base always gives the same weights, and a test checks that the shipped
  files are what the script produces today.
- **A helper, not a requirement:** if the weight files cannot be loaded, or were trained for a different
  knowledge base, the assistant ignores them and answers by word search alone.

## Measured results

`node assistant-model/eval_retrieval.mjs [--file=stress_test2.json] [--words-only]`

| Stress set | | Right record first | Right record in top 3 | Off-topic given a source |
| --- | --- | --- | --- | --- |
| `stress_test.json` (128 questions, 22 off-topic), used for tuning | words only | 85.9 % | 94.5 % | 45.5 % |
| | with the classifier | 93.8 % | 98.4 % | 13.6 % |
| `stress_test2.json` (92 questions, 22 off-topic), held out | words only | 69.6 % | 82.6 % | 31.8 % |
| | with the classifier | 81.5 % | 91.3 % | 0.0 % |

Reading this honestly:

- The first set was used to tune thresholds and to write extra paraphrases, so its numbers are optimistic. The
  second set was not used for either, and wordings resembling its questions were kept out of the training
  questions; it is the fairer measure. A unit test (`web/tests/unit/assistant/retrieval-stress.test.ts`) fails
  if its numbers fall.
- The gold labels of both sets were extended on 2026-11-16 for records added after the sets were written (a new
  record that answers the question counts as correct), and two "who made you" questions moved from off-topic
  to answerable because the knowledge base now answers them. Each file's note says so.
- About one held-out question in five does not get the best record first. In the app a low-confidence match is
  shown as "the closest topic I know", with suggestions, so the reader can tell.
- "Off-topic given a source" counts questions answered from a record instead of being sent to live research.
- Of 22 off-topic questions never seen in training, the classifier alone recognises 17; the word-coverage rule
  catches most of the rest. A determined user can still find an unrelated question that gets a record.
- Both sets are small and written by the project. They say nothing about questions on subjects the knowledge
  base does not cover.

## Rebuild

```bash
node assistant-model/build_kb.mjs        # knowledge base (Node 22.6 or newer)
node assistant-model/train_intent.mjs    # classifier, about ten seconds
node --test assistant-model/assistant-model.test.mjs
```

Run both steps after any change to `knowledge/*.json`, `events.json`, `layers.json` or `explain.ts`: the
classifier has one class per record, so it must be retrained when records are added or removed.

## Known limits

- Without the language model, the assistant answers from its records, the open view, the catalog and one
  encyclopedia page per question. It does not combine sources, reason beyond them, do arithmetic or hold a free
  conversation.
- Live research needs an internet connection and Wikipedia; NASA and ISRO sites cannot be searched from a static site.
- English and Turkish only. Most satellite-layer records have English text only.
- The catalog answers come from the snapshot bundled with the site, not from a live feed.
- The assistant cannot predict earthquakes or any other event, and says so.
