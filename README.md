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

The Home, Explore and Reels buttons are also hidden, so there's nothing to tap, and
"Open the app" / "Use the app" banners and pop-ups are removed (pop-ups are closed with
their own "Not now" button where they have one). That part is cosmetic, in
[`instadm-page.js`](app/src/main/assets/instadm-page.js); the pages themselves are
blocked even if Instagram changes its buttons. The banner remover only acts on boxes
pinned to the screen and never on anything containing the message box or a
conversation, so it can't hide your chats.

**Reels sent in DMs:** Instagram plays them in a viewer on top of the chat. You can watch
the one you opened, but swiping up or down to the next reel does nothing; close it with
the X or Back. (The viewer is recognised as a video filling most of the screen, so normal
chat scrolling, including chats with small videos in them, is untouched.)

**Polish:** no grey flash when you tap, a gentle fade when switching between the inbox and
a chat, pop-ups that ease in, and no white flash when the app opens in dark mode. Motion is
turned off if your phone's "Remove animations" setting is on.

## Permissions

Only **Internet**. No accessibility, notifications, contacts, storage, camera or microphone.
Your login stays in the app's own WebView cookies, on the phone.

## Limits

- **No message notifications.** WebViews can't receive Instagram's web push, so you see
  new messages when you open the app.
- You can play voice notes people send you, but not record them, and calls aren't
  supported (no microphone permission, on purpose).
- Reels sent in DMs play one at a time (see above). Links that would open Instagram's
  feed, profiles, posts or the Reels tab as their own page are blocked.
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

### Testing the page script

[`tools/page-script-test`](tools/page-script-test) loads a mock page with banners,
pop-ups, a DM header and chat messages that mention "the app", runs the script in
Chromium (Playwright) and checks that only the banners go. `reel-test.js` swipes a mock
reel viewer and a mock chat with real touch gestures and checks that only the viewer is
locked:

```bash
node tools/page-script-test/run.js
node tools/page-script-test/reel-test.js
```

### Performance profile

[`tools/perf/profile.js`](tools/perf/profile.js) runs an Instagram-shaped stress page
(~6,600 elements, live typing, incoming messages, inline videos, a reel viewer) in
Chromium with the CPU slowed 4x, once without and once with the page script, and reports
what the script adds: CPU time, long tasks, JS memory after garbage collection, and any
network requests (expected: none).

```bash
node tools/perf/profile.js --throttle 4 --seconds 30
```
