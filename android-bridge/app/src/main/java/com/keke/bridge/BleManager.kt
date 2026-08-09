package com.keke.bridge

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log

class BleManager(private val context: Context, private val listener: Listener) {

    interface Listener {
        fun onBleConnected(name: String)
        fun onBleDisconnected()
        fun onBleLog(msg: String)
    }

    private val adapter: BluetoothAdapter? =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
    private val handler = Handler(Looper.getMainLooper())

    private var gatt: BluetoothGatt? = null
    private var writeChar: BluetoothGattCharacteristic? = null
    private var connected = false
    private var writing = false
    private var currentPacket: ByteArray = Protocol.packetStop()
    private var patternMode = false

    private val keepalive = object : Runnable {
        override fun run() {
            if (connected) {
                if (!patternMode) writePacket(currentPacket)
                handler.postDelayed(this, Protocol.KEEPALIVE_MS)
            }
        }
    }

    val isConnected get() = connected

    fun scanAndConnect() {
        val scanner = adapter?.bluetoothLeScanner
        if (scanner == null) {
            listener.onBleLog("蓝牙未开启")
            return
        }
        listener.onBleLog("BLE扫描中…")

        val filters = listOf(
            ScanFilter.Builder().setDeviceName("SL278J").build(),
            ScanFilter.Builder().setDeviceName("SL278H").build()
        )
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                scanner.stopScan(this)
                val dev = result.device
                listener.onBleLog("找到 ${dev.name ?: dev.address}")
                connectDevice(dev)
            }

            override fun onScanFailed(errorCode: Int) {
                listener.onBleLog("扫描失败: $errorCode")
            }
        }

        scanner.startScan(filters, settings, cb)
        handler.postDelayed({ scanner.stopScan(cb) }, 10_000)
    }

    private fun connectDevice(device: BluetoothDevice) {
        listener.onBleLog("连接 ${device.name ?: device.address}…")
        gatt = device.connectGatt(context, false, gattCb)
    }

    private val gattCb = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    listener.onBleLog("GATT已连，发现服务…")
                    g.discoverServices()
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    connected = false
                    handler.removeCallbacks(keepalive)
                    listener.onBleDisconnected()
                    listener.onBleLog("BLE断开")
                }
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                listener.onBleLog("服务发现失败: $status")
                return
            }
            for (svc in g.services) {
                if (svc.uuid == Protocol.FORBIDDEN_SERVICE) continue
            }
            val svc = g.getService(Protocol.SERVICE_UUID)
            if (svc == null) {
                listener.onBleLog("找不到FFE0")
                return
            }
            writeChar = svc.getCharacteristic(Protocol.WRITE_UUID)
            if (writeChar == null) {
                listener.onBleLog("找不到FFE1")
                return
            }
            connected = true
            currentPacket = Protocol.packetStop()
            listener.onBleConnected(g.device?.name ?: g.device?.address ?: "?")
            listener.onBleLog("FFE1就绪")
            handler.post(keepalive)
        }

        override fun onCharacteristicWrite(
            g: BluetoothGatt,
            ch: BluetoothGattCharacteristic,
            status: Int
        ) {
            writing = false
        }
    }

    private fun writePacket(data: ByteArray) {
        val ch = writeChar ?: return
        if (!connected || writing) return
        if (ch.uuid == Protocol.FORBIDDEN_SERVICE) return
        writing = true
        ch.value = data
        ch.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        gatt?.writeCharacteristic(ch)
    }

    fun setIntensity(value: Int) {
        patternMode = false
        currentPacket = Protocol.packetIntensity(value)
        writePacket(currentPacket)
    }

    fun setPattern(mode: Int, level: Int) {
        patternMode = true
        currentPacket = Protocol.packetPattern(mode, level)
        writePacket(currentPacket)
    }

    fun stop() {
        patternMode = false
        currentPacket = Protocol.packetStop()
        writePacket(currentPacket)
    }

    fun disconnect() {
        stop()
        handler.removeCallbacks(keepalive)
        try {
            gatt?.disconnect()
            gatt?.close()
        } catch (_: Exception) {}
        gatt = null
        connected = false
    }
}
