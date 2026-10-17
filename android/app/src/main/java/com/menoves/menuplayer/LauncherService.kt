package com.menoves.menuplayer

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.SystemClock
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent

/**
 * Fire OS 8 (Android 11) blocks apps from opening themselves at boot. The system starts enabled
 * accessibility services at boot, so this service opens the player as soon as it connects.
 *
 * It also keeps the stick on the player: apps can't block the Home button, so when the Fire TV
 * Home screen appears this service opens the Wi-Fi settings (if Home was pressed on the player)
 * or the player again (Back/Home from Wi-Fi settings, or anything else). It only checks which
 * app is in front; it reads nothing on screen.
 *
 * Enable once per device (persists across reboots):
 *   adb shell settings put secure enabled_accessibility_services com.menoves.menuplayer/.LauncherService
 *   adb shell settings put secure accessibility_enabled 1
 */
class LauncherService : AccessibilityService() {
    private var lastApp: String? = null
    private var lastRedirect = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        openPlayer()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        when (pkg) {
            in HOME_APPS -> {
                // The launcher can report several window changes in a row; act on the first only.
                val now = SystemClock.elapsedRealtime()
                if (now - lastRedirect < 2000) return
                lastRedirect = now
                if (lastApp == packageName && PlayerState.locked) openWifiSettings() else openPlayer()
            }
            packageName, SETTINGS_APP -> lastApp = pkg
        }
    }

    private fun openPlayer() {
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun openWifiSettings() {
        try {
            startActivity(Intent(Settings.ACTION_WIFI_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        } catch (_: Exception) {
            openPlayer()
        }
    }

    override fun onInterrupt() {}

    companion object {
        private val HOME_APPS = setOf("com.amazon.tv.launcher")
        private const val SETTINGS_APP = "com.amazon.tv.settings.v2"
    }
}
