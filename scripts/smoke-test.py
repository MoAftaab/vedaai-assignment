import base64, io, json, urllib.request
from PIL import Image, ImageDraw, ImageFont

def font(sz):
    for p in ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/segoeui.ttf"):
        try: return ImageFont.truetype(p, sz)
        except Exception: pass
    return ImageFont.load_default()

def make(lines, w=1000):
    h = 120 + len(lines) * 90
    img = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(img)
    y = 60
    for ln, sz in lines:
        d.text((60, y), ln, fill=(20, 20, 30), font=font(sz))
        y += 90
    buf = io.BytesIO(); img.save(buf, "JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode(), img.width, img.height

q_b64, qw, qh = make([
    ("Q1. What is the capital of France?  (2 marks)", 34),
    ("Q2. Name the largest planet in the solar system.  (2 marks)", 34),
    ("Q3. Explain why the sky appears blue.  (5 marks)", 34),
    ("Q4 (a). Define photosynthesis in one line.  (2 marks)", 34),
    ("Q4 (b). Where in the cell does it occur?  (2 marks)", 34),
])

a_b64, aw, ah = make([
    ("1. Paris", 40),
    ("2. Jupiter", 40),
    ("4a. Photosynthesis is how plants make food using sunlight.", 34),
    ("4b. It occurs in the chloroplast.", 38),
], w=1100)

payload = {
    "questionPages": [{"base64": q_b64, "mime": "image/jpeg", "w": qw, "h": qh}],
    "answerPages":   [{"base64": a_b64, "mime": "image/jpeg", "w": aw, "h": ah}],
}

req = urllib.request.Request(
    "http://localhost:3000/api/process",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
)
print("POSTing to /api/process ...")
with urllib.request.urlopen(req, timeout=180) as r:
    out = json.loads(r.read().decode())

res = out.get("result", {})
print("ok:", out.get("ok"), "| provider:", res.get("provider"))
print("summary:", json.dumps(res.get("summary"), indent=2))
print("\nQUESTIONS:")
for q in res.get("questions", []):
    regs = [(rg["page"], [round(x,3) for x in rg["bbox"]]) for rg in (q.get("answer") or {}).get("regions", [])]
    print(f"  [{q['label']}] score={q.get('score')}/{q['maxScore']} status={q['status']} regions={regs}")
    print(f"       Q: {q['text'][:70]}")
    print(f"       A: {((q.get('answer') or {}).get('transcript') or '(none)')[:70]}")
    print(f"       fb: {(q.get('feedback') or '')[:80]}")
print("\nUNMATCHED:", json.dumps(res.get("unmatched"), indent=2)[:300])
