# Generates realistic drag-and-drop sample inputs for the VedaAI app.
#
# Output (under samples/):
#   question-paper/question-paper.png      - printed question paper (6 Qs, incl. 5a/5b sub-parts)
#   answer-sheet/answer-sheet.pdf          - 2-page handwritten-style answer sheet
#   answer-sheet/answer-sheet-page-1.png   - page 1 as a standalone image
#   answer-sheet/answer-sheet-page-2.png   - page 2 as a standalone image
#
# The content deliberately covers the graded edge cases:
#   - answers written OUT OF ORDER (Q2 before Q1, Q4 late)
#   - labelled SUB-PARTS (5a, 5b)
#   - an UNANSWERED question (Q3 photosynthesis)
#   - an EXTRA answer that matches NO question (the "Ans 8." line -> unmatched)
#   - the answer sheet spans TWO pages (cross-page highlight demo)
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
Q_DIR = os.path.join(ROOT, "samples", "question-paper")
A_DIR = os.path.join(ROOT, "samples", "answer-sheet")
os.makedirs(Q_DIR, exist_ok=True)
os.makedirs(A_DIR, exist_ok=True)

PAGE_W, PAGE_H = 1240, 1754
MARGIN_L, MARGIN_R, MARGIN_T = 96, 96, 84
INK = (24, 24, 28)
FAINT = (120, 122, 128)
RULE = (214, 224, 236)


def _font(candidates, size):
    for name in candidates:
        try:
            return ImageFont.truetype(f"C:/Windows/Fonts/{name}", size)
        except Exception:
            continue
    return ImageFont.load_default()


# Printed exam paper fonts.
F_TITLE = _font(["arialbd.ttf", "segoeuib.ttf"], 46)
F_SUB = _font(["arial.ttf", "segoeui.ttf"], 30)
F_Q = _font(["arial.ttf", "segoeui.ttf"], 36)
F_QB = _font(["arialbd.ttf", "segoeuib.ttf"], 36)
# Handwriting look for the answer sheet.
F_HAND = _font(["Inkfree.ttf", "comic.ttf", "segoesc.ttf"], 42)
F_HAND_SM = _font(["Inkfree.ttf", "comic.ttf", "segoesc.ttf"], 34)


