package com.menoves.menuplayer

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent

/**
 * Fire OS 8 (Android 11) blocks apps from opening themselves at boot. The system starts enabled
 * accessibility services at boot, so this service opens the player as soon as it connects.
 * It reads nothing from the screen.
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

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}
}
