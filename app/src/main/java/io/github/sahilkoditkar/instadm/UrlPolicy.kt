package io.github.sahilkoditkar.instadm

import java.net.URI

/**
 * Decides what may load in the app. Instagram is allowed only for DMs and
 * the pages needed to log in; everything else on Instagram (feed, Reels,
 * Explore, profiles, posts) is refused. Links to other sites open in the
 * phone's browser instead of inside the app.
 *
 * Pure Kotlin (java.net.URI, no Android types) so it is unit-tested.
 */
object UrlPolicy {

    const val INBOX = "https://www.instagram.com/direct/inbox/"

    enum class Decision {
        /** Load it in the app. */
        ALLOW,

        /** Instagram's home page (where login lands): show the inbox instead. */
        TO_INBOX,

        /** Instagram page outside DMs: refuse and tell the user. */
        BLOCK,

        /** Another website: open it in the phone's browser. */
        EXTERNAL,

        /** Not a web link (intent:, javascript:, ...): ignore it. */
        IGNORE,
    }

    private val INSTAGRAM_HOSTS = setOf("instagram.com", "www.instagram.com", "m.instagram.com")

    /** DMs, plus the pages Instagram needs for logging in and out. */
    private val ALLOWED_PATH_PREFIXES = listOf(
        "/direct/",
        "/accounts/login",
        "/accounts/onetap",
        "/accounts/logout",
        "/accounts/password/reset",
        "/accounts/two_factor",
        "/two_factor",
        "/challenge/",
        "/auth_platform/",
    )

    fun decide(url: String?): Decision {
        if (url.isNullOrBlank()) return Decision.IGNORE
        val uri = try {
            URI(url.trim())
        } catch (_: Exception) {
            return Decision.IGNORE
        }
        val scheme = uri.scheme?.lowercase()
        if (scheme != "https" && scheme != "http") return Decision.IGNORE
        val host = uri.host?.lowercase() ?: return Decision.IGNORE

        if (host !in INSTAGRAM_HOSTS) return Decision.EXTERNAL

        val path = uri.rawPath.orEmpty().ifEmpty { "/" }
        if (path == "/") return Decision.TO_INBOX
        val normalized = if (path.endsWith("/")) path else "$path/"
        val allowed = ALLOWED_PATH_PREFIXES.any { prefix ->
            if (prefix.endsWith("/")) normalized.startsWith(prefix) else path.startsWith(prefix)
        }
        return if (allowed) Decision.ALLOW else Decision.BLOCK
    }
}
