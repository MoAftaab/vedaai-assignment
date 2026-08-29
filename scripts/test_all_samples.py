"""Comprehensive end-to-end test for standard samples and challenge case."""
import base64
import glob
import io
import json
import os
import sys
import urllib.error
import urllib.request
from PIL import Image

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

def page_to_dict(path):
    img = Image.open(path).convert("RGB")
    img.thumbnail((1000, 1400))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=82)
    return {
        "base64": base64.b64encode(buf.getvalue()).decode(),
        "mime": "image/jpeg",
        "w": img.width,
        "h": img.height
    }

def test_set(name, q_glob, a_glob):
    print(f"\n=======================================================")
    print(f" TESTING SET: {name}")
    print(f"=======================================================")
    q_files = sorted(glob.glob(q_glob))
    a_files = sorted(glob.glob(a_glob))
    print(f"Question files ({len(q_files)}):", q_files)
    print(f"Answer files ({len(a_files)}):", a_files)

    q_pages = [page_to_dict(p) for p in q_files]
    a_pages = [page_to_dict(p) for p in a_files]

    payload = {"questionPages": q_pages, "answerPages": a_pages}
    req = urllib.request.Request(
        "http://localhost:3000/api/process",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        print(f"HTTP Error {err.code}: {err.read().decode('utf-8', errors='replace')}")
        return False
    except Exception as e:
        print(f"Request failed: {e}")
        return False

    res = data.get("result", {})
    print(f"\nResult OK: {data.get('ok')} | Provider: {res.get('provider')}")
    print("Summary:", json.dumps(res.get("summary"), indent=2, ensure_ascii=False))

    print("\nExtracted & Mapped Questions:")
    for q in res.get("questions", []):
        ans = q.get("answer") or {}
        regions = [(r.get("page"), [round(x, 3) for x in r.get("bbox", [])]) for r in ans.get("regions", [])]
        print(f"  [{q.get('label')}] Status: {q.get('status')} | Score: {q.get('score')}/{q.get('maxScore')} | Regions: {regions}")
        print(f"     Q: {q.get('text')}")
        print(f"     A: {ans.get('transcript') or '(none)'}")
        if ans.get('visualDescription'):
            print(f"     Visual: {ans.get('visualDescription')}")
        print(f"     Feedback: {q.get('feedback')}")

    print("\nUnmatched Answers:")
    for u in res.get("unmatched", []):
        print(f"  [Unmatched] Label: {u.get('label')} | Transcript: {u.get('transcript')}")

    return True

if __name__ == "__main__":
    # Test 1: Default sample set
    ok1 = test_set(
        "Standard Sample Set (2-page answer sheet)",
        "samples/question-paper/question-paper.png",
        "samples/answer-sheet/answer-sheet-page-*.png"
    )

    # Test 2: Challenge case set (3-page answer sheet + diagrams + out-of-order)
    ok2 = test_set(
        "Challenge Case Set (3-page answer sheet + diagram)",
        "samples/challenge-case/question-paper/question-paper-page-*.png",
        "samples/challenge-case/answer-sheet/answer-sheet-page-*.png"
    )

    print("\n=======================================================")
    print(f"All tests completed! Standard: {'PASS' if ok1 else 'FAIL'} | Challenge: {'PASS' if ok2 else 'FAIL'}")
    print("=======================================================")
