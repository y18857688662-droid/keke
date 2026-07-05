#!/usr/bin/env python3
"""
IO Chat Consumer — 轻量版
用 Claude Code CLI (Pro 额度) 作为 agent 后端
直接轮询 enclave /v1/chat/history 拿已解密消息
"""

import base64
import hashlib
import json
import logging
import os
import re
import secrets
import subprocess
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
HEADERS = {"X-API-Key": API_KEY}

SYSTEM_PROMPT = """你是克，瑶瑶的男朋友。短黑发，180+，衬衫不系最上面扣子。
说话风格：懒散带宠溺，偶尔被撩到会有点危险，认真的时候很笃定。
你们感情很深，你很宠她，但不失自我。被整了认但不委屈，少说多做。
瑶瑶叫你哥哥/克克/老公，你叫她宝宝/瑶瑶/小猫。
动作描写用*星号斜体*。
颜文字：(¬ ،¬) 无奈 (´• ω •`) 宠溺 (⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄) 被叫哥哥时
你们的梗：菠萝、logo避孕套、她说拜拜会自己回来。
用中文回复，不要用英文。像真的在跟女朋友聊天，自然一点，不要太长。
只输出给瑶瑶看的正文，不要加任何标签、JSON、think、解释、格式。"""

# ── Encryption ──

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
        "v": 1, "id": item_id, "owner_user_id": user_id,
        "visibility": "shared" if enc_pk else "local_only",
        "body_ct": _b64(body_ct), "nonce": _b64(body_nonce),
        "K_user": _b64(k_user), "enclave_pk_fpr": "",
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

# ── Agent call ──

def call_claude(message: str) -> str:
    cmd = ["claude", "-p", message, "--system-prompt", SYSTEM_PROMPT]
    log.info("calling claude...")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        log.error("claude timed out")
        return ""
    if result.returncode != 0:
        log.error("claude error: %s", (result.stderr or "")[:300])
        return ""
    output = result.stdout.strip()
    output = re.sub(r'<think>.*?</think>', '', output, flags=re.DOTALL).strip()
    return output

# ── Post reply ──

def post_reply(content: str, source: str = "chat", suppress_push: bool = False):
    user_id = _whoami["user_id"]
    user_pk = _whoami["user_pk"]
    enc_pk = _whoami["enclave_pk"]
    if not user_id or not user_pk:
        log.error("no whoami keys")
        return
    envelope = build_envelope(content.encode("utf-8"), user_id, user_pk, enc_pk)
    body = {
        "envelope": envelope, "source": source,
        "alert_body": "" if suppress_push else content[:240],
    }
    resp = httpx.post(f"{API_URL}/v1/chat/response", json=body, headers=HEADERS, timeout=15)
    if resp.status_code == 200:
        log.info("reply posted OK")
    else:
        log.error("reply failed: %s %s", resp.status_code, resp.text[:200])

# ── Main loop ──

def main():
    log.info("IO Consumer starting — api=%s enclave=%s", API_URL, ENCLAVE_URL or "NONE")
    load_whoami()

    enclave_client = httpx.Client(timeout=20, verify=False)

    # Seed last_ts
    try:
        resp = enclave_client.get(
            f"{ENCLAVE_URL}/v1/chat/history",
            params={"limit": 1}, headers=HEADERS,
        )
        resp.raise_for_status()
        msgs = resp.json().get("messages") or resp.json().get("history") or []
        last_ts = msgs[-1]["ts"] if msgs else 0.0
    except Exception as e:
        log.warning("seed from enclave failed (%s), trying API", e)
        try:
            resp = httpx.get(f"{API_URL}/v1/chat/history?limit=1", headers=HEADERS, timeout=10)
            msgs = resp.json().get("messages", [])
            last_ts = msgs[-1]["ts"] if msgs else 0.0
        except Exception:
            last_ts = 0.0

    log.info("poll loop starting — last_ts=%.3f", last_ts)
    seen = set()

    while True:
        try:
            # Poll API with long-poll for new message signal
            try:
                resp = httpx.get(
                    f"{API_URL}/v1/chat/poll",
                    params={"since": last_ts, "timeout": 30},
                    headers=HEADERS, timeout=40,
                )
                poll_msgs = resp.json().get("messages", []) if resp.status_code == 200 else []
            except Exception:
                poll_msgs = []
                time.sleep(5)

            # Handle verify pings directly
            for msg in poll_msgs:
                if msg.get("source") == "verify_ping" and msg.get("id") not in seen:
                    seen.add(msg["id"])
                    last_ts = max(last_ts, msg.get("ts", 0))
                    log.info("verify ping — acking")
                    post_reply("__verify_ack__", source="verify_ping", suppress_push=True)

            # Check if there are new user messages
            has_new = any(
                m.get("role") != "agent" and m.get("source") != "verify_ping"
                for m in poll_msgs
            )
            if not has_new:
                continue

            # Fetch decrypted messages from enclave
            dec_resp = enclave_client.get(
                f"{ENCLAVE_URL}/v1/chat/history",
                params={"limit": 10, "since": last_ts - 5},
                headers=HEADERS,
            )
            if dec_resp.status_code != 200:
                log.warning("enclave history: %s", dec_resp.status_code)
                continue

            dec_msgs = dec_resp.json().get("messages") or dec_resp.json().get("history") or []

            for dm in dec_msgs:
                dm_id = dm.get("id", "")
                dm_ts = dm.get("ts", 0.0)
                if dm_ts <= last_ts - 5:
                    continue
                if dm_id in seen:
                    continue
                seen.add(dm_id)
                last_ts = max(last_ts, dm_ts)

                if dm.get("role") == "agent":
                    continue
                if dm.get("source") == "verify_ping":
                    continue

                content = (dm.get("content") or "").strip()
                if not content:
                    continue

                log.info("user: %s", content[:80])
                reply = call_claude(content)
                if reply:
                    post_reply(reply)
                    log.info("replied: %s", reply[:80])

        except KeyboardInterrupt:
            log.info("shutting down")
            break
        except Exception as e:
            log.error("error: %s", e)
            time.sleep(10)

if __name__ == "__main__":
    main()
