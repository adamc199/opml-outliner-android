package fm.curry.outliner

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.WindowInsets
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

/**
 * OPML Outliner for Android. Adam, 2026-10-20: "make an android version of the opml outliner app and have it
 * connect to the recently opened files on godcaster as well as local".
 * The editor is CurryCaster II's renderer/outliner.js (copied into assets by build.sh) in a WebView; this
 * activity only hosts it and gives it files through [Bridge]: godcaster's recent outlines via outliner-sync
 * (tailnet), and the phone's own files through the Android file picker.
 */
class MainActivity : Activity() {
    lateinit var web: WebView
    lateinit var bridge: Bridge

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.settings.textZoom = 100
        bridge = Bridge(this)
        // the page is served from https://appassets.androidplatform.net/assets/ (WebView refuses ES modules from file://)
        val assets = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        web.addJavascriptInterface(bridge, "Android")
        web.webViewClient = object : WebViewClient() {
            // links in an outline open in the browser, never inside the app
            override fun shouldInterceptRequest(v: WebView, r: WebResourceRequest): WebResourceResponse? = assets.shouldInterceptRequest(r.url)
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                val u = r.url
                if (u.host == WebViewAssetLoader.DEFAULT_DOMAIN) return false
                if (u.scheme == "https" || u.scheme == "http") runCatching { startActivity(Intent(Intent.ACTION_VIEW, u)) }
                return true
            }
            override fun onPageFinished(view: WebView, url: String) { handleIntent(intent) }
        }
        // Keep the page clear of the status bar, the home/switcher buttons and the keyboard (1.0.1: Adam, "the
        // toolbar is too low, it is under the android buttons"). Android 15 draws apps edge to edge and a WebView
        // ignores its own padding, so the padding goes on a frame around it.
        val frame = android.widget.FrameLayout(this)
        frame.setBackgroundColor(0xFFEFE7DC.toInt())
        frame.addView(web, android.widget.FrameLayout.LayoutParams(-1, -1))
        frame.setOnApplyWindowInsetsListener { v, ins ->
            val bars = ins.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            val ime = ins.getInsets(WindowInsets.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsets.CONSUMED
        }
        setContentView(frame)
        web.loadUrl("https://${WebViewAssetLoader.DEFAULT_DOMAIN}/assets/index.html")
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); handleIntent(intent) }

    private fun handleIntent(i: Intent?) {
        val u = i?.data ?: return
        if (i.action == Intent.ACTION_VIEW && u.scheme == "content") bridge.openFromIntent(u)
    }

    /** Back: close a dialog / the file list first; the page decides. */
    @Deprecated("system back")
    override fun onBackPressed() {
        web.evaluateJavascript("window.__back && window.__back()") { r -> if (r != "true") finish() }
    }

    /** Leaving the app saves (a phone app can be killed at any time). */
    override fun onPause() {
        super.onPause()
        web.evaluateJavascript("window.__saveNow && window.__saveNow()", null)
    }

    @Deprecated("activity result")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        bridge.onActivityResult(requestCode, resultCode, data)
    }

    fun js(code: String) = runOnUiThread { web.evaluateJavascript(code, null) }
    fun openUrl(u: String) = runOnUiThread { runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u))) } }
}
