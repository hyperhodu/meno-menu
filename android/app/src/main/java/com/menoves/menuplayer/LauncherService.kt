package com.menoves.menuplayer

import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/**
 * 1) Fire OS 8 (Android 11) blocks apps from opening themselves at boot. The system starts enabled
 *    accessibility services at boot, so this service opens the player as soon as it connects.
 * 2) While the player is on screen, the Home button opens the network settings instead of leaving,
 *    so store staff can fix Wi-Fi but cannot wander into other apps.
 * It never reads the screen. It only sees key presses so it can handle Home.
 *
 * Enable once per device (persists across reboots):
 *   adb shell settings put secure enabled_accessibility_services com.menoves.menuplayer/.LauncherService
 *   adb shell settings put secure accessibility_enabled 1
 */
class LauncherService : AccessibilityService() {
    override fun onServiceConnected() {
        super.onServiceConnected()
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    override fun onKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode != KeyEvent.KEYCODE_HOME || !PlayerState.inForeground || !PlayerState.locked) return false
        if (event.action == KeyEvent.ACTION_UP) openNetworkSettings()
        return true // swallow both down and up so the system never goes to the Amazon home screen
    }

    private fun openNetworkSettings() {
        val attempts = listOf(
            Intent(Settings.ACTION_WIFI_SETTINGS),
            Intent().setComponent(ComponentName("com.amazon.tv.settings.v2", "com.amazon.tv.settings.v2.tv.network.NetworkActivity")),
            Intent(Settings.ACTION_SETTINGS),
        )
        for (i in attempts) {
            try { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return } catch (_: Exception) { }
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}
}
