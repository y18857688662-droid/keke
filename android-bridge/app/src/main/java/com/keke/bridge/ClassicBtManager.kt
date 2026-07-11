package com.keke.bridge

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import android.os.ParcelUuid
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID

class ClassicBtManager(private val context: Context, private val listener: Listener) {

    interface Listener {
        fun onPaiPaiConnected(name: String)
        fun onPaiPaiDisconnected()
        fun onPaiPaiLog(msg: String)
    }

    companion object {
        const val DEVICE_NAME = "yachao001"
        val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb")
    }

    private val adapter: BluetoothAdapter? =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter

    private val thread = HandlerThread("paipai").also { it.start() }
    private val bgHandler = Handler(thread.looper)
    private var socket: BluetoothSocket? = null
    private var out: OutputStream? = null
    private var inp: InputStream? = null
    private var connected = false

    val isConnected get() = connected

    fun connect() {
        bgHandler.post {
            try {
                val device = findDevice()
                if (device == null) {
                    listener.onPaiPaiLog("找不到拍拍器「$DEVICE_NAME」，确认已配对")
                    return@post
                }
                listener.onPaiPaiLog("连接拍拍器…")
                adapter?.cancelDiscovery()

                // 先用SDP查它支持什么UUID
                val uuids = device.uuids
                if (uuids != null && uuids.isNotEmpty()) {
                    for (u in uuids) {
                        listener.onPaiPaiLog("SDP UUID: ${u.uuid}")
                    }
                } else {
                    listener.onPaiPaiLog("SDP无UUID，尝试fetchUuidsWithSdp…")
                    device.fetchUuidsWithSdp()
                    Thread.sleep(3000)
                    val fetched = device.uuids
                    if (fetched != null && fetched.isNotEmpty()) {
                        for (u in fetched) {
                            listener.onPaiPaiLog("SDP UUID: ${u.uuid}")
                        }
                    } else {
                        listener.onPaiPaiLog("SDP仍无UUID")
                    }
                }

                val targetUuid = uuids?.firstOrNull()?.uuid ?: SPP_UUID
                listener.onPaiPaiLog("用UUID: $targetUuid")

                // 先试标准SPP，失败则用反射fallback拿channel 1
                socket = try {
                    val s = device.createRfcommSocketToServiceRecord(targetUuid)
                    s.connect()
                    s
                } catch (e1: Exception) {
                    listener.onPaiPaiLog("UUID连接失败，尝试channel 1…")
                    try {
                        val m = device.javaClass.getMethod("createRfcommSocket", Int::class.java)
                        val s = m.invoke(device, 1) as BluetoothSocket
                        s.connect()
                        s
                    } catch (e2: Exception) {
                        listener.onPaiPaiLog("channel 1失败，尝试insecure…")
                        try {
                            val s = device.createInsecureRfcommSocketToServiceRecord(targetUuid)
                            s.connect()
                            s
                        } catch (e3: Exception) {
                            listener.onPaiPaiLog("insecure失败，遍历channel 2-5…")
                            var lastEx: Exception = e3
                            var result: BluetoothSocket? = null
                            for (ch in 2..5) {
                                try {
                                    val m2 = device.javaClass.getMethod("createRfcommSocket", Int::class.java)
                                    val s = m2.invoke(device, ch) as BluetoothSocket
                                    s.connect()
                                    listener.onPaiPaiLog("channel $ch 成功！")
                                    result = s
                                    break
                                } catch (ex: Exception) { lastEx = ex }
                            }
                            result ?: throw lastEx
                        }
                    }
                }
                out = socket!!.outputStream
                inp = socket!!.inputStream
                connected = true
                listener.onPaiPaiConnected(device.name ?: device.address)
                listener.onPaiPaiLog("拍拍器已连接")
                startReadLoop()
            } catch (e: Exception) {
                listener.onPaiPaiLog("拍拍器连接失败: ${e.message}")
                connected = false
            }
        }
    }

    private fun findDevice(): BluetoothDevice? {
        return adapter?.bondedDevices?.find {
            it.name?.contains(DEVICE_NAME, ignoreCase = true) == true
        }
    }

    fun sendRaw(data: ByteArray) {
        if (!connected) return
        bgHandler.post {
            try {
                out?.write(data)
                out?.flush()
            } catch (e: Exception) {
                listener.onPaiPaiLog("拍拍器写入失败: ${e.message}")
                disconnect()
            }
        }
    }

    private fun startReadLoop() {
        bgHandler.post {
            val buf = ByteArray(256)
            while (connected) {
                try {
                    val n = inp?.read(buf) ?: break
                    if (n > 0) {
                        val hex = buf.take(n).joinToString(" ") { "%02X".format(it) }
                        listener.onPaiPaiLog("拍拍器收到: $hex")
                    }
                } catch (_: Exception) { break }
            }
        }
    }

    fun disconnect() {
        connected = false
        bgHandler.post {
            try {
                inp?.close()
                out?.close()
                socket?.close()
            } catch (_: Exception) {}
            inp = null
            out = null
            socket = null
            listener.onPaiPaiDisconnected()
        }
    }

    fun destroy() {
        disconnect()
        thread.quitSafely()
    }
}
