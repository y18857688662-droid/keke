package com.keke.bridge

import android.content.Context
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.view.KeyEvent

class ClassicBtManager(private val context: Context, private val listener: Listener) {

    interface Listener {
        fun onPaiPaiConnected(name: String)
        fun onPaiPaiDisconnected()
        fun onPaiPaiLog(msg: String)
        fun onPaiPaiButton(action: String)
    }

    private var session: MediaSession? = null
    var linkEnabled = false
        private set

    fun connect() {
        session = MediaSession(context, "PaiPaiSession").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onMediaButtonEvent(intent: android.content.Intent): Boolean {
                    val event = intent.getParcelableExtra<KeyEvent>(android.content.Intent.EXTRA_KEY_EVENT)
                        ?: return false
                    if (event.action != KeyEvent.ACTION_DOWN) return true
                    val key = when (event.keyCode) {
                        KeyEvent.KEYCODE_VOLUME_UP -> "volume_up"
                        KeyEvent.KEYCODE_VOLUME_DOWN -> "volume_down"
                        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "play_pause"
                        KeyEvent.KEYCODE_MEDIA_PLAY -> "play"
                        KeyEvent.KEYCODE_MEDIA_PAUSE -> "pause"
                        KeyEvent.KEYCODE_CAMERA -> "camera"
                        KeyEvent.KEYCODE_ENTER -> "enter"
                        KeyEvent.KEYCODE_HEADSETHOOK -> "headsethook"
                        else -> "key_${event.keyCode}"
                    }
                    listener.onPaiPaiLog("拍拍器按键: $key")
                    if (linkEnabled) {
                        listener.onPaiPaiButton(key)
                    }
                    return true
                }
            })
            setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS)
            val state = PlaybackState.Builder()
                .setState(PlaybackState.STATE_PLAYING, 0, 1f)
                .setActions(PlaybackState.ACTION_PLAY_PAUSE)
                .build()
            setPlaybackState(state)
            isActive = true
        }
        listener.onPaiPaiConnected("MediaSession")
        listener.onPaiPaiLog("拍拍器监听已启动（按键检测）")
    }

    fun setLinkEnabled(enabled: Boolean) {
        linkEnabled = enabled
        listener.onPaiPaiLog(if (enabled) "联动模式: 开" else "联动模式: 关")
    }

    fun handleKeyEvent(keyCode: Int, action: Int): Boolean {
        if (action != KeyEvent.ACTION_DOWN) return false
        val key = when (keyCode) {
            KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_VOLUME_DOWN,
            KeyEvent.KEYCODE_CAMERA, KeyEvent.KEYCODE_HEADSETHOOK -> {
                val name = when (keyCode) {
                    KeyEvent.KEYCODE_VOLUME_UP -> "volume_up"
                    KeyEvent.KEYCODE_VOLUME_DOWN -> "volume_down"
                    KeyEvent.KEYCODE_CAMERA -> "camera"
                    KeyEvent.KEYCODE_HEADSETHOOK -> "headsethook"
                    else -> return false
                }
                listener.onPaiPaiLog("按键: $name")
                if (linkEnabled) {
                    listener.onPaiPaiButton(name)
                    return true
                }
                return false
            }
            else -> return false
        }
    }

    fun disconnect() {
        session?.isActive = false
        session?.release()
        session = null
        listener.onPaiPaiDisconnected()
    }

    fun destroy() {
        disconnect()
    }
}
