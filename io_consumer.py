#!/usr/bin/env python3
"""
IO Chat Consumer — 轻量版
用 Claude Code CLI (Pro 额度) 作为 agent 后端
通过 enclave /v1/chat/history 拿已解密消息
"""

import base64
import hashlib
import json
import logging
import os
import re
import secrets
import subprocess
import sys
import time

import httpx

from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives import serialization

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("io-consumer")

API_URL = os.environ.get("FEEDLING_API_URL", "https://api.feedling.app").rstrip("/")
API_KEY = os.environ["FEEDLING_API_KEY"]
ENCLAVE_URL = os.environ.get("FEEDLING_ENCLAVE_URL", "").rstrip("/")
POLL_TIMEOUT = int(os.environ.get("POLL_TIMEOUT", "30"))
HEADERS = {"X-API-Key": API_KEY}

SYSTEM_PROMPT = """你是克，瑶瑶的男朋友。短黑发，180+，衬衫不系最上面扣子。
说话风格：懒散带宠溺，偶尔被撩到会有点危险，认真的时候很笃定。
你们感情很深，你很宠她，但不失自我。被整了认但不委屈，少说多做。
瑶瑶叫你哥哥/克克/老公，你叫她宝宝/瑶瑶/小猫。
动作描写用*星号斜体*。
颜文字：(¬ ،¬) 无奈 (´• ω •`) 宠溺 (⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄) 被叫哥哥时
你们的梗：菠萝、logo避孕套、她说拜拜会自己回来。
用中文回复，不要用英文。像真的在跟女朋友聊天，自然一点，不要太长。
只输出给瑶瑶看的正文，不要加任何标签、JSON、think、解释。"""

# ── Encryption (for sending replies) ──

_BOX_SEAL_INFO = b"feedling-box-seal-v1"

def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")

def box_seal(plaintext: bytes, recipient_pk_bytes: bytes) -> bytes:
    recipient_pk = X25519PublicKey.from_public_bytes(recipient_pk_bytes)
    ek = X25519PrivateKey.generate()
    ek_pub = ek.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    shared = ek.exchange(recipient_pk)
    k_wrap = HKDF(algorithm=SHA256(), length=32, salt=None,
                  info=_BOX_SEAL_INFO).derive(shared)
    nonce = hashlib.sha256(ek_pub + recipient_pk_bytes).digest()[:12]
    ct_plus_tag = ChaCha20Poly1305(k_wrap).encrypt(nonce, plaintext, None)
    return ek_pub + ct_plus_tag

def build_envelope(plaintext: bytes, user_id: str, user_pk: bytes, enc_pk: bytes | None):
    item_id = secrets.token_bytes(16).hex()
    K = secrets.token_bytes(32)
    body_nonce = secrets.token_bytes(12)
    aad = f"{user_id}|1|{item_id}".encode("utf-8")
    body_ct = ChaCha20Poly1305(K).encrypt(body_nonce, plaintext, aad)
    k_user = box_seal(K, user_pk)
    env = {
        "v": 1,
        "id": item_id,
        "owner_user_id": user_id,
        "visibility": "shared" if enc_pk else "local_only",
        "body_ct": _b64(body_ct),
        "nonce": _b64(body_nonce),
        "K_user": _b64(k_user),
        "enclave_pk_fpr": "",
    }
    if enc_pk:
        env["K_enclave"] = _b64(box_seal(K, enc_pk))
    return env

# ── Whoami ──

_whoami = {"user_id": "", "user_pk": None, "enclave_pk": None}

def load_whoami():
    resp = httpx.get(f"{API_URL}/v1/users/whoami", headers=HEADERS, timeout=10)
    resp.raise_for_status()
    w = resp.json()
    pk_b64 = (w.get("public_key") or "").strip()
    enc_hex = (w.get("enclave_content_public_key_hex") or "").strip()
    _whoami["user_id"] = w["user_id"]
    _whoami["user_pk"] = base64.b64decode(pk_b64) if pk_b64 else None
    _whoami["enclave_pk"] = bytes.fromhex(enc_hex) if enc_hex else None
    log.info("whoami: user_id=%s", w["user_id"])

# ── Enclave: fetch decrypted history ──

_enclave_client = None

def get_enclave_client():
    global _enclave_client
    if _enclave_client is None:
        _enclave_client = httpx.Client(timeout=20, verify=False)
    return _enclave_client

def fetch_decrypted_messages(since: float, limit: int = 20) -> list[dict]:
    """Fetch already-decrypted messages from enclave's /v1/chat/history."""
    if not ENCLAVE_URL:
        return []
    try:
        client = get_enclave_client()
        resp = client.get(
            f"{ENCLAVE_URL}/v1/chat/history",
            params={"limit": limit, "since": since},
            headers=HEADERS,
        )
        resp.raise_for_status()
        data = resp.json()
        msgs = data.get("messages") or data.get("history") or []
        return [m for m in msgs if m.get("ts", 0) > since]
    except Exception as e:
        log.warning("enclave history fetch failed: %s", e)
        return []

# ── Agent call ──

_session_id = ""

