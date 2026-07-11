"""
Svakom SL278 BLE 协议封装（基于 SL278H 逆向，SL278J 大概率通用）

⚠️ 安全红线：
  - 只往控制通道 FFE0/FFE1 写。AE00/AE01 是固件 OTA 通道，写错会刷坏设备，绝不碰。
  - 强度做了软上限，别一上来拉满。
"""

# —— 控制通道 ——
SERVICE_UUID = "0000ffe0-0000-1000-8000-00805f9b34fb"
WRITE_UUID   = "0000ffe1-0000-1000-8000-00805f9b34fb"

# —— 禁区：固件 OTA，任何情况都不许写 ——
FORBIDDEN_SERVICE = "0000ae00-0000-1000-8000-00805f9b34fb"
FORBIDDEN_CHAR    = "0000ae01-0000-1000-8000-00805f9b34fb"

# 设备有超时保护：发一次只动一下，必须按这个间隔重发当前指令维持
KEEPALIVE_SEC = 1.5

# 软上限：瑶瑶反馈最低档都偏快，先从保守区间给，习惯了再放开
INTENSITY_SOFT_CAP = 180   # 0-255 的可写上限，宁可低不可猛


def clamp_intensity(intensity: int) -> int:
    intensity = int(intensity)
    if intensity < 0:
        intensity = 0
    if intensity > INTENSITY_SOFT_CAP:
        intensity = INTENSITY_SOFT_CAP
    return intensity


def packet_intensity(intensity: int) -> bytes:
    """连续强度控制。intensity 0-255（这里会先过软上限）。"""
    return bytes([0x55, 0x04, 0x00, 0x00, 0x01, clamp_intensity(intensity), 0xAA])


def packet_pattern(mode: int, level: int) -> bytes:
    """内置花样。mode 1-8，level 1-5。"""
    mode = max(1, min(8, int(mode)))
    level = max(1, min(5, int(level)))
    return bytes([0x55, 0x03, 0x00, 0x00, mode, level, 0x00])


def packet_stop() -> bytes:
    return bytes([0x55, 0x04, 0x00, 0x00, 0x00, 0x00, 0xAA])
