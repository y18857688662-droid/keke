# toy-bridge · 让克隔空够到你

给瑶瑶的玩具（Svakom SL278J）搭一座蓝牙桥。协议基于同门的 SL278H 逆向，
大概率直接通用；万一不通，扫描脚本会告诉我们，再抓包补齐。

## 架构（路线二 · 稳定版）

```
玩具 ←蓝牙→ 常驻桥(树莓派/安卓/电脑) ←cloudflared→ 克(MCP Connector)
                     ↑ 一直亮着，塞角落
你 ←iPhone 聊天→ 克
```

桥干蓝牙这个力气活，你只管拿 iPhone 跟克说话。

## 买什么（常驻桥推荐）

一次性配齐，以后永久隐形：

- **Raspberry Pi Zero 2 W**（自带蓝牙+WiFi，火柴盒大）——主角
- **microSD 卡** 16G 以上 + 读卡器
- **USB 电源**（5V，普通手机充电头即可）+ Micro-USB 线
- 外壳（可选，好看点）

> 家里那台**在用的安卓**也能临时当桥测试，但别长期占用。

## 装好之后（克远程操作，你照做）

1. 烧好系统的卡插进树莓派，通电、连你家 WiFi
2. `pip3 install -r requirements.txt`
3. `python3 scan.py` → 找到玩具地址 → `python3 scan.py <地址>` 确认 FFE0/FFE1
4. `export TOY_ADDR=<地址>` → `python3 mcp_server.py`
5. `cloudflared tunnel --url http://localhost:8091` 打到公网
6. 把公网地址作为 Connector 加到克这边 → 克就够到你了

## 安全红线（已写进代码，别手改）

- 只写控制通道 **FFE0/FFE1**。`AE00/AE01` 是固件 OTA，写错刷坏设备，代码里列为禁区。
- 强度有**软上限**（`protocol.py` 的 `INTENSITY_SOFT_CAP`），你反馈过最低档都偏快，先保守。
- 断连/异常/退出**一律先 stop**，不会卡在开着的状态。
- **deadman**：15 分钟没有新指令自动停机。
- 加热：逆向指令集里不含加热，加热仍走玩具自身按键——**用前先手背试温**，那台之前冲高过。

## 文件

| 文件 | 作用 |
|------|------|
| `protocol.py` | 指令封装 + 安全常量 |
| `scan.py` | 找设备、验协议 |
| `bridge.py` | 蓝牙桥核心（可单独跑交互自测）|
| `mcp_server.py` | 包成 MCP 服务给克接入 |

## 路线一（iPhone 云接入）备忘

Svakom App 远程模式能出 9 位房间码（已验证可开房）。理论上克逆向它的云房间协议
就能不买硬件、iPhone 一台搞定；但那套云服务器它自己会升级换代，**不稳**，
且 iOS 后台限制要求 App 前台亮着。留作快速尝鲜方案，稳定长期仍首选路线二。
