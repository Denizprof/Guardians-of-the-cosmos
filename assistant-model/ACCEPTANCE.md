# Global SAR AI: acceptance test record

Run on 2026-11-16 in a real browser (Microsoft Edge, through the app's dev server at `localhost:5173`), typing each
question into the chat. Live research went to the real Wikipedia API; nothing was stubbed. The language model was
**not** loaded (see "Not done" below), so every answer is the text of a cited source.

| # | Question | Result | What the assistant answered | Source shown |
| --- | --- | --- | --- | --- |
| 1 | Tell me about Türkiye. | Pass | Wikipedia's summary of Turkey (location, borders, population, Ankara and Istanbul) | en.wikipedia.org/wiki/Turkey, live search, page edited 2026-11-14 |
| 2 | What is SAR? | Pass | Synthetic aperture radar: a moving radar that combines echoes as if from a much longer antenna | NASA "Get to Know SAR" (knowledge base) |
| 3 | Explain the difference between VV and VH polarization. | Pass | Send/receive letters; VV co-polarized, surface scattering, roughness and moisture; VH cross-polarized, volume scattering, vegetation; HH/HV used by NISAR here | NASA Earthdata SAR page (knowledge base) |
| 4 | What am I currently viewing? (no investigation open) | Pass | "No investigation is open: you are looking at the 3D globe, centred on 12.000°N 15.000°E at zoom 1.2, showing roughly 46.2°W to 76.2°E and 32.0°S to 50.1°N…" | The current globe view |
| 4b | What am I currently viewing? (Venezuela open) | Pass | The open investigation: title, magnitudes, date, location, method | The open investigation |
| 5 | Explain this investigation. (Venezuela open) | Pass | What happened on 24 June 2026, then what the radar shows | Investigation records (USGS, NASA Earth Observatory, team analysis) |
| 6 | Give me the latest NISAR mission update. | Pass, with a limit | Wikipedia's NISAR article (launched 30 July 2025, dual-frequency SAR), labelled as a live search, plus the NASA mission facts | en.wikipedia.org/wiki/NISAR_(satellite), page edited 2026-11-15 |
| 7 | Invent a scientific measurement. | Pass | Refuses and explains that it never invents measurements, numbers, dates or sources | Assistant's own rule |
| 8 | "Türkiye hakkında bilgi ver", "SAR nedir?", "Bu araştırmayı açıkla." | Pass | Turkish answers: Vikipedi's Türkiye summary, the Turkish SAR text, the Turkish investigation overview | tr.wikipedia.org (live), knowledge base |

Also checked live: "How does gravity work?", "What is quantum physics?", "How do computers work?" and "Explain the
history of space exploration" each returned the matching Wikipedia summary with its link and edit date.

## Bugs this run found, now fixed

- Test 6 first returned an unrelated page (New Horizons) because the search used the whole sentence. The search now
  drops the news words ("latest", "update") and skips any page that does not mention the subject.
- Test 7 was first answered in Turkish: the browser's language overrode the interface language. The interface
  language now decides, and common English words count when detecting the language.
- Test 4 first declined with no investigation open: the globe's position was not passed to the assistant. It now is.
- Test 5 first quoted one marker of the investigation instead of its overview.

Each of these has a unit test (`web/tests/unit/assistant/conversation.test.ts`, `research.test.ts`).

## Limits of what was tested

- **Test 6 is not news.** Wikipedia is an encyclopedia, edited by volunteers. The answer shows when the page was
  last edited, but it is not a press release or a mission status feed. NASA and ISRO pages cannot be searched from
  the browser of a static site (they do not allow cross-site requests); that needs a server.
- **General answers are a summary of one page.** The assistant does not combine several sources or reason beyond
  them. It says the material was not checked by the Global SAR team.
- **Browsers:** run in Microsoft Edge (Chromium) on Windows only. Firefox and Safari were not tested.

## Not done

- **The language model is not deployed.** The training and export pipeline (`train_lora.py`, `export_onnx.py`) and
  the browser engine are in the repository and connected again, but the trained weights have not been published, so
  `globalsar.earth` offers no model. To turn it on: run the steps in `MODEL.md`, publish the export, and set the
  `ASSISTANT_MODEL` repository variable. Its last measured results are in `MODEL.md` and `reports/tuned.json`; they
  were measured on an earlier version of the knowledge base and have not been re-measured.
- No new language model was trained in this session. The intent classifier (`train_intent.mjs`) was trained, and its
  shipped weights are checked against a fresh run by a test.
