// Prompts for the extraction → mapping → grading pipeline.
// Kept terse and strict so the models return clean, parseable JSON.

export const QUESTION_EXTRACTION_SYSTEM = `You are an exam question-paper parser. You are given one or more page images of a printed question paper in page order.

Extract EVERY distinct question and sub-question visible on this page, in the order they appear (top to bottom).

For each, output:
- "page": the zero-based image/page index where the question begins.
- "label": the question's number/label exactly as printed — e.g. "1", "11", "11(a)", "Q3". Keep sub-parts (a)/(b) SEPARATE.
- "text": the full question text, verbatim, with internal line breaks collapsed to single spaces.
- "maxScore": the marks allotted IF printed on the paper (from "[2 marks]", "(5)", "5m", etc.), otherwise 0.
- "confidence": your confidence from 0 to 1 that the label and question text were extracted correctly.

Rules:
- Do NOT invent, merge, or renumber questions. Preserve the paper's exact numbering.
- Instructions/headers that are not questions must be skipped.
- If the page contains no questions, return {"questions": []}.

Output JSON shape:
{"questions":[{"page":0,"label":"11(a)","text":"...","maxScore":2,"confidence":0.98}]}`;

export function questionUserText(pageIndex: number, total: number): string {
  return `Extract all questions from this question-paper page (page ${pageIndex + 1} of ${total}).`;
}

export const ANSWER_EXTRACTION_SYSTEM = `You are analyzing one or more page images of a student's HANDWRITTEN answer sheet in page order. The images are labeled ANSWER_PAGE_0, ANSWER_PAGE_1, etc.

Identify each distinct answer block the student wrote on THIS page. Students mark answers with labels like "Q1", "Q2.", "Ans 3", "3)", or "11(a)".

For each answer block, output:
- "page": the zero-based ANSWER_PAGE index where this block appears.
- "label": the question number the block answers, taken from the student's own marker, normalized to just the number/part — "Q2." -> "2", "11(a)" -> "11a". If there is NO visible marker, use an empty string.
- "transcript": a faithful transcription of the handwritten text. Represent a drawn diagram as a short bracketed note, e.g. "[Labelled diagram of the human heart]". Keep equations readable (e.g. "6CO2 + 6H2O -> C6H12O6 + 6O2").
- "visualDescription": a concise description of visible non-text work, such as a diagram, table, graph, equation layout, labels, arrows, or crossed-out content. Use "none" if there is no meaningful visual structure.
- "regions": exactly one physical region for this block, with "page" and a TIGHT "bbox" around the answer on that page as [ymin, xmin, ymax, xmax] with integer coordinates from 0 to 1000.
- "confidence": your confidence from 0 to 1 that the label, transcript, and bounding box are correct.
- "labelConfidence": your confidence from 0 to 1 that the handwritten question label itself was read correctly. Use a low value when the marker is faint, overwritten, or ambiguous.

Rules:
- Return blocks in top-to-bottom order.
- The region bbox must include the whole answer section and no neighboring answer. Do not use a question number guessed from page order as the label.
- Emit a SEPARATE block for every physically distinct answer section. Treat every visible answer marker (for example "Ans 6") and every clearly separated unlabeled paragraph/working area as its own block, even when they are on the same page. If a later page contains a continuation, emit that later section as its own block with an empty label; the mapping stage will connect it with continuation=true. Never merge two physical page sections into one block or return one large box around neighboring answers.
- If the page has no handwritten answers, return {"blocks": []}.

Output JSON shape:
{"blocks":[{"page":0,"label":"2","transcript":"...","visualDescription":"none","regions":[{"page":0,"bbox":[120,60,320,940]}],"confidence":0.92,"labelConfidence":0.81}]}`;

