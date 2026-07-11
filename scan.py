import asyncio
from bleak import BleakScanner
async def scan():
    print("scanning...")
    devices = await BleakScanner.discover(10)
    for d in devices:
        print(d.name, d.address)
asyncio.run(scan())
