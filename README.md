# VedaAI — AI Assessment Extraction & Answer Mapping

A teacher uploads a **question paper** and a **student's handwritten answer sheet**;
the app extracts every question, transcribes the handwritten answers, **maps each
answer to its question**, grades it with AI feedback, and — when you click a
question — **highlights the exact region on the answer sheet** where that answer
was written.

Built for the VedaAI hiring assignment. Next.js + TypeScript + Tailwind, with a
multi-provider vision pipeline.

---

## Live demo

- **Vercel:** https://vedaai-assignment-silk.vercel.app/

> No sign-up. Grab the ready-made [`samples/`](samples/) (a question paper + a
> 2-page handwritten answer sheet) and drop them straight in.

---

## What it does (mapped to the grading criteria)

- **Extracts every question in printed order**, preserving the original numbering.
- **Treats labelled sub-parts** (e.g. `5(a)`, `5(b)`) as **separate entries**.
- **Transcribes handwritten answers** and maps them to questions — even when the
  student answers **out of order**.
- **Highlights the exact region** on the answer sheet for the selected question,
  using normalized coordinates so highlights stay aligned through **zoom** and
  **pagination**.
- **Handles the hard edge cases:**
  - a question with **no answer** → shown as *unanswered* (0 marks),
  - an **answer that matches no question** → shown in an *unmatched answers* section,
  - answers that **span multiple pages** → clicking the question jumps to the
    right page.
- **Grades each answer** (score chips: full / partial / zero / ungraded) and gives
  **per-question AI feedback** plus an **overall summary**.

---

## How it works

Everything runs through one serverless route (`POST /api/process`). PDFs and
images are rasterized **in the browser** first, so the server only ever receives
page images.

```
Upload (PDF/images)
   │  client-side: pdf.js rasterizes each page → JPEG (kept small for the
   │  serverless body limit); normalized page images sent to the API
   ▼
1. Extract questions      one multimodal vision batch for all question pages
                          → { page, label, text, maxScore }, labels normalized & de-duped
   ▼
2. Transcribe answers     multimodal vision, one call per answer-sheet page (parallel)
                          → { page, label?, transcript, visualDescription, bbox } per physical block
   ▼
3. Reconcile + grade      one multimodal call with every answer page attached
                          → image-grounded assignments, continuations, scores, feedback
                          → labels are evidence, never unconditional mapping instructions
   ▼
4. Validate               deterministic label/duplicate/continuation/coordinate checks
                          → low-confidence conflicts stay unmatched for manual review
   ▼
4. Grade + feedback       one batched call → per-question score + feedback + overall
   ▼
Result: questions (with mapped answer, regions, score, feedback),
        unmatched answers, summary, and the active provider.
```

**Highlighting.** The vision provider returns its documented **`[ymin, xmin, ymax, xmax]` box
format on a 0–1000 scale**. The server converts it once to normalized
**`[x, y, w, h]` coordinates (0–1)**. The viewer renders overlays with percentage
offsets, so highlights stay aligned through zoom and pagination. Regions store
their page index, so multi-page answers highlight on the correct page.

---

## AI model & API

The deployed app uses **Agent Router as the primary provider** with Gemini as a
fallback. Provider order and credentials are configured through environment
variables. Both paths are implemented in [`src/server/llm/client.ts`](src/server/llm/client.ts):

| Provider | Model | API shape |
|---|---|---|---|
| Google Gemini | `gemini-2.5-flash` | Generative Language `generateContent` |
| Agent Router | configured model list | OpenAI-compatible / Anthropic-compatible primary |
| Local fallback | deterministic | no network; used only when no AI key is configured |

- **Vision and text** use the selected provider’s multimodal endpoint; mapping
  and grading receive the original answer-sheet images, not OCR text alone.
- The response reports which provider actually served the final request, and
  the top bar reports the provider that completed the assessment.
- **All AI calls are server-side** (route handlers). API keys are read from
  environment variables and are **never** exposed to the browser.

---

