package com.keke.bridge

import android.Manifest
import android.app.Activity
import android.content.*
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.*

class MainActivity : Activity() {

    private lateinit var statusText: TextView
    private lateinit var logText: TextView
    private lateinit var btnStart: Button
    private lateinit var btnStop: Button
    private var running = false

    private val logReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            val msg = intent.getStringExtra("msg") ?: return
            runOnUiThread {
                val time = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault())
                    .format(java.util.Date())
                logText.text = "$time $msg\n${logText.text}".take(3000)

                if (msg.contains("已连接")) {
                    statusText.text = msg
                    statusText.setBackgroundColor(0xFF0D2818.toInt())
                    statusText.setTextColor(0xFF52B788.toInt())
                } else if (msg.contains("断开") || msg.contains("失败")) {
                    statusText.text = msg
                    statusText.setBackgroundColor(0xFF2A0A0A.toInt())
                    statusText.setTextColor(0xFFE07070.toInt())
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUI()
        checkPerms()
    }

    override fun onResume() {
        super.onResume()
        val filter = IntentFilter("com.keke.bridge.LOG")
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            registerReceiver(logReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(logReceiver, filter)
        }
    }

    override fun onPause() {
        super.onPause()
        unregisterReceiver(logReceiver)
    }

    private fun buildUI() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 80, 48, 48)
            setBackgroundColor(0xFF0A0A0A.toInt())
        }

        val title = TextView(this).apply {
            text = "克の桥"
            textSize = 22f
            setTextColor(0xFFAAAAAA.toInt())
            gravity = Gravity.CENTER
        }
        root.addView(title, lp().apply { bottomMargin = 32 })

        statusText = TextView(this).apply {
            text = "未启动"
            textSize = 16f
            setTextColor(0xFFAAAAAA.toInt())
            setBackgroundColor(0xFF1A1A1A.toInt())
            setPadding(32, 24, 32, 24)
            gravity = Gravity.CENTER
        }
        root.addView(statusText, lp().apply { bottomMargin = 24 })

        val btnRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }

        btnStart = Button(this).apply {
            text = "启动"
            setBackgroundColor(0xFF2D6A4F.toInt())
            setTextColor(0xFFFFFFFF.toInt())
            setPadding(48, 24, 48, 24)
            setOnClickListener { startBridge() }
        }
        btnRow.addView(btnStart, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { rightMargin = 16 })

        btnStop = Button(this).apply {
            text = "停止"
            setBackgroundColor(0xFF6A2D2D.toInt())
            setTextColor(0xFFFFFFFF.toInt())
            setPadding(48, 24, 48, 24)
            setOnClickListener { stopBridge() }
        }
        btnRow.addView(btnStop, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        root.addView(btnRow, lp().apply { bottomMargin = 24 })

        val linkRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val linkLabel = TextView(this).apply {
            text = "拍拍器联动"
            textSize = 14f
            setTextColor(0xFFAAAAAA.toInt())
        }
        linkRow.addView(linkLabel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        val linkSwitch = Switch(this).apply {
            isChecked = false
            setOnCheckedChangeListener { _, on ->
                val intent = Intent("com.keke.bridge.LINK")
                intent.putExtra("enabled", on)
                sendBroadcast(intent)
            }
        }
        linkRow.addView(linkSwitch)
        root.addView(linkRow, lp().apply { bottomMargin = 16 })

        val info = TextView(this).apply {
            text = "启动后可以关掉这个界面\n桥在后台保持连接\n\n联动开: 拍拍器按键控制玩具\n联动关: 拍拍器正常拍照"
            textSize = 12f
            setTextColor(0xFF666666.toInt())
            gravity = Gravity.CENTER
        }
        root.addView(info, lp().apply { bottomMargin = 24 })

        logText = TextView(this).apply {
            textSize = 11f
            setTextColor(0xFF888888.toInt())
            setBackgroundColor(0xFF111111.toInt())
            setPadding(24, 16, 24, 16)
            typeface = android.graphics.Typeface.MONOSPACE
        }
        val scroll = ScrollView(this).apply { addView(logText) }
        root.addView(scroll, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
        ))

        setContentView(root)
    }

    private fun lp() = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
    )

    private fun checkPerms() {
        val needed = mutableListOf<String>()
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
            needed.add(Manifest.permission.ACCESS_FINE_LOCATION)
        if (needed.isNotEmpty())
            requestPermissions(needed.toTypedArray(), 1)
    }

    private fun startBridge() {
        if (running) return
        running = true
        statusText.text = "启动中…"
        statusText.setBackgroundColor(0xFF1A1A1A.toInt())
        statusText.setTextColor(0xFFAAAAAA.toInt())
        val intent = Intent(this, BridgeService::class.java)
        startForegroundService(intent)
    }

    private fun stopBridge() {
        running = false
        statusText.text = "已停止"
        statusText.setBackgroundColor(0xFF1A1A1A.toInt())
        statusText.setTextColor(0xFFAAAAAA.toInt())
        stopService(Intent(this, BridgeService::class.java))
    }
}
