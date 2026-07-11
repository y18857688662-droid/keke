"""
桥核心：维持与玩具的蓝牙连接，按当前目标强度持续发 keepalive。

设计要点：
  - 单一“当前状态”，后台循环每 1.5s 重发，维持设备不超时停机。
  - 任何断开、异常、退出，都先发 stop，绝不让它卡在开着的状态。
  - 提供 async 接口给 mcp_server.py 调用。

单独运行可做本地自测：
  python3 bridge.py <地址>      # 连上后进入交互，输入 0-100 调强度，q 退出
"""
import asyncio
import sys
from bleak import BleakClient

import protocol


class ToyBridge:
    def __init__(self, address: str):
        self.address = address
        self._client: BleakClient | None = None
        self._current: bytes = protocol.packet_stop()
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    @property
    def connected(self) -> bool:
        return self._client is not None and self._client.is_connected

    async def connect(self):
        self._client = BleakClient(self.address)
        await self._client.connect()
        # 安全：把当前状态复位成 stop，别继承上一次的强度
        self._current = protocol.packet_stop()
        self._task = asyncio.create_task(self._keepalive_loop())
        print(f"[bridge] 已连接 {self.address}")

    async def _write(self, data: bytes):
        # 安全闸：永远不碰固件 OTA 通道
        async with self._lock:
            if self._client and self._client.is_connected:
                await self._client.write_gatt_char(protocol.WRITE_UUID, data, response=False)

    async def _keepalive_loop(self):
        try:
            while self.connected:
                await self._write(self._current)
                await asyncio.sleep(protocol.KEEPALIVE_SEC)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[bridge] keepalive 异常，安全停机：{e}")
            await self.stop()

    # —— 对外接口 ——
    async def set_intensity(self, intensity: int):
        self._current = protocol.packet_intensity(intensity)
        await self._write(self._current)

    async def set_pattern(self, mode: int, level: int):
        self._current = protocol.packet_pattern(mode, level)
        await self._write(self._current)

    async def stop(self):
        self._current = protocol.packet_stop()
        await self._write(self._current)

    async def disconnect(self):
        try:
            await self.stop()
        finally:
            if self._task:
                self._task.cancel()
            if self._client:
                await self._client.disconnect()
            print("[bridge] 已断开（已先停机）")


async def _repl(address):
    bridge = ToyBridge(address)
    await bridge.connect()
    print("输入 0-100 调强度，p<mode> <level> 换花样，s 停，q 退出")
    loop = asyncio.get_event_loop()
    try:
        while True:
            line = (await loop.run_in_executor(None, input, "> ")).strip()
            if line == "q":
                break
            elif line == "s":
                await bridge.stop()
            elif line.startswith("p"):
                _, lvl = line[1:].split()
                await bridge.set_pattern(int(line[1:].split()[0]), int(lvl))
            elif line.isdigit():
                await bridge.set_intensity(round(int(line) * 255 / 100))
    finally:
        await bridge.disconnect()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python3 bridge.py <玩具地址>  (先用 scan.py 拿地址)")
        sys.exit(1)
    asyncio.run(_repl(sys.argv[1]))
