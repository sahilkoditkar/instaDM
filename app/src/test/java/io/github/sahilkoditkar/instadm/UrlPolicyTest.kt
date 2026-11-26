package io.github.sahilkoditkar.instadm

import io.github.sahilkoditkar.instadm.UrlPolicy.Decision
import org.junit.Assert.assertEquals
import org.junit.Test

class UrlPolicyTest {

    private fun assertDecision(expected: Decision, url: String?) =
        assertEquals("for $url", expected, UrlPolicy.decide(url))

    @Test
    fun dmPagesAreAllowed() {
        assertDecision(Decision.ALLOW, UrlPolicy.INBOX)
        assertDecision(Decision.ALLOW, "https://www.instagram.com/direct/inbox")
        assertDecision(Decision.ALLOW, "https://www.instagram.com/direct/t/1234567890/")
        assertDecision(Decision.ALLOW, "https://www.instagram.com/direct/requests/")
        assertDecision(Decision.ALLOW, "https://instagram.com/direct/inbox/?next=1")
    }

    @Test
    fun loginPagesAreAllowed() {
        assertDecision(Decision.ALLOW, "https://www.instagram.com/accounts/login/")
        assertDecision(Decision.ALLOW, "https://www.instagram.com/accounts/login/?next=%2Fdirect%2Finbox%2F")
        assertDecision(Decision.ALLOW, "https://www.instagram.com/accounts/onetap/?next=%2F")
        assertDecision(Decision.ALLOW, "https://www.instagram.com/accounts/login/two_factor?next=%2F")
        assertDecision(Decision.ALLOW, "https://www.instagram.com/challenge/abc/")
        assertDecision(Decision.ALLOW, "https://www.instagram.com/accounts/password/reset/")
    }

    @Test
    fun homePageGoesToInbox() {
        assertDecision(Decision.TO_INBOX, "https://www.instagram.com/")
        assertDecision(Decision.TO_INBOX, "https://www.instagram.com")
        assertDecision(Decision.TO_INBOX, "https://www.instagram.com/?hl=en")
    }

    @Test
    fun distractingPagesAreBlocked() {
        assertDecision(Decision.BLOCK, "https://www.instagram.com/reels/")
        assertDecision(Decision.BLOCK, "https://www.instagram.com/reels/C1abcDEF/")
        assertDecision(Decision.BLOCK, "https://www.instagram.com/reel/C1abcDEF/")
        assertDecision(Decision.BLOCK, "https://www.instagram.com/explore/")
        assertDecision(Decision.BLOCK, "https://www.instagram.com/explore/tags/cats/")
        assertDecision(Decision.BLOCK, "https://www.instagram.com/p/C1abcDEF/")
        assertDecision(Decision.BLOCK, "https://www.instagram.com/stories/someone/123/")
        assertDecision(Decision.BLOCK, "https://www.instagram.com/someone/")
        assertDecision(Decision.BLOCK, "https://www.instagram.com/accounts/activity/")
    }

    @Test
    fun lookalikePathsAreNotAllowed() {
        // "/direct" must be a whole path segment, not a prefix of another word.
        assertDecision(Decision.BLOCK, "https://www.instagram.com/directory/")
        assertDecision(Decision.BLOCK, "https://www.instagram.com/directors_cut/")
        assertDecision(Decision.ALLOW, "https://www.instagram.com/direct")
    }

    @Test
    fun otherSitesOpenInBrowser() {
        assertDecision(Decision.EXTERNAL, "https://l.instagram.com/?u=https%3A%2F%2Fexample.com")
        assertDecision(Decision.EXTERNAL, "https://example.com/")
        assertDecision(Decision.EXTERNAL, "https://www.facebook.com/")
        // A host that merely ends in instagram.com is not Instagram.
        assertDecision(Decision.EXTERNAL, "https://evilinstagram.com/direct/inbox/")
        assertDecision(Decision.EXTERNAL, "https://www.instagram.com.evil.example/direct/inbox/")
    }

    @Test
    fun nonWebLinksAreIgnored() {
        assertDecision(Decision.IGNORE, null)
        assertDecision(Decision.IGNORE, "")
        assertDecision(Decision.IGNORE, "intent://scan/#Intent;scheme=instagram;end")
        assertDecision(Decision.IGNORE, "javascript:alert(1)")
        assertDecision(Decision.IGNORE, "instagram://reels")
        assertDecision(Decision.IGNORE, "about:blank")
        assertDecision(Decision.IGNORE, "not a url at all")
    }
}