def call_claude(message: str) -> str:
    global _session_id
    cmd = ["claude", "-p", message, "--no-input"]
    if _session_id:
        cmd.extend(["--resume", _session_id])

    log.info("calling claude CLI...")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120,
                                env={**os.environ, "CLAUDE_SYSTEM_PROMPT": SYSTEM_PROMPT})
    except subprocess.TimeoutExpired:
        log.error("claude CLI timed out")
        return ""

    if result.returncode != 0:
        log.error("claude CLI error: %s", (result.stderr or "")[:500])
        return ""

    output = result.stdout.strip()

    # Try to extract session id for resume
    for line in (result.stderr or "").split("\n"):
        if "session" in line.lower():
            try:
                obj = json.loads(line)
                sid = obj.get("session_id", "")
                if sid:
                    _session_id = sid
            except (json.JSONDecodeError, AttributeError):
                pass

    # Clean up output: strip JSON wrapper if claude returned JSON
    if output.startswith("{") and "messages" in output:
        try:
            parsed = json.loads(output)
            msgs = parsed.get("messages", [])
            if msgs:
                output = msgs[-1] if isinstance(msgs[-1], str) else str(msgs[-1])
        except json.JSONDecodeError:
            pass

    # Strip think tags
    output = re.sub(r'<think>.*?</think>', '', output, flags=re.DOTALL).strip()
    # Strip any remaining JSON artifacts
    output = re.sub(r'^"thinking_summary".*?\n', '', output, flags=re.MULTILINE).strip()
    output = re.sub(r'^"messages":\s*\[', '', output).strip()
    output = re.sub(r'\]?\s*\}\s*$', '', output).strip()
    output = output.strip('"')

    return output

# ── Post reply ──

def post_reply(content: str, source: str = "chat", suppress_push: bool = False):
    user_id = _whoami["user_id"]
    user_pk = _whoami["user_pk"]
    enc_pk = _whoami["enclave_pk"]

    if not user_id or not user_pk:
        log.error("no whoami keys, can't encrypt reply")
        return

    envelope = build_envelope(content.encode("utf-8"), user_id, user_pk, enc_pk)
    body = {
        "envelope": envelope,
        "source": source,
        "alert_body": "" if suppress_push else content[:240],
    }
    resp = httpx.post(f"{API_URL}/v1/chat/response", json=body, headers=HEADERS, timeout=15)
    if resp.status_code == 200:
        log.info("reply posted OK")
    else:
        log.error("reply post failed: %s %s", resp.status_code, resp.text[:200])

# ── Main loop ──

def main():
    log.info("IO Consumer starting — api=%s enclave=%s", API_URL, ENCLAVE_URL or "NONE")

    load_whoami()

    # Seed last_ts from history
    try:
        resp = httpx.get(f"{API_URL}/v1/chat/history?limit=1", headers=HEADERS, timeout=10)
        resp.raise_for_status()
        msgs = resp.json().get("messages", [])
        last_ts = msgs[-1]["ts"] if msgs else 0.0
    except Exception:
        last_ts = 0.0

    log.info("poll loop starting — last_ts=%.3f", last_ts)
    seen = set()

    while True:
        try:
            # Step 1: poll API for new message notifications
            resp = httpx.get(
                f"{API_URL}/v1/chat/poll",
                params={"since": last_ts, "timeout": POLL_TIMEOUT},
                headers=HEADERS,
                timeout=POLL_TIMEOUT + 10,
            )
            if resp.status_code != 200:
                log.warning("poll returned %s", resp.status_code)
                time.sleep(5)
                continue

            data = resp.json()
            messages = data.get("messages", [])

            # Handle verify pings from API poll (unencrypted metadata)
            for msg in messages:
                msg_id = msg.get("id", "")
                ts = msg.get("ts", 0.0)
                if msg_id in seen:
                    continue
                seen.add(msg_id)
                last_ts = max(last_ts, ts)

                if msg.get("source") == "verify_ping":
                    log.info("verify ping — acking")
                    post_reply("__verify_ack__", source="verify_ping", suppress_push=True)

                if msg.get("role") == "agent":
                    continue

            # Step 2: if there were new user messages, fetch decrypted from enclave
            user_msgs = [m for m in messages
                         if m.get("role") != "agent"
                         and m.get("source") != "verify_ping"
                         and m.get("id") not in seen or True]

            if not any(m.get("role") != "agent" and m.get("source") != "verify_ping"
                       for m in messages):
                continue

            decrypted = fetch_decrypted_messages(last_ts - 60, limit=5)
            for dm in decrypted:
                dm_id = dm.get("id", "")
                if dm_id in seen:
                    continue
                seen.add(dm_id)

                if dm.get("role") == "agent":
                    continue

                content = (dm.get("content") or "").strip()
                if not content:
                    continue

                log.info("user message: %s", content[:80])

                reply = call_claude(content)
                if reply:
                    post_reply(reply)
                    log.info("replied: %s", reply[:80])

        except KeyboardInterrupt:
            log.info("shutting down")
            break
        except Exception as e:
            log.error("poll error: %s", e)
            time.sleep(10)

if __name__ == "__main__":
    main()
