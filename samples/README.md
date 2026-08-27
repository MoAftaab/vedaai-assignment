# Sample inputs — drop these in to test the app

Two folders, one file to drop into each uploader on the **Upload** screen:

| Uploader | Drop this file |
|---|---|
| **Question Paper** | [`question-paper/question-paper.png`](question-paper/question-paper.png) |
| **Answer Sheet** | [`answer-sheet/answer-sheet.pdf`](answer-sheet/answer-sheet.pdf) — 2 pages |

> Prefer to test with plain images? The answer sheet is also provided as single
> pages: `answer-sheet/answer-sheet-page-1.png` and `…-page-2.png`. Drop **one**
> file per uploader (the app takes one question paper + one answer sheet).

## Hard-case regression set

For a more demanding test, use [`challenge-case/`](challenge-case/). It contains
a 2-page question paper and 3-page answer sheet with subparts, out-of-order
answers, an unanswered question, an unmatched answer, and a multi-page answer
continuation.

These samples are deliberately crafted to exercise **every edge case** the
assignment calls out. After you click **Start Mapping**, you should see:

| Question (paper order) | Mapped answer | What it demonstrates |
|---|---|---|
| **1.** Capital of France | "The capital of France is Paris." | normal match |
| **2.** Largest planet | "Jupiter …" | **out-of-order** (written *before* Q1 on the sheet) |
| **3.** Define photosynthesis | — | **unanswered** → 0 marks, flagged |
| **4.** Newton's First Law | "An object stays at rest …" | **out-of-order** (written after 5a/5b) |
| **5 (a)** Formula for water | "H2O" | **labelled sub-part** |
| **5 (b)** Formula for table salt | "NaCl" | **labelled sub-part** |
| **6.** Water cycle | "The sun heats water …" | answer lives on **page 2** |
| — | "Ans 8. India got independence in 1947." | **unmatched** — no such question on the paper |

Things to try once the result loads:
- Click **Q6** — the answer viewer jumps to **page 2** and highlights the region.
- Click **Q2** — highlight lands correctly even though it was written first.
- Note **Q3** shows as unanswered, and the stray "Ans 8" appears in the
  **unmatched answers** section (an answer that maps to no question).
- Use the zoom / page controls on the answer sheet — highlights stay aligned
  because regions are stored as normalized (0–1) coordinates.

Regenerate these files anytime with:

```bash
python scripts/make-samples.py
```
