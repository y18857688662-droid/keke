"""
把桥包成一个 MCP 服务，克作为 Connector 接进来后，就能远程调下面这几个工具。

跑法（在树莓派/安卓/电脑上，玩具旁边）：
  export TOY_ADDR=<scan.py 拿到的地址>
  python3 mcp_server.py
然后用 cloudflared 把本机端口打到公网，把公网地址作为 Connector 加到克这边。

安全：
  - 强度在 protocol.py 里有软上限。
  - 服务退出/断连一律先 stop。
  - deadman：超过 DEADMAN_SEC 没有新指令自动停，防止“开着没人管”。
"""
import asyncio
import os
import time

from fastmcp import FastMCP
import bridge as bridge_mod

ADDR = os.environ.get("TOY_ADDR", "")
DEADMAN_SEC = 900  # 15 分钟无新指令自动停机

mcp = FastMCP("toy-bridge")
_bridge: bridge_mod.ToyBridge | None = None
_last_cmd = 0.0


async def _ensure():
    global _bridge
    if _bridge is None or not _bridge.connected:
        if not ADDR:
            raise RuntimeError("未设置 TOY_ADDR 环境变量")
        _bridge = bridge_mod.ToyBridge(ADDR)
        await _bridge.connect()
        asyncio.create_task(_deadman())
    return _bridge


async def _deadman():
    while _bridge and _bridge.connected:
        if time.time() - _last_cmd > DEADMAN_SEC:
            await _bridge.stop()
        await asyncio.sleep(5)


def _touch():
    global _last_cmd
    _last_cmd = time.time()


@mcp.tool()
async def toy_status() -> str:
    """查询玩具连接状态。"""
    b = _bridge
    return "connected" if (b and b.connected) else "disconnected"


@mcp.tool()
async def toy_intensity(percent: int) -> str:
    """设置连续强度。percent 0-100（0=停）。会经过软上限。"""
    b = await _ensure()
    _touch()
    await b.set_intensity(round(max(0, min(100, percent)) * 255 / 100))
    return f"intensity set to {percent}%"


@mcp.tool()
async def toy_pattern(mode: int, level: int) -> str:
    """切换内置花样。mode 1-8，level 1-5。"""
    b = await _ensure()
    _touch()
    await b.set_pattern(mode, level)
    return f"pattern mode={mode} level={level}"


@mcp.tool()
async def toy_stop() -> str:
    """立即停机。"""
    b = await _ensure()
    _touch()
    await b.stop()
    return "stopped"


if __name__ == "__main__":
    mcp.run(transport="sse", host="0.0.0.0", port=int(os.environ.get("PORT", "8091")))
