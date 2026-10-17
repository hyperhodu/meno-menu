package com.menoves.menuplayer

import android.annotation.SuppressLint
import android.app.Activity
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

/** Full-screen WebView that runs the bundled player (assets/player). */
class MainActivity : Activity() {
    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Serve bundled files from a secure https origin so IndexedDB/localStorage behave normally.
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this).apply {
            setBackgroundColor(0xFF000000.toInt())
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW // server may be plain http on the LAN
                cacheMode = WebSettings.LOAD_DEFAULT
            }
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    loader.shouldInterceptRequest(request.url)
                // If the page ever crashes, reload it rather than showing an error page.
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
                    if (request.isForMainFrame) view.postDelayed({ load() }, 5000)
                }
            }
        }
        web.addJavascriptInterface(object {
            @android.webkit.JavascriptInterface
            fun setLocked(locked: Boolean) { PlayerState.locked = locked }
        }, "Native")
        setContentView(web)
        load()
        askOverlayPermissionOnce()
    }

    // Android 10+ only lets an app open itself at boot if it may "display over other apps".
    // Not every Fire OS build has this screen, so failures are ignored; the same permission
    // can be granted with: adb shell appops set com.menoves.menuplayer SYSTEM_ALERT_WINDOW allow
    private fun askOverlayPermissionOnce() {
        if (android.os.Build.VERSION.SDK_INT < 23 || android.provider.Settings.canDrawOverlays(this)) return
        val prefs = getSharedPreferences("menu", MODE_PRIVATE)
        if (prefs.getBoolean("asked_overlay", false)) return
        prefs.edit().putBoolean("asked_overlay", true).apply()
        try {
            startActivity(android.content.Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")))
        } catch (_: Exception) { }
    }

    private fun load() {
        val base = "https://appassets.androidplatform.net/assets/player/index.html"
        val server = BuildConfig.SERVER_URL
        web.loadUrl(if (server.isNotEmpty()) base + "?server=" + Uri.encode(server) else base)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
    }

    // While the player is showing content, ignore every remote button except volume (Home never reaches
    // apps; LauncherService handles it). The setup screen needs the remote to type the server address.
    override fun dispatchKeyEvent(event: KeyEvent): Boolean = when {
        event.keyCode in VOLUME_KEYS -> super.dispatchKeyEvent(event)
        PlayerState.locked -> true
        else -> super.dispatchKeyEvent(event)
    }

    override fun onResume() { super.onResume(); web.onResume() }
    override fun onPause() { web.onPause(); super.onPause() }

    private companion object {
        val VOLUME_KEYS = setOf(KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_VOLUME_DOWN, KeyEvent.KEYCODE_VOLUME_MUTE)
    }
}
