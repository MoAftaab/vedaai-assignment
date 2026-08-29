import urllib.request
import urllib.error
import json
import ssl
import time
import sys
import os

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

models = [
    "gpt-5.6-sol",
    "claude-opus-4-8",
    "claude-opus-5",
    "deepseek-v4-flash",
    "glm-5.3",
]

ctx = ssl.create_default_context()
summary = []

for model in models:
    print(f"\n=======================================================")
    print(f" TESTING MODEL: {model}")
    print(f"=======================================================")
    
    # 1. Try Anthropic /v1/messages
    url_anthropic = "https://agentrouter.org/v1/messages"
    payload_anthropic = {
        "model": model,
        "max_tokens": 30,
        "messages": [{"role": "user", "content": "Hi, reply in 5 words."}],
    }
    t0 = time.time()
    try:
        data = json.dumps(payload_anthropic).encode("utf-8")
        req = urllib.request.Request(url_anthropic, data=data, headers=headers_anthropic, method="POST")
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            elapsed = round((time.time() - t0) * 1000)
            raw = resp.read().decode("utf-8", errors="replace")
            parsed = json.loads(raw)
            text = "".join(b.get("text", "") for b in parsed.get("content", []) if b.get("type") == "text").strip().replace("\n", " ")
            usage = parsed.get("usage", {})
            print(f"[/v1/messages] Status: 200 OK | Latency: {elapsed}ms")
            print(f"  Generated Text: \"{text}\"")
            print(f"  Usage: {usage}")
            summary.append({
                "model": model,
                "endpoint": "/v1/messages",
                "status": 200,
                "ok": True,
                "latency_ms": elapsed,
                "output": text,
                "usage": usage
            })
    except urllib.error.HTTPError as e:
        elapsed = round((time.time() - t0) * 1000)
        raw = e.read().decode("utf-8", errors="replace")
        try:
            err_json = json.loads(raw)
            err_msg = err_json.get("error", {}).get("message") or err_json.get("message") or raw[:100]
        except Exception:
            err_msg = raw[:100]
        print(f"[/v1/messages] Status: HTTP {e.code} | Latency: {elapsed}ms | Error: {err_msg}")
        summary.append({
            "model": model,
            "endpoint": "/v1/messages",
            "status": e.code,
            "ok": False,
            "latency_ms": elapsed,
            "error": err_msg
        })
    except Exception as e:
        print(f"[/v1/messages] Error: {e}")

    # 2. Try OpenAI /v1/chat/completions
    url_openai = "https://agentrouter.org/v1/chat/completions"
    payload_openai = {
        "model": model,
        "max_tokens": 30,
        "messages": [{"role": "user", "content": "Hi, reply in 5 words."}],
    }
    t0 = time.time()
    try:
        data = json.dumps(payload_openai).encode("utf-8")
        req = urllib.request.Request(url_openai, data=data, headers=headers_openai, method="POST")
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            elapsed = round((time.time() - t0) * 1000)
            raw = resp.read().decode("utf-8", errors="replace")
            parsed = json.loads(raw)
            text = parsed.get("choices", [{}])[0].get("message", {}).get("content", "").strip().replace("\n", " ")
            usage = parsed.get("usage", {})
            print(f"[/v1/chat/completions] Status: 200 OK | Latency: {elapsed}ms")
            print(f"  Generated Text: \"{text}\"")
            print(f"  Usage: {usage}")
            summary.append({
                "model": model,
                "endpoint": "/v1/chat/completions",
                "status": 200,
                "ok": True,
                "latency_ms": elapsed,
                "output": text,
                "usage": usage
            })
    except urllib.error.HTTPError as e:
        elapsed = round((time.time() - t0) * 1000)
        raw = e.read().decode("utf-8", errors="replace")
        try:
            err_json = json.loads(raw)
            err_msg = err_json.get("error", {}).get("message") or err_json.get("message") or raw[:100]
        except Exception:
            err_msg = raw[:100]
        print(f"[/v1/chat/completions] Status: HTTP {e.code} | Latency: {elapsed}ms | Error: {err_msg}")
        summary.append({
            "model": model,
            "endpoint": "/v1/chat/completions",
            "status": e.code,
            "ok": False,
            "latency_ms": elapsed,
            "error": err_msg
        })
    except Exception as e:
        print(f"[/v1/chat/completions] Error: {e}")
