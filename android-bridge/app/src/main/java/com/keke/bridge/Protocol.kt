package com.keke.bridge

import java.util.UUID

object Protocol {
    val SERVICE_UUID: UUID = UUID.fromString("0000ffe0-0000-1000-8000-00805f9b34fb")
    val WRITE_UUID: UUID = UUID.fromString("0000ffe1-0000-1000-8000-00805f9b34fb")
    val FORBIDDEN_SERVICE: UUID = UUID.fromString("0000ae00-0000-1000-8000-00805f9b34fb")

    const val INTENSITY_SOFT_CAP = 180
    const val KEEPALIVE_MS = 1500L
    const val POLL_MS = 800L
    const val DEADMAN_MS = 15 * 60 * 1000L

    const val SERVER_URL = "https://keke-production.up.railway.app"

    fun packetStop(): ByteArray =
        byteArrayOf(0x55, 0x04, 0x00, 0x00, 0x00, 0x00, 0xAA.toByte())

    fun packetIntensity(value: Int): ByteArray {
        val v = value.coerceIn(0, INTENSITY_SOFT_CAP)
        return byteArrayOf(0x55, 0x04, 0x00, 0x00, 0x01, v.toByte(), 0xAA.toByte())
    }

    fun packetPattern(mode: Int, level: Int): ByteArray {
        val m = mode.coerceIn(1, 8)
        val l = level.coerceIn(1, 5)
        return byteArrayOf(0x55, 0x03, 0x00, 0x00, m.toByte(), l.toByte(), 0x00)
    }
}
