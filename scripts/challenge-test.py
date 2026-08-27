"""End-to-end local test for the difficult multi-page/diagram fixture."""
import base64, glob, json, urllib.request
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
with urllib.request.urlopen(req, timeout=180) as response:
    payload = json.loads(response.read().decode())
result = payload.get("result", {})
print("ok:", payload.get("ok"), "provider:", result.get("provider"))
for item in result.get("questions", []):
    answer = item.get("answer") or {}
    print(item["label"], item["status"], "regions=", len(answer.get("regions", [])), "confidence=", item.get("confidence"), "answer=", (answer.get("transcript") or "")[:55])
print("unmatched:", len(result.get("unmatched", [])))
