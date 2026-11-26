package io.github.sahilkoditkar.instadm

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * A WebView that only ever shows Instagram's DMs. [UrlPolicy] decides every
 * navigation; this class just enforces it at each point WebView exposes:
 * - link taps and server redirects  -> shouldOverrideUrlLoading
 * - in-page (single-page-app) route changes, which don't trigger a load
 *                                   -> doUpdateVisitedHistory
 * - anything that still starts loading -> onPageStarted (last line of defence)
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    /** Set after bouncing off a blocked page, so Back can't return to it. */
    private var clearHistoryWhenLoaded = false
    private var lastBlockToastAt = 0L

    /** The page fades in once, the first time it has something to show. */
    private var revealed = false

    /** Times of recent bounces, to stop a redirect loop instead of spinning forever. */
    private val recentBounces = ArrayDeque<Long>()

    private val pickFiles = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        fileCallback?.onReceiveValue(
            WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data),
        )
        fileCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this)
        webView = createWebView()
        root.addView(
            webView,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        setContentView(root)

        // Keep the page out from under the status and navigation bars
        // (apps targeting Android 15+ are drawn edge to edge).
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime(),
            )
            view.updatePadding(left = bars.left, top = bars.top, right = bars.right, bottom = bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(UrlPolicy.INBOX)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView = WebView(this).apply {
        // Match the app's light/dark background so there's no white flash,
        // and start invisible until the page has painted (see onPageCommitVisible).
        setBackgroundColor(ContextCompat.getColor(this@MainActivity, R.color.background))
        alpha = 0f
        settings.javaScriptEnabled = true // Instagram's site needs it.
        settings.domStorageEnabled = true
        settings.setSupportMultipleWindows(false) // target=_blank stays in this policy.
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        // Instagram refuses or nags in-app browsers; present as plain Chrome.
        settings.userAgentString = settings.userAgentString
            .replace("; wv)", ")")
            .replace(Regex("Version/\\d+(\\.\\d+)* "), "")

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

        installPageScript(this)
        webViewClient = PolicyClient()
        webChromeClient = Chrome()
    }

    /**
     * Injects assets/instadm-page.js into Instagram's pages: hides the Home,
     * Explore and Reels buttons and removes "Open the app" banners and
     * pop-ups. Cosmetic only: if Instagram changes its page, [UrlPolicy]
     * still blocks everything outside DMs.
     */
    private fun installPageScript(view: WebView) {
        val js = assets.open("instadm-page.js").bufferedReader().use { it.readText() }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            @Suppress("DEPRECATION") // still the supported API in androidx.webkit 1.8
            WebViewCompat.addDocumentStartJavaScript(
                view,
                js,
                setOf("https://www.instagram.com", "https://instagram.com", "https://m.instagram.com"),
            )
        } else {
            pendingFallbackJs = js
        }
    }

    /** Used on old WebViews without document-start scripts: injected after each load. */
    private var pendingFallbackJs: String? = null

    private inner class PolicyClient : WebViewClient() {

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame) return false // iframes (captcha etc.) are not navigation
            return when (UrlPolicy.decide(request.url.toString())) {
                UrlPolicy.Decision.ALLOW -> false
                UrlPolicy.Decision.TO_INBOX -> { view.loadUrl(UrlPolicy.INBOX); true }
                UrlPolicy.Decision.BLOCK -> { showBlocked(); true }
                UrlPolicy.Decision.EXTERNAL -> { openInBrowser(request.url); true }
                UrlPolicy.Decision.IGNORE -> true
            }
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            // Instagram is a single-page app: tapping Reels changes the URL
            // with history.pushState and never "loads" a page. Catch it here.
            when (UrlPolicy.decide(url)) {
                UrlPolicy.Decision.ALLOW -> Unit
                UrlPolicy.Decision.BLOCK -> { showBlocked(); bounceToInbox(view) }
                UrlPolicy.Decision.TO_INBOX, UrlPolicy.Decision.EXTERNAL,
                UrlPolicy.Decision.IGNORE -> if (url != "about:blank") bounceToInbox(view)
            }
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            when (UrlPolicy.decide(url)) {
                UrlPolicy.Decision.ALLOW -> Unit
                UrlPolicy.Decision.BLOCK -> { view.stopLoading(); showBlocked(); bounceToInbox(view) }
                else -> if (url != "about:blank") { view.stopLoading(); bounceToInbox(view) }
            }
        }

        override fun onPageCommitVisible(view: WebView, url: String?) {
            reveal(view)
        }

        override fun onPageFinished(view: WebView, url: String?) {
            reveal(view) // in case onPageCommitVisible didn't fire
            pendingFallbackJs?.let { view.evaluateJavascript(it, null) }
            if (clearHistoryWhenLoaded && UrlPolicy.decide(url) == UrlPolicy.Decision.ALLOW) {
                clearHistoryWhenLoaded = false
                view.clearHistory()
            }
            CookieManager.getInstance().flush()
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // The page's renderer crashed or was killed for memory. Start over
            // cleanly instead of letting the whole app crash.
            recreate()
            return true
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: FileChooserParams,
        ): Boolean {
            // Lets you attach photos to a DM, through the system picker.
            fileCallback?.onReceiveValue(null)
            fileCallback = filePathCallback
            return try {
                pickFiles.launch(fileChooserParams.createIntent())
                true
            } catch (_: ActivityNotFoundException) {
                fileCallback = null
                false
            }
        }
    }

    private fun reveal(view: WebView) {
        if (revealed) return
        revealed = true
        view.animate().alpha(1f).setDuration(220).start()
    }

    private fun bounceToInbox(view: WebView) {
        val now = System.currentTimeMillis()
        while (recentBounces.isNotEmpty() && now - recentBounces.first() > BOUNCE_WINDOW_MS) {
            recentBounces.removeFirst()
        }
        if (recentBounces.size >= MAX_BOUNCES) {
            // Instagram keeps sending us somewhere we won't go. Stop rather
            // than loop; the user can reopen the app to try again.
            view.stopLoading()
            Toast.makeText(this, R.string.redirect_loop, Toast.LENGTH_LONG).show()
            return
        }
        recentBounces.addLast(now)
        clearHistoryWhenLoaded = true
        view.loadUrl(UrlPolicy.INBOX)
    }

    private fun showBlocked() {
        val now = System.currentTimeMillis()
        if (now - lastBlockToastAt < 2_000) return
        lastBlockToastAt = now
        Toast.makeText(this, R.string.blocked_toast, Toast.LENGTH_SHORT).show()
    }

    private fun openInBrowser(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, R.string.no_browser, Toast.LENGTH_SHORT).show()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush() // keep you logged in
    }

    override fun onDestroy() {
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        webView.destroy()
        super.onDestroy()
    }

    private companion object {
        const val MAX_BOUNCES = 4
        const val BOUNCE_WINDOW_MS = 10_000L
    }
}