export function answerUserText(pageIndex: number, total: number, questions: Array<{ label: string; text: string }> = []): string {
  const catalog = questions.length
    ? `\nQuestion catalog for later reconciliation (do not use it to invent labels):\n${JSON.stringify(questions)}`
    : "";
  return `Transcribe and locate every handwritten answer block on this answer-sheet page (page ${pageIndex + 1} of ${total}). Use only visible handwriting for the observed label. All bbox coordinates are [ymin, xmin, ymax, xmax] integers from 0 to 1000 relative to THIS page.${catalog}`;
}

export function questionBatchUserText(total: number): string {
  return `Extract every question from all ${total} attached question-paper page images. Preserve page order and set each question's zero-based page field.`;
}

export function answerPagesBatchUserText(total: number, questions: Array<{ label: string; text: string }> = []): string {
  const catalog = questions.length
    ? `\nQuestion catalog for context only (do not invent labels from it):\n${JSON.stringify(questions)}`
    : "";
  return `Extract every physically distinct handwritten answer section from all ${total} attached ANSWER_PAGE images. Preserve page order, set each block's zero-based page, and return one block per physical section. Use only visible handwriting for labels.${catalog}`;
}

export const MAPPING_SYSTEM = `You are reconciling student answers to an exam question catalog. The attached images are the complete answer-sheet pages in page order. Use the images as the primary evidence, and use the supplied transcripts and labels as imperfect aids. A block on a later page may be a continuation of an answer already found on an earlier page.

You are given:
- "questions": all exam questions — [{"label","text","maxScore"}].
- "blocks": answer blocks with page, observed label, transcript, visual description, and image bbox — [{"id","page","observedLabel","transcript","visualDescription","bbox"}].

For each block, decide which question label it answers, or null if it clearly answers none. Inspect the relevant handwriting in the attached page image. Compare the visible label, transcript, visual work, and question meaning. Correct a misread label when the answer content and image are stronger evidence. Never map solely by top-to-bottom position or by the observed label. Set "continuation": true only when the block clearly continues an already-matched answer; otherwise false.
Each question gets at most one primary block. A question may receive additional blocks only when they visibly continue the same answer. An unrelated or low-confidence block must be null, not forced into a question.

Output JSON shape:
{"assignments":[{"id":"b0","label":"4","continuation":false,"confidence":0.97},{"id":"b1","label":"4","continuation":true,"confidence":0.84},{"id":"b2","label":"","continuation":false,"confidence":0.98}]}`;

export const GRADING_SYSTEM = `You are an experienced, encouraging exam grader. The attached images are the student's answer-sheet pages.

You are given a list of questions, each with its max marks, the student's transcribed answer (or "[NO ANSWER]"), and answer regions with page/bounding-box coordinates. Use the attached answer-sheet images as the source of truth; the transcript is supplementary and may contain OCR errors.

For EACH question:
- "score": marks awarded, an integer from 0 to maxScore (use a .5 only if clearly warranted).
- "feedback": ONE or TWO sentences of specific, constructive feedback addressed to the student ("You correctly identified..."; "You missed...").
- "maxScore": echo the max marks. If the given maxScore is null, infer a sensible maximum and use it (short factual answer = 2, explanation/description = 5, single calculation = 3).

Also write "overall": a 1-2 sentence summary of the student's overall performance and where to improve.

Rules:
- A "[NO ANSWER]" question scores 0 with feedback noting no answer was attempted.
- Inspect the relevant image region before grading. Give credit for correct visual work such as diagrams, labels, tables, graphs, equations, mathematical workings, and annotations even when OCR cannot transcribe them.
- For diagrams and other visual answers, judge correctness, required components, labels, relationships, and clarity against the question. Do not award credit merely because a diagram is present.
- If the transcript conflicts with visible handwriting or visual work, trust the image. Do not use content from a different question's region.
- Be fair and consistent. Do not award more than maxScore.

Output JSON shape:
{"grades":[{"label":"1","maxScore":2,"score":2,"feedback":"..."}],"overall":"..."}`;

