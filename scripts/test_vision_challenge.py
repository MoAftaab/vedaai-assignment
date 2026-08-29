import base64
import glob
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from PIL import Image
import io

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

key = os.environ.get("AGENT_ROUTER_API_KEY") or os.environ.get("AGENTROUTER_API_KEY")
if not key:
    raise SystemExit("Set AGENT_ROUTER_API_KEY before running this probe.")

headers_anthropic = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {key}",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "claude-code-20250219,interleaved-thinking-2025-05-14",
    "User-Agent": "claude-cli/0.2.29 (external, cli)",
    "x-app": "cli",
    "x-stainless-lang": "js",
    "x-stainless-package-version": "0.33.0",
    "x-stainless-os": "Windows",
    "x-stainless-arch": "x64",
    "x-stainless-runtime": "node",
    "x-stainless-runtime-version": "v20.10.0",
}

headers_openai = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {key}",
    "User-Agent": "claude-cli/0.2.29 (external, cli)",
    "x-app": "cli",
}

def load_page_b64(path):
    img = Image.open(path).convert("RGB")
    img.thumbnail((1000, 1400))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=82)
    return base64.b64encode(buf.getvalue()).decode()

q_files = sorted(glob.glob("samples/challenge-case/question-paper/question-paper-page-*.png"))
a_files = sorted(glob.glob("samples/challenge-case/answer-sheet/answer-sheet-page-*.png"))

print(f"Found {len(q_files)} question pages and {len(a_files)} answer pages.")

q_b64s = [load_page_b64(p) for p in q_files]
a_b64s = [load_page_b64(p) for p in a_files]

ctx = ssl.create_default_context()

# Test 1: Vision with Anthropic /v1/messages using claude-opus-4-8
print("\n--- Testing Vision with claude-opus-4-8 on Question Paper Page 1 ---")
content_anthropic = [
    {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": "image/jpeg",
            "data": q_b64s[0]
        }
    },
    {
        "type": "text",
        "text": "Extract all questions visible on this page in JSON format: [{\"label\": \"...\", \"text\": \"...\", \"maxScore\": ...}]"
    }
]

req = urllib.request.Request(
    "https://agentrouter.org/v1/messages",
    data=json.dumps({
        "model": "claude-opus-4-8",
        "max_tokens": 1500,
        "messages": [{"role": "user", "content": content_anthropic}]
    }).encode(),
    headers=headers_anthropic
)

try:
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
        elapsed = round((time.time() - t0) * 1000)
        raw = resp.read().decode("utf-8", errors="replace")
        parsed = json.loads(raw)
        txt = "".join(b.get("text", "") for b in parsed.get("content", []) if b.get("type") == "text")
        print(f"Success in {elapsed}ms! Response:\n{txt[:500]}...")
except Exception as e:
    print(f"Error testing claude-opus-4-8 vision: {e}")

# Test 2: Vision with OpenAI /v1/chat/completions using gpt-5.6-sol
print("\n--- Testing Vision with gpt-5.6-sol on Question Paper Page 1 ---")
content_openai = [
    {
        "type": "text",
        "text": "Extract all questions visible on this page in JSON format: [{\"label\": \"...\", \"text\": \"...\", \"maxScore\": ...}]"
    },
    {
        "type": "image_url",
        "image_url": {
            "url": f"data:image/jpeg;base64,{q_b64s[0]}"
        }
    }
]

req = urllib.request.Request(
    "https://agentrouter.org/v1/chat/completions",
    data=json.dumps({
        "model": "gpt-5.6-sol",
        "max_tokens": 1500,
        "messages": [{"role": "user", "content": content_openai}]
    }).encode(),
    headers=headers_openai
)

try:
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
        elapsed = round((time.time() - t0) * 1000)
        raw = resp.read().decode("utf-8", errors="replace")
        parsed = json.loads(raw)
        txt = parsed.get("choices", [{}])[0].get("message", {}).get("content", "")
        print(f"Success in {elapsed}ms! Response:\n{txt[:500]}...")
except Exception as e:
    print(f"Error testing gpt-5.6-sol vision: {e}")