def wrap(draw, text, font, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if draw.textlength(trial, font=font) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def new_page(bg=(255, 255, 255)):
    img = Image.new("RGB", (PAGE_W, PAGE_H), bg)
    return img, ImageDraw.Draw(img)


# ---------------------------------------------------------------- question paper
def build_question_paper():
    img, d = new_page()
    y = MARGIN_T
    d.text((MARGIN_L, y), "Delhi Public School, Bokaro Steel City", font=F_TITLE, fill=INK)
    y += 62
    d.text((MARGIN_L, y), "Half-Yearly Examination  -  Class VIII  -  Science & G.K.", font=F_SUB, fill=FAINT)
    y += 44
    d.text((MARGIN_L, y), "Time: 1 hr        Maximum Marks: 15", font=F_SUB, fill=FAINT)
    y += 40
    d.line([(MARGIN_L, y), (PAGE_W - MARGIN_R, y)], fill=(40, 40, 40), width=3)
    y += 44

    max_w = PAGE_W - MARGIN_L - MARGIN_R - 70  # leave room for the [marks] tag
    questions = [
        ("1.", "What is the capital of France?", "[2]"),
        ("2.", "Name the largest planet in our solar system.", "[2]"),
        ("3.", "Define photosynthesis in your own words.", "[3]"),
        ("4.", "State Newton's First Law of Motion.", "[3]"),
        ("5.", "Answer the following:", ""),
        ("5(a)", "Write the chemical formula for water.", "[1]"),
        ("5(b)", "Write the chemical formula for common table salt.", "[1]"),
        ("6.", "Briefly explain the stages of the water cycle.", "[3]"),
    ]
    for num, text, marks in questions:
        indent = 58 if num.startswith("(") else 0
        d.text((MARGIN_L + indent, y), num, font=F_QB, fill=INK)
        lines = wrap(d, text, F_Q, max_w - indent - 64)
        tx = MARGIN_L + indent + 64
        for i, ln in enumerate(lines):
            d.text((tx, y), ln, font=F_Q, fill=INK)
            if i == 0 and marks:
                mw = d.textlength(marks, font=F_Q)
                d.text((PAGE_W - MARGIN_R - mw, y), marks, font=F_Q, fill=FAINT)
            y += 46
        y += 30

    out = os.path.join(Q_DIR, "question-paper.png")
    img.save(out, "PNG")
    print("wrote", out)


# ------------------------------------------------------------------ answer sheet
def ruled(bg=(253, 252, 248)):
    img, d = new_page(bg)
    yy = MARGIN_T + 150
    while yy < PAGE_H - 60:
        d.line([(MARGIN_L - 20, yy), (PAGE_W - 40, yy)], fill=RULE, width=2)
        yy += 62
    d.line([(MARGIN_L + 8, MARGIN_T), (MARGIN_L + 8, PAGE_H - 40)], fill=(244, 200, 200), width=2)
    return img, d


def hand_block(d, x, y, num, text, max_w, line_h=58):
    """Draw one handwritten answer; returns the y after it."""
    d.text((x, y), num, font=F_HAND, fill=(20, 30, 90))
    tx = x + d.textlength(num + " ", font=F_HAND)
    lines = wrap(d, text, F_HAND, max_w - (tx - x))
    for i, ln in enumerate(lines):
        d.text((tx if i == 0 else x + 40, y), ln, font=F_HAND, fill=(26, 40, 110))
        y += line_h
    return y + 22


def build_answer_sheet():
    max_w = PAGE_W - MARGIN_L - MARGIN_R

    # --- page 1
    p1, d1 = ruled()
    d1.text((MARGIN_L, MARGIN_T), "Name: Aarav Sharma    Roll No. 14    Class: VIII-B",
            font=F_HAND_SM, fill=(60, 60, 70))
    d1.line([(MARGIN_L, MARGIN_T + 54), (PAGE_W - MARGIN_R, MARGIN_T + 54)], fill=(190, 190, 190), width=2)
    y = MARGIN_T + 150
    y = hand_block(d1, MARGIN_L + 24, y, "Ans 2.", "Jupiter is the largest planet in our solar system.", max_w)
    y = hand_block(d1, MARGIN_L + 24, y, "Ans 1.", "The capital of France is Paris.", max_w)
    y = hand_block(d1, MARGIN_L + 24, y, "Ans 5(a).", "H2O", max_w)
    y = hand_block(d1, MARGIN_L + 24, y, "Ans 5(b).", "NaCl", max_w)
    y = hand_block(d1, MARGIN_L + 24, y, "Ans 4.",
                   "An object stays at rest or keeps moving in a straight line unless an "
                   "external force acts on it.", max_w)

    # --- page 2
    p2, d2 = ruled()
    d2.text((PAGE_W - MARGIN_R - 120, MARGIN_T), "Page 2", font=F_HAND_SM, fill=(150, 150, 150))
    y = MARGIN_T + 150
    y = hand_block(d2, MARGIN_L + 24, y, "Ans 6.",
                   "The sun heats water in rivers and oceans, so it evaporates. The water "
                   "vapour rises up and condenses to form clouds. When the clouds become "
                   "heavy, water falls back as rain. This water collects again and the "
                   "cycle repeats.", max_w)
    y += 20
    y = hand_block(d2, MARGIN_L + 24, y, "Ans 8.",
                   "India got its independence in the year 1947.", max_w)

    p1.save(os.path.join(A_DIR, "answer-sheet-page-1.png"), "PNG")
    p2.save(os.path.join(A_DIR, "answer-sheet-page-2.png"), "PNG")
    print("wrote", os.path.join(A_DIR, "answer-sheet-page-1.png"))
    print("wrote", os.path.join(A_DIR, "answer-sheet-page-2.png"))

    pdf = os.path.join(A_DIR, "answer-sheet.pdf")
    p1.save(pdf, "PDF", resolution=150.0, save_all=True, append_images=[p2])
    print("wrote", pdf)


def build_challenge_set():
    """Create a harder 2-page paper + 3-page answer set for regression testing."""
    challenge = os.path.join(ROOT, "samples", "challenge-case")
    q_dir = os.path.join(challenge, "question-paper")
    a_dir = os.path.join(challenge, "answer-sheet")
    os.makedirs(q_dir, exist_ok=True)
    os.makedirs(a_dir, exist_ok=True)
    max_w = PAGE_W - MARGIN_L - MARGIN_R

    questions = [
        ("1.", "Explain why the Moon appears to change shape.", "[3]"),
        ("2.", "Name two renewable sources of energy.", "[2]"),
        ("3.", "Calculate 18 x 7 and show your working.", "[2]"),
        ("4.", "What is the function of red blood cells?", "[2]"),
        ("5.", "Answer the following:", ""),
        ("5(a)", "Write one property of acids.", "[1]"),
        ("5(b)", "Write one property of bases.", "[1]"),
        ("6.", "Describe the water cycle in detail.", "[4]"),
        ("7.", "State one cause of soil erosion.", "[1]"),
        ("8.", "Name one layer of the Earth's atmosphere.", "[1]"),
        ("9.", "Draw a labelled diagram of the water cycle.", "[3]"),
    ]
    q_pages = []
    for page_no, page_questions in enumerate((questions[:5], questions[5:]), 1):
        img, d = new_page()
        y = MARGIN_T
        d.text((MARGIN_L, y), "Challenge Assessment - Class VIII", font=F_TITLE, fill=INK)
        y += 72
        d.text((MARGIN_L, y), f"Question Paper - Page {page_no} of 2", font=F_SUB, fill=FAINT)
        y += 64
        for num, text, marks in page_questions:
            indent = 58 if num.startswith("(") else 0
            d.text((MARGIN_L + indent, y), num, font=F_QB, fill=INK)
            lines = wrap(d, text, F_Q, PAGE_W - MARGIN_L - MARGIN_R - indent - 90)
            tx = MARGIN_L + indent + 64
            for i, line in enumerate(lines):
                d.text((tx, y), line, font=F_Q, fill=INK)
                if i == 0 and marks:
                    mw = d.textlength(marks, font=F_Q)
                    d.text((PAGE_W - MARGIN_R - mw, y), marks, font=F_Q, fill=FAINT)
                y += 48
            y += 34
        path = os.path.join(q_dir, f"question-paper-page-{page_no}.png")
        img.save(path, "PNG")
        q_pages.append(img)
    q_pages[0].save(os.path.join(q_dir, "challenge-question-paper.pdf"), "PDF", resolution=150.0, save_all=True, append_images=[q_pages[1]])

    answers = [
        [("Ans 4.", "Red blood cells carry oxygen from the lungs to all parts of the body."),
         ("Ans 2.", "Solar energy and wind energy are renewable sources."),
         ("Ans 5(a).", "Acids turn blue litmus paper red."),
         ("Ans 5(b).", "Bases feel soapy and turn red litmus paper blue.")],
        [("Ans 3.", "18 x 7 = 126. First 18 x 5 = 90, then 18 x 2 = 36, so 90 + 36 = 126."),
         ("Ans 1.", "The Moon is lit by the Sun. As it orbits Earth, we see different amounts of its bright half."),
         ("Ans 7.", "Cutting down trees can cause soil erosion.")],
        [("Ans 6.", "Water evaporates because of the Sun's heat and rises as vapour. It cools and forms clouds."),
         ("", "When clouds become heavy, precipitation falls as rain. Water collects in rivers and oceans, and the cycle repeats.")],
    ]
    answer_pages = []
    for page_no, blocks in enumerate(answers, 1):
        img, d = ruled()
        d.text((MARGIN_L, MARGIN_T), f"Name: Meera Khan    Challenge answer sheet    Page {page_no} of 3", font=F_HAND_SM, fill=(60, 60, 70))
        y = MARGIN_T + 150
        for num, text in blocks:
            y = hand_block(d, MARGIN_L + 24, y, num, text, max_w)
        if page_no == 2:
            y += 18
            d.text((MARGIN_L + 24, y), "Ans 9.", font=F_HAND, fill=(20, 30, 90))
            y += 62
            # A simple labelled diagram intentionally tests non-text answer extraction.
            cx = MARGIN_L + 330
            d.ellipse((cx - 90, y + 80, cx + 90, y + 260), outline=(26, 40, 110), width=4)
            d.text((cx - 48, y + 145), "ocean", font=F_HAND_SM, fill=(26, 40, 110))
            d.arc((cx - 180, y - 10, cx + 180, y + 190), 195, 345, fill=(26, 40, 110), width=4)
            d.text((cx + 160, y + 50), "evaporation", font=F_HAND_SM, fill=(26, 40, 110))
            d.rectangle((cx - 110, y - 100, cx + 110, y - 20), outline=(26, 40, 110), width=4)
            d.text((cx - 64, y - 84), "clouds", font=F_HAND_SM, fill=(26, 40, 110))
            d.line((cx - 35, y - 18, cx - 65, y + 70), fill=(26, 40, 110), width=4)
            d.text((cx - 300, y + 10), "rain", font=F_HAND_SM, fill=(26, 40, 110))
            d.arc((cx - 250, y + 20, cx - 10, y + 250), 20, 170, fill=(26, 40, 110), width=4)
            y += 310
            y = hand_block(d, MARGIN_L + 24, y, "Ans 10.", "This answer has no matching question and should appear as unmatched.", max_w)
        path = os.path.join(a_dir, f"answer-sheet-page-{page_no}.png")
        img.save(path, "PNG")
        answer_pages.append(img)
    answer_pages[0].save(os.path.join(a_dir, "challenge-answer-sheet.pdf"), "PDF", resolution=150.0, save_all=True, append_images=answer_pages[1:])
    print("wrote", challenge)


build_question_paper()
build_answer_sheet()
build_challenge_set()
print("done")
