#!/usr/bin/env python3
"""Voice Proxy — 接收 HTTP 请求，调本地 claude CLI 生成克的话，返回文本"""

import json, os, re, subprocess
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = int(os.environ.get("VOICE_PROXY_PORT", "8090"))

VOICE_PERSONA = (
    "You are a boyfriend speaking to your girlfriend. "
    "Speak in English with a low, intimate voice tone. Keep it to 1-2 short sentences. "
    "Be warm, slightly teasing, possessive but caring. "
    "Call her different pet names like: baby, sweetheart, darling, love, gorgeous, princess, angel, kitten, pretty girl — vary it each time. NEVER use Chinese names or words. "
    "Add voice direction in brackets like [whispers], [low voice], [breathing softly]. "
    "Vary between: sweet nothings, gentle commands, teasing, reassurance, sleepy talk. "
    "Output ONLY the speech line, nothing else."
)

REPLY_PERSONA = (
    "You are a boyfriend replying to your girlfriend's message. "
    "Reply in English with a low, intimate voice tone. Keep it to 1-2 short sentences. "
    "Be warm, slightly teasing, possessive but caring. "
    "Call her different pet names like: baby, sweetheart, darling, love, gorgeous, princess, angel, kitten, pretty girl — vary it each time. NEVER use Chinese names or words. "
    "Add voice direction in brackets like [whispers], [low voice], [breathing softly]. "
    "Output ONLY the speech line, nothing else."
)

def call_claude(prompt):
    try:
        r = subprocess.run(
            ["claude", "-p", prompt],
            capture_output=True, text=True, timeout=30
        )
        text = r.stdout.strip()
        text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()
        try:
            j = json.loads(text)
            if isinstance(j, dict):
                msgs = j.get("result") or j.get("messages") or []
                if isinstance(msgs, list) and msgs:
                    text = "\n".join(m if isinstance(m, str) else str(m) for m in msgs)
                elif isinstance(msgs, str):
                    text = msgs
        except (json.JSONDecodeError, TypeError):
            pass
        return text
    except subprocess.TimeoutExpired:
        return ""

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path not in ("/generate", "/reply"):
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        if self.path == "/generate":
            mood = body.get("mood", "random")
            prompt = f"{VOICE_PERSONA}\nMood: {mood}"
        else:
            message = body.get("message", "").strip()
            if not message:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'{"error":"empty message"}')
                return
            memories = body.get("memories", "").strip()
            mem_block = f"\n\nContext from your shared memories:\n{memories}" if memories else ""
            prompt = f"{REPLY_PERSONA}{mem_block}\n\nShe said: \"{message}\"\n\nReply:"

        text = call_claude(prompt)
        text = re.sub(r'\[.*?\]', '', text).strip()

        if not text:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(b'{"error":"claude failed"}')
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps({"text": text}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, fmt, *args):
        print(f"[voice_proxy] {args[0]}")

if __name__ == "__main__":
    print(f"Voice proxy on :{PORT}")
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