## Tech stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Tailwind CSS v4** (CSS-first `@theme` tokens — no `tailwind.config.js`)
- **pdf.js** (`pdfjs-dist`) for client-side PDF → image rasterization
- **Zustand** for state, **lucide-react** for icons
- No database — state is in-memory per session (one paper + one sheet at a time)

## Project structure

```
src/
  app/
    page.tsx              orchestrator: switches Upload / Loading / Result / Error
    api/process/route.ts  the pipeline endpoint (Node runtime, maxDuration 120)
    api/health/route.ts   live provider health probe
  server/
    llm/client.ts         Gemini + Agent Router client
    pipeline.ts           extract → map → grade orchestration
    prompts.ts            vision + grading system prompts
  components/             shell (sidebar/topbar), upload, loading, mapping, error
  lib/                    pdf rasterization, types, formatting, store
samples/                  ready-to-drop question paper + handwritten answer sheet
scripts/make-samples.py   regenerates the sample inputs
```

---

## Run locally

Requires Node 24+.

```bash
npm install
cp .env.example .env.local   # then fill in GEMINI_API_KEY
npm run dev
```

Open http://localhost:3000 and drop in the files from [`samples/`](samples/).

**Environment variables** (see [`.env.example`](.env.example)): only
`GEMINI_API_KEY` and `AGENT_ROUTER_API_KEY` are server-side AI credentials. Set
`PRIMARY_LLM_PROVIDER` and a comma-separated `AGENT_ROUTER_MODELS` list to
control provider order. The router base URL and protocol are configurable; `auto` uses Anthropic Messages
for Claude model IDs and OpenAI Chat Completions for other model IDs. No model
or key is hardcoded in application code.

---

## Deployment

The repo ships config for **both** hosts. Set the secrets in the dashboard — never
commit real keys.

### Vercel

1. Push to GitHub (done).
2. [vercel.com](https://vercel.com) → **New Project** → import this repo.
   Next.js is auto-detected — no extra config needed.
3. **Settings → Environment Variables:** add `GEMINI_API_KEY` and the Agent
   Router variables (`AGENT_ROUTER_API_KEY`, `AGENT_ROUTER_BASE_URL`,
   `AGENT_ROUTER_API_FORMAT`, `AGENT_ROUTER_MODELS`, and
   `PRIMARY_LLM_PROVIDER`). The Gemini base URL is optional.
4. **Deploy.** The `/api/process` function is configured for a 120s max duration.

Or via CLI: `vercel` then `vercel --prod`.

### Render

1. Push to GitHub (done).
2. [render.com](https://render.com) → **New +** → **Blueprint** → connect this
   repo. Render reads [`render.yaml`](render.yaml).
3. When prompted, set the `GEMINI_API_KEY` secret. The non-secret Gemini base URL
   is already in the blueprint.
4. **Apply** to deploy the Node web service.

> On both free tiers the instance cold-starts after inactivity, so the first
> request may take a few seconds.

---

## Assumptions

- Questions on the paper are numbered/labelled; sub-parts like `5(a)` / `5(b)` are
  distinct questions with their own answers and marks.
- A handwritten answer either states its question number **or** is matched to a
  question by its content.
- One student answer sheet is processed at a time (the assignment scope).
- If a question paper omits marks, a reasonable per-question maximum is inferred.

## Limitations

- Transcription and bounding-box accuracy depend on legibility — messy cursive or
  low-resolution scans reduce quality. Boxes are **model-estimated regions**, close
  but not pixel-perfect.
- Serverless request bodies are capped (~4.5 MB on Vercel), so pages are
  JPEG-compressed client-side; very large multi-page PDFs may need fewer/downscaled
  pages.
- Grading is **AI-assisted and indicative**, not an authoritative mark.
- State is in-memory: refreshing the page clears the current assessment.

---

## Security note

API keys live only in `.env.local` (gitignored) for local dev and in the host's
environment variables in production. They are used exclusively in server-side
route handlers and are never shipped to the client.
