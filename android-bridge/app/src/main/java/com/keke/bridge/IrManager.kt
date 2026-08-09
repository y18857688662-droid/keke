package com.keke.bridge

import android.content.Context
import android.hardware.ConsumerIrManager

class IrManager(context: Context, private val listener: Listener) {

    interface Listener {
        fun onIrLog(msg: String)
    }

    private val ir: ConsumerIrManager? =
        context.getSystemService(Context.CONSUMER_IR_SERVICE) as? ConsumerIrManager

    val hasIr: Boolean get() = ir?.hasIrEmitter() == true

    // 常见拍拍器红外编码 — NEC协议，38kHz载波
    // 大眼妙妙/通用自拍遥控器常见编码
    private val necPatterns = listOf(
        // 模式1: 通用NEC自拍快门 (地址0x00, 命令0x01)
        intArrayOf(
            9000, 4500,
            560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560,  // addr 0x00
            560, 1690, 560, 1690, 560, 1690, 560, 1690, 560, 1690, 560, 1690, 560, 1690, 560, 1690,  // ~addr
            560, 1690, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560,  // cmd 0x01 (bit0=1)
            560, 560, 560, 1690, 560, 1690, 560, 1690, 560, 1690, 560, 1690, 560, 1690, 560, 1690,  // ~cmd
            560, 40000
        ),
        // 模式2: 另一个常见编码 (地址0x00, 命令0x02)
        intArrayOf(
            9000, 4500,
            560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560,
            560, 1690, 560, 1690, 560, 1690, 560, 1690, 560, 1690, 560, 1690, 560, 1690, 560, 1690,
            560, 560, 560, 1690, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560,  // cmd 0x02
            560, 1690, 560, 560, 560, 1690, 560, 1690, 560, 1690, 560, 1690, 560, 1690, 560, 1690,
            560, 40000
        ),
        // 模式3: 0xFE01 (常见廉价自拍器)
        intArrayOf(
            9000, 4500,
            560, 1690, 560, 1690, 560, 1690, 560, 1690, 560, 1690, 560, 1690, 560, 1690, 560, 560, // addr 0xFE
            560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 1690,       // ~addr
            560, 1690, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560,        // cmd 0x01
            560, 560, 560, 1690, 560, 1690, 560, 1690, 560, 1690, 560, 1690, 560, 1690, 560, 1690,  // ~cmd
            560, 40000
        )
    )

    companion object {
        const val FREQ = 38000
    }

    fun send(patternIndex: Int = 0) {
        if (ir == null || !hasIr) {
            listener.onIrLog("没有红外发射器")
            return
        }
        val idx = patternIndex.coerceIn(0, necPatterns.size - 1)
        try {
            ir.transmit(FREQ, necPatterns[idx])
            listener.onIrLog("红外已发射 模式${idx + 1}")
        } catch (e: Exception) {
            listener.onIrLog("红外发射失败: ${e.message}")
        }
    }

    fun sendAll() {
        if (ir == null || !hasIr) {
            listener.onIrLog("没有红外发射器")
            return
        }
        for (i in necPatterns.indices) {
            try {
                ir.transmit(FREQ, necPatterns[i])
                listener.onIrLog("红外模式${i + 1}已发射")
                Thread.sleep(500)
            } catch (e: Exception) {
                listener.onIrLog("红外模式${i + 1}失败: ${e.message}")
            }
        }
    }

    fun sendRaw(freq: Int, pattern: IntArray) {
        if (ir == null || !hasIr) {
            listener.onIrLog("没有红外发射器")
            return
        }
        try {
            ir.transmit(freq, pattern)
            listener.onIrLog("红外原始发射完成")
        } catch (e: Exception) {
            listener.onIrLog("红外发射失败: ${e.message}")
        }
    }
}
