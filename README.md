# VedaAI — AI Assessment Extraction & Answer Mapping

A teacher uploads a **question paper** and a **student's handwritten answer sheet**;
the app extracts every question, transcribes the handwritten answers, **maps each
answer to its question**, grades it with AI feedback, and — when you click a
question — **highlights the exact region on the answer sheet** where that answer
was written.

Built for the VedaAI hiring assignment. Next.js + TypeScript + Tailwind, with a
Claude-powered vision pipeline.

---

## Live demo

- **Vercel:** _add your URL after deploying (see [Deployment](#deployment))_
- **Render:** _add your URL after deploying_

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
1. Extract questions      Claude vision, one call per question-paper page (parallel)
                          → { label, text, maxScore }, labels normalized & de-duped
   ▼
2. Transcribe answers     Claude vision, one call per answer-sheet page (parallel)
                          → { label?, transcript, bbox[x,y,w,h] } per answer block
   ▼
3. Map answers → questions
     a. blocks that state their number  → matched directly by label
     b. remaining unlabelled blocks      → matched to still-unanswered questions
                                           by content (a text LLM call)
     c. anything left over               → "unmatched answer"
   ▼
4. Grade + feedback       one batched call → per-question score + feedback + overall
   ▼
Result: questions (with mapped answer, regions, score, feedback),
        unmatched answers, summary, and the active provider.
```

**Highlighting.** Each answer block carries a bounding box in **normalized
`[x, y, w, h]` coordinates (0–1)**. The viewer renders overlays with percentage
offsets, so a box drawn at `x=0.2` sits at 20% of the image width regardless of
zoom level or rendered size. Regions store their **page index**, so multi-page
answers highlight on the correct page.

---

## AI model & API

The routing requirement for this project: **use Claude by default, with OpenAI as
a fallback.** Implemented in [`src/server/llm/client.ts`](src/server/llm/client.ts):

| Priority | Provider | Model | API shape |
|---|---|---|---|
| **1 — primary** | **Claude** via AgentRouter (`agentrouter.org`) | `claude-opus-4-8` | Anthropic Messages |
| **2 — fallback** | OpenAI | `gpt-5.4-mini` **only** | Chat Completions |
| **3 — last resort** | deterministic (no network) | — | so the app never hard-crashes |

- **Vision and text** both try **Claude first**; on any error or non-200, they
  **fail over to OpenAI before the first token** is consumed, so a bad provider
  fails cleanly rather than mid-stream.
- The response reports which `provider` actually served the request, and the
  top bar shows a small telemetry chip.
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
    api/process/route.ts  the pipeline endpoint (Node runtime, maxDuration 60)
    api/health/route.ts   live provider health probe
  server/
    llm/client.ts         multi-provider client (Claude primary, OpenAI fallback)
    pipeline.ts           extract → map → grade orchestration
    prompts.ts            vision + grading system prompts
  components/             shell (sidebar/topbar), upload, loading, mapping, error
  lib/                    pdf rasterization, types, formatting, store
samples/                  ready-to-drop question paper + handwritten answer sheet
scripts/make-samples.py   regenerates the sample inputs
```

---

## Run locally

Requires Node 20+.

```bash
npm install
cp .env.example .env.local   # then fill in AGENTROUTER_API_KEY
npm run dev
```

Open http://localhost:3000 and drop in the files from [`samples/`](samples/).

**Environment variables** (see [`.env.example`](.env.example)): only
`AGENTROUTER_API_KEY` is strictly required — base URLs and model names have
sensible defaults. Add `OPENAI_API_KEY` to enable the fallback path.

---

## Deployment

The repo ships config for **both** hosts. Set the secrets in the dashboard — never
commit real keys.

### Vercel

1. Push to GitHub (done).
2. [vercel.com](https://vercel.com) → **New Project** → import this repo.
   Next.js is auto-detected ([`vercel.json`](vercel.json) pins the framework).
3. **Settings → Environment Variables:** add `AGENTROUTER_API_KEY` (required) and
   `OPENAI_API_KEY` (optional). The base-URL / model vars are optional overrides.
4. **Deploy.** The `/api/process` function is configured for a 60s max duration.

Or via CLI: `vercel` then `vercel --prod`.

### Render

1. Push to GitHub (done).
2. [render.com](https://render.com) → **New +** → **Blueprint** → connect this
   repo. Render reads [`render.yaml`](render.yaml).
3. When prompted, set the two secret env vars (`AGENTROUTER_API_KEY`,
   `OPENAI_API_KEY`). Non-secret config is already in the blueprint.
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