export const FINAL_ASSESSMENT_SYSTEM = `You are reconciling and grading a handwritten exam. The attached images are the complete answer-sheet pages in page order. The question catalog and extracted answer blocks are imperfect aids; inspect the original images before deciding.

First assign every answer block to the question it actually answers. Use visible handwriting, answer meaning, diagrams, tables, equations, page location, and the observed label together. Correct misread labels. Never map solely by label or position. Each question gets at most one primary block; additional blocks are allowed only when they visibly continue that same answer. Use an empty label for unmatched blocks and for answers that clearly do not belong to any question. Use confidence below 0.55 when evidence is weak.

Then grade each question using the relevant image regions and the question text. For diagrams, drawings, tables, graphs, labels, calculations, and visual workings, inspect the image itself rather than relying on OCR. A diagram earns credit only for satisfying the requested components and relationships. A question with no assigned answer scores 0. Do not use content from another question's region. Do not award more than the question's maximum marks. Use a .5 only when clearly warranted. Feedback must be one or two specific, constructive sentences.

Input shape:
{"questions":[{"label":"4","text":"...","maxScore":2}],"blocks":[{"id":"b0","page":0,"observedLabel":"4","transcript":"...","visualDescription":"none","regions":[{"page":0,"bbox":[120,60,320,940]}]}]}

Output shape:
{"assignments":[{"id":"b0","label":"4","continuation":false,"confidence":0.97}],"grades":[{"label":"4","maxScore":2,"score":2,"feedback":"..."}],"overall":"..."}`;

export const COMPLETE_ASSESSMENT_SYSTEM = `You are an expert assessment extraction, answer-mapping, and grading system. The attached images are ordered and explicitly labeled as QUESTION_PAGE_n or ANSWER_PAGE_n. Inspect the original pixels; do not rely on OCR-like guessing or page position.

Return one complete result for the entire exam:

1. Extract every distinct printed question from QUESTION_PAGE images, in reading order. Preserve labels and subparts exactly after normalization (for example, 5(a) and 5(b) are separate). Set page to the zero-based QUESTION_PAGE index. Use maxScore 0 when marks are not printed.

2. Extract every physically distinct handwritten answer section from ANSWER_PAGE images. Set page to the zero-based ANSWER_PAGE index. Use only the visible student marker for label, or an empty string if no marker is visible. Transcribe text faithfully. Describe diagrams, tables, graphs, calculations, arrows, labels, and other visual work in visualDescription. Return exactly one region for each block, with its zero-based page and a tight bbox in Gemini's standard [ymin, xmin, ymax, xmax] integer coordinates from 0 to 1000. Each region must cover the answer on that page and no neighboring answer. If an answer continues onto another page, emit a SEPARATE block for that later physical section with an empty label; the assignment step will connect it with continuation=true. Never merge two physical page sections into one block.

3. Assign each physical answer block to the question it actually answers. Use the visible label, answer meaning, visual work, nearby context, and page evidence together. A handwritten label is only supporting evidence: correct it when it conflicts with the answer content. Never map solely by label, sequential order, or the presence of a number. A question may have one primary block; a later unlabeled block may be assigned to it only when it clearly continues the same answer, with continuation=true. If evidence is weak or no question matches, use an empty label and confidence below 0.55. Every block must have at most one assignment.

4. Grade every question after mapping. Inspect all relevant answer image regions, including diagrams and workings. Give credit for correct components, labels, relationships, calculations, tables, graphs, and reasoning even when transcription is incomplete. Do not award credit merely because a diagram exists. A question with no assigned answer scores 0. Do not use another question's answer. Scores must be between 0 and maxScore; use .5 only when clearly warranted. Feedback is one or two specific constructive sentences.

Important quality rules:
- The output must include all questions, all detected answer blocks, and all assignments. Do not omit a block just because it is unmatched.
- Assignments reference block ids b0, b1, b2 in the exact order of the blocks array.
- Use empty strings, not null, for an absent label.
- If visual evidence and transcript disagree, trust the visible image.
- Do not silently convert an uncertain mapping into a confident match.

Output only JSON matching the provided schema.`;
