# InstaDM

A tiny Android app that shows **only your Instagram DMs**. No feed, no Reels, no Explore.

It is Instagram's own website (`instagram.com/direct/`) inside a locked-down
WebView. Every page the site tries to open is checked first:

| Page | What happens |
|---|---|
| DMs (`/direct/...`) and login pages | Opens |
| Instagram's home page (where login lands) | Sent to your inbox |
| Anything else on Instagram: feed, Reels, Explore, posts, profiles, stories | Blocked, with a short message |
| Other websites (links people send you) | Open in your phone's browser |

The Home, Explore and Reels buttons are also hidden, so there's nothing to tap.
That part is cosmetic; the pages are blocked even if Instagram changes its buttons.

## Permissions

Only **Internet**. No accessibility, notifications, contacts, storage, camera or microphone.
Your login stays in the app's own WebView cookies, on the phone.

## Limits

- **No message notifications.** WebViews can't receive Instagram's web push, so you see
  new messages when you open the app.
- Voice notes and calls aren't supported (no microphone permission).
- A reel or post someone sends you is blocked when tapped, by design.
- Instagram may change its website at any time; if a DM page ever gets blocked by mistake,
  the rules are in one place: [`UrlPolicy.kt`](app/src/main/java/io/github/sahilkoditkar/instadm/UrlPolicy.kt).

## Build

Requires JDK 17+ and the Android SDK (platform 36).

```bash
./gradlew testReleaseUnitTest assembleRelease
```

To sign the release build, create `keystore.properties` at the repo root (git-ignored):

```properties
storeFile=/path/to/your.keystore
storePassword=...
keyAlias=...
keyPassword=...
```

The APK is written to `app/build/outputs/apk/release/app-release.apk`.
