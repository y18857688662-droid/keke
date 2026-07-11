"""
第一步：找到玩具，确认协议。

用法：
  python3 scan.py            # 扫附近 BLE 设备，找出玩具的地址
  python3 scan.py <地址>      # 连上它，打印所有服务/特征，确认 FFE0/FFE1 在不在

SL278J 如果打印出 FFE0/FFE1，就说明和 SL278H 同协议，可以直接用 bridge.py。
"""
import asyncio
import sys
from bleak import BleakScanner, BleakClient


async def scan():
    print("扫描中（5 秒）… 玩具要先开机")
    devices = await BleakScanner.discover(timeout=5.0)
    for d in devices:
        name = d.name or "(无名)"
        # Svakom 设备名常见形如 "Svakom xxx" / "SL278..."
        flag = "  <-- 像玩具" if d.name and ("svakom" in d.name.lower() or "sl278" in d.name.lower()) else ""
        print(f"  {d.address}   {name}{flag}")
    print("\n把上面像玩具那一行的地址，作为参数再跑一次： python3 scan.py <地址>")


async def explore(address):
    print(f"连接 {address} …")
    async with BleakClient(address) as client:
        print("已连接，服务列表：")
        found_ctrl = False
        for service in client.services:
            print(f"[Service] {service.uuid}")
            for ch in service.characteristics:
                props = ",".join(ch.properties)
                print(f"    └─ {ch.uuid}  ({props})")
                if ch.uuid.lower().startswith("0000ffe1"):
                    found_ctrl = True
        print()
        if found_ctrl:
            print("✅ 找到控制通道 FFE1，和 SL278H 同协议，可以直接用 bridge.py")
        else:
            print("⚠️ 没找到 FFE1，型号协议可能不同，需要抓包逆向，把上面整段发给克")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        asyncio.run(explore(sys.argv[1]))
    else:
        asyncio.run(scan())
