package com.keke.bridge

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.os.Handler
import android.os.HandlerThread
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
                socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
                socket!!.connect()
                out = socket!!.outputStream
                connected = true
                listener.onPaiPaiConnected(device.name ?: device.address)
                listener.onPaiPaiLog("拍拍器已连接")
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

    fun disconnect() {
        connected = false
        bgHandler.post {
            try {
                out?.close()
                socket?.close()
            } catch (_: Exception) {}
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
