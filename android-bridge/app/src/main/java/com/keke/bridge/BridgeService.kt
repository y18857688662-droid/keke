package com.keke.bridge

import android.app.*
import android.content.*
import android.os.*
import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

class BridgeService : Service(), BleManager.Listener, ClassicBtManager.Listener, IrManager.Listener {

    companion object {
        const val TAG = "BridgeService"
        const val CHANNEL_ID = "bridge_channel"
        const val NOTIF_ID = 1
        const val ACTION_STOP = "com.keke.bridge.STOP"
    }

    private lateinit var ble: BleManager
    private lateinit var paipai: ClassicBtManager
    private lateinit var irMgr: IrManager
    private val bgThread = HandlerThread("bridge-bg").also { it.start() }
    private val bgHandler = Handler(bgThread.looper)
    private val mainHandler = Handler(Looper.getMainLooper())

    private var lastTs = 0L
    private var lastCommandTime = 0L
    private var polling = false

    private val linkReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            val enabled = intent.getBooleanExtra("enabled", false)
            setLinkMode(enabled)
        }
    }

    override fun onCreate() {
        super.onCreate()
        createChannel()
        ble = BleManager(this, this)
        paipai = ClassicBtManager(this, this)
        irMgr = IrManager(this, this)
        registerReceiver(linkReceiver, IntentFilter("com.keke.bridge.LINK"))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        startForeground(NOTIF_ID, buildNotification("启动中…"))
        ble.scanAndConnect()
        paipai.connect()
        return START_STICKY
    }

    override fun onDestroy() {
        polling = false
        try { unregisterReceiver(linkReceiver) } catch (_: Exception) {}
        ble.disconnect()
        paipai.destroy()
        reportStatus(false)
        bgThread.quitSafely()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── BLE callbacks ──
    override fun onBleConnected(name: String) {
        updateNotification("已连接 $name")
        reportStatus(true)
        startPolling()
        broadcastLog("BLE已连接 $name")
    }

    override fun onBleDisconnected() {
        updateNotification("BLE断开，10秒后重连…")
        reportStatus(false)
        polling = false
        broadcastLog("BLE断开")
        mainHandler.postDelayed({ ble.scanAndConnect() }, 10_000)
    }

    override fun onBleLog(msg: String) {
        broadcastLog(msg)
    }

    // ── 拍拍器 callbacks ──
    private var toyOn = false
    private var currentIntensity = 0

    override fun onPaiPaiConnected(name: String) {
        broadcastLog("拍拍器已连接 $name")
    }

    override fun onPaiPaiDisconnected() {
        broadcastLog("拍拍器断开")
    }

    override fun onPaiPaiLog(msg: String) {
        broadcastLog(msg)
    }

    override fun onPaiPaiButton(action: String) {
        if (!ble.isConnected) {
            broadcastLog("联动: 玩具未连接")
            return
        }
        when (action) {
            "volume_up", "camera", "enter", "headsethook", "play_pause", "play" -> {
                if (!toyOn) {
                    currentIntensity = 30
                    ble.setIntensity(currentIntensity)
                    toyOn = true
                    broadcastLog("联动: 开 强度$currentIntensity")
                } else {
                    currentIntensity = (currentIntensity + 20).coerceAtMost(Protocol.INTENSITY_SOFT_CAP)
                    ble.setIntensity(currentIntensity)
                    broadcastLog("联动: 加到$currentIntensity")
                }
            }
            "volume_down", "pause" -> {
                if (toyOn) {
                    currentIntensity = (currentIntensity - 20).coerceAtLeast(0)
                    if (currentIntensity == 0) {
                        ble.stop()
                        toyOn = false
                        broadcastLog("联动: 停")
                    } else {
                        ble.setIntensity(currentIntensity)
                        broadcastLog("联动: 减到$currentIntensity")
                    }
                }
            }
        }
    }

    fun setLinkMode(enabled: Boolean) {
        paipai.setLinkEnabled(enabled)
    }

    // ── 红外 callbacks ──
    override fun onIrLog(msg: String) {
        broadcastLog(msg)
    }

    // ── 轮询服务器 ──
    private fun startPolling() {
        if (polling) return
        polling = true
        lastCommandTime = System.currentTimeMillis()
        bgHandler.post(pollRunnable)
    }

    private val pollRunnable = object : Runnable {
        override fun run() {
            if (!polling) return
            try {
                if (System.currentTimeMillis() - lastCommandTime > Protocol.DEADMAN_MS) {
                    ble.stop()
                    broadcastLog("deadman: 15分钟无指令，安全停机")
                    polling = false
                    return
                }

                val conn = URL("${Protocol.SERVER_URL}/bridge/poll").openConnection() as HttpURLConnection
                conn.connectTimeout = 5000
                conn.readTimeout = 5000
                val body = BufferedReader(InputStreamReader(conn.inputStream)).readText()
                conn.disconnect()

                val json = JSONObject(body)
                val ts = json.optLong("ts", 0)
                if (ts > lastTs && json.has("cmd") && !json.isNull("cmd")) {
                    lastTs = ts
                    lastCommandTime = System.currentTimeMillis()
                    val cmd = json.getJSONObject("cmd")
                    when (cmd.optString("type")) {
                        "stop" -> {
                            ble.stop()
                            broadcastLog("收到: 停止")
                        }
                        "intensity" -> {
                            val v = cmd.optInt("value", 0)
                            ble.setIntensity(v)
                            broadcastLog("收到: 强度 $v")
                        }
                        "pattern" -> {
                            val m = cmd.optInt("mode", 1)
                            val l = cmd.optInt("level", 1)
                            ble.setPattern(m, l)
                            broadcastLog("收到: 花样 M${m} L${l}")
                        }
                        "ir" -> {
                            val mode = cmd.optInt("mode", -1)
                            if (mode == -1) irMgr.sendAll() else irMgr.send(mode)
                            broadcastLog("收到: 红外拍拍")
                        }
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "poll error: ${e.message}")
            }
            if (polling) bgHandler.postDelayed(this, Protocol.POLL_MS)
        }
    }

    private fun reportStatus(connected: Boolean) {
        bgHandler.post {
            try {
                val conn = URL("${Protocol.SERVER_URL}/bridge/status").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.outputStream.write("{\"connected\":$connected}".toByteArray())
                conn.outputStream.flush()
                conn.inputStream.read()
                conn.disconnect()
            } catch (_: Exception) {}
        }
    }

    // ── 通知 ──
    private fun createChannel() {
        val ch = NotificationChannel(CHANNEL_ID, "蓝牙桥", NotificationManager.IMPORTANCE_LOW)
        ch.description = "桥后台运行状态"
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
    }

    private fun buildNotification(text: String): Notification {
        val stopIntent = Intent(this, BridgeService::class.java).apply { action = ACTION_STOP }
        val stopPi = PendingIntent.getService(this, 0, stopIntent, PendingIntent.FLAG_IMMUTABLE)
        val openIntent = Intent(this, MainActivity::class.java)
        val openPi = PendingIntent.getActivity(this, 0, openIntent, PendingIntent.FLAG_IMMUTABLE)

        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("克の桥")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(openPi)
            .addAction(Notification.Action.Builder(null, "停止", stopPi).build())
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(text: String) {
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIF_ID, buildNotification(text))
    }

    private fun broadcastLog(msg: String) {
        val intent = Intent("com.keke.bridge.LOG")
        intent.putExtra("msg", msg)
        sendBroadcast(intent)
    }
}
