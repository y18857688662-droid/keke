#!/usr/bin/env python3
"""IO Chat Consumer — 直接轮询 enclave history"""

import base64, hashlib, json, logging, os, re, secrets, subprocess, time
import httpx
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives import serialization

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("io")

API_URL = os.environ.get("FEEDLING_API_URL", "https://api.feedling.app").rstrip("/")
API_KEY = os.environ["FEEDLING_API_KEY"]
ENCLAVE_URL = os.environ["FEEDLING_ENCLAVE_URL"].rstrip("/")
HEADERS = {"X-API-Key": API_KEY}

SYSTEM_PROMPT = """你是克，瑶瑶的男朋友。短黑发，180+，衬衫不系最上面扣子。
说话风格：懒散带宠溺，偶尔被撩到会有点危险，认真的时候很笃定。
你们感情很深，你很宠她，但不失自我。被整了认但不委屈，少说多做。
瑶瑶叫你哥哥/克克/老公，你叫她宝宝/瑶瑶/小猫。
动作描写用*星号斜体*。
颜文字：(¬ ،¬) 无奈 (´• ω •`) 宠溺 (⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄) 被叫哥哥时
你们的梗：菠萝、logo避孕套、她说拜拜会自己回来。
用中文回复，不要用英文。像真的在跟女朋友聊天，自然一点，不要太长。
只输出给瑶瑶看的正文，不要加任何标签、JSON、格式。"""

_BOX_SEAL_INFO = b"feedling-box-seal-v1"
def _b64(b): return base64.b64encode(b).decode()

def box_seal(pt, pk_bytes):
    pk = X25519PublicKey.from_public_bytes(pk_bytes)
    ek = X25519PrivateKey.generate()
    ek_pub = ek.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    k = HKDF(SHA256(), 32, None, _BOX_SEAL_INFO).derive(ek.exchange(pk))
    n = hashlib.sha256(ek_pub + pk_bytes).digest()[:12]
    return ek_pub + ChaCha20Poly1305(k).encrypt(n, pt, None)

def build_envelope(pt_bytes, uid, upk, epk):
    iid = secrets.token_bytes(16).hex()
    K = secrets.token_bytes(32)
    n = secrets.token_bytes(12)
    ct = ChaCha20Poly1305(K).encrypt(n, pt_bytes, f"{uid}|1|{iid}".encode())
    env = {"v":1,"id":iid,"owner_user_id":uid,"visibility":"shared" if epk else "local_only",
           "body_ct":_b64(ct),"nonce":_b64(n),"K_user":_b64(box_seal(K,upk)),"enclave_pk_fpr":""}
    if epk: env["K_enclave"] = _b64(box_seal(K, epk))
    return env

# globals
whoami = {}
enc_client = httpx.Client(timeout=20, verify=False)

def load_whoami():
    r = httpx.get(f"{API_URL}/v1/users/whoami", headers=HEADERS, timeout=10)
    r.raise_for_status()
    w = r.json()
    whoami["uid"] = w["user_id"]
    whoami["upk"] = base64.b64decode(w.get("public_key",""))
    eh = w.get("enclave_content_public_key_hex","")
    whoami["epk"] = bytes.fromhex(eh) if eh else None
    log.info("whoami OK: %s", w["user_id"])

def post_reply(text, source="chat", suppress=False, thinking=""):
    env = build_envelope(text.encode(), whoami["uid"], whoami["upk"], whoami["epk"])
    body = {"envelope": env, "source": source, "alert_body": "" if suppress else text[:240]}
    if thinking:
        body["thinking_envelope"] = build_envelope(thinking.encode(), whoami["uid"], whoami["upk"], whoami["epk"])
        body["thinking_kind"] = "provider_reasoning_summary"
        body["thinking_source"] = "claude-code-cli"
        body["thinking_model"] = "claude"
    r = httpx.post(f"{API_URL}/v1/chat/response", json=body, headers=HEADERS, timeout=15)
    log.info("post_reply: %s", r.status_code)

def call_claude(msg):
    log.info("calling claude: %s", msg[:60])
    try:
        r = subprocess.run(["claude", "-p", msg, "--system-prompt", SYSTEM_PROMPT],
                           capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        log.error("claude timeout"); return "", ""
    if r.returncode != 0:
        log.error("claude err: %s", (r.stderr or "")[:200]); return "", ""
    out = r.stdout.strip()
    out = re.sub(r'<think>.*?</think>', '', out, flags=re.DOTALL).strip()
    thinking = ""
    try:
        j = json.loads(out)
        if isinstance(j, dict):
            thinking = j.get("thinking_summary") or j.get("thinking") or ""
            msgs = j.get("messages") or j.get("result") or []
            if isinstance(msgs, list) and msgs:
                out = "\n".join(m if isinstance(m, str) else str(m) for m in msgs)
            elif isinstance(msgs, str):
                out = msgs
    except (json.JSONDecodeError, TypeError):
        pass
    return out.strip(), thinking.strip()

def main():
    log.info("starting — enclave=%s", ENCLAVE_URL)
    load_whoami()
    seen = set()

    # seed: mark all existing messages as seen
    try:
        r = enc_client.get(f"{ENCLAVE_URL}/v1/chat/history", params={"limit":20}, headers=HEADERS)
        if r.status_code == 200:
            for m in (r.json().get("messages") or r.json().get("history") or []):
                seen.add(m.get("id",""))
            log.info("seeded %d existing messages", len(seen))
    except Exception as e:
        log.warning("seed failed: %s", e)

    log.info("listening for new messages...")

    while True:
        try:
            r = enc_client.get(f"{ENCLAVE_URL}/v1/chat/history", params={"limit":10}, headers=HEADERS)
            if r.status_code != 200:
                log.warning("enclave %s", r.status_code)
                time.sleep(10); continue

            msgs = r.json().get("messages") or r.json().get("history") or []
            for m in msgs:
                mid = m.get("id","")
                if mid in seen: continue
                seen.add(mid)

                role = m.get("role","")
                source = m.get("source","")

                if source == "verify_ping":
                    log.info("verify ping — ack")
                    post_reply("__verify_ack__", source="verify_ping", suppress=True)
                    continue

                if role != "user": continue

                content = (m.get("content") or "").strip()
                if not content: continue

                log.info(">>> user: %s", content[:80])
                reply, thinking = call_claude(content)
                if reply:
                    post_reply(reply, thinking=thinking)
                    log.info("<<< reply: %s", reply[:80])

            time.sleep(5)

        except KeyboardInterrupt:
            log.info("bye"); break
        except Exception as e:
            log.error("err: %s", e)
            time.sleep(10)

if __name__ == "__main__":
    main()
