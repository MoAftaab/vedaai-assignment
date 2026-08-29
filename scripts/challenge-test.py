"""End-to-end local test for the difficult multi-page/diagram fixture."""
import base64, glob, json, sys, urllib.error, urllib.request
from PIL import Image

def page(path):
    image = Image.open(path).convert("RGB")
    image.thumbnail((1000, 1400))
    import io
    buf = io.BytesIO()
    image.save(buf, "JPEG", quality=82)
    return {"base64": base64.b64encode(buf.getvalue()).decode(), "mime": "image/jpeg", "w": image.width, "h": image.height}

q = [page(p) for p in sorted(glob.glob("samples/challenge-case/question-paper/question-paper-page-*.png"))]
a = [page(p) for p in sorted(glob.glob("samples/challenge-case/answer-sheet/answer-sheet-page-*.png"))]
req = urllib.request.Request("http://localhost:3000/api/process", data=json.dumps({"questionPages": q, "answerPages": a}).encode(), headers={"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=180) as response:
        payload = json.loads(response.read().decode())
except urllib.error.HTTPError as error:
    print(f"HTTP {error.code}: {error.read().decode(errors='replace')}")
    sys.exit(2)
result = payload.get("result", {})
print("ok:", payload.get("ok"), "provider:", result.get("provider"))
if not payload.get("ok"):
    print("pipeline error:", payload.get("error"))
    sys.exit(2)
for item in result.get("questions", []):
    answer = item.get("answer") or {}
    print(item["label"], item["status"], "regions=", len(answer.get("regions", [])), "confidence=", item.get("confidence"), "answer=", (answer.get("transcript") or "")[:55])
print("unmatched:", len(result.get("unmatched", [])))
if questions := {item["label"]: item for item in result.get("questions", [])}:
    print("q6-debug:", json.dumps(questions.get("6", {}).get("answer", {}), ensure_ascii=False))

# Regression assertions: this fixture is intentionally designed to catch the
# exact failure where a misread handwritten label sends an answer to the wrong
# question. A non-zero exit means the mapping must not be trusted.
questions = {item["label"]: item for item in result.get("questions", [])}

def transcript(label):
    return ((questions.get(label, {}).get("answer") or {}).get("transcript") or "").lower()

expected_terms = {
    "2": "renewable",
    "4": "red blood",
    "5a": "litmus",
    "5b": "soapy",
    "6": "water",
}
for label, term in expected_terms.items():
    if term not in transcript(label):
        raise AssertionError(f"{label} does not contain expected answer evidence: {term!r}")
if questions.get("8", {}).get("status") != "unanswered":
    raise AssertionError("Q8 should remain unanswered")
if len((questions.get("6", {}).get("answer") or {}).get("regions", [])) < 2:
    raise AssertionError("Q6 continuation should produce at least two regions")
if "diagram" not in transcript("9") and "diagram" not in ((questions.get("9", {}).get("answer") or {}).get("visualDescription") or "").lower():
    raise AssertionError("Q9 diagram was not detected")
if not any(item.get("label") == "10" for item in result.get("unmatched", [])):
    raise AssertionError("Ans 10 should remain unmatched")
for item in result.get("questions", []):
    for region in (item.get("answer") or {}).get("regions", []):
        bbox = region.get("bbox", [])
        if len(bbox) != 4 or any(value < 0 or value > 1 for value in bbox):
            raise AssertionError(f"Invalid normalized bbox for Q{item['label']}: {bbox}")
print("assertions: PASS")
