/*
 * Injected into instagram.com by InstaDM.
 *
 * 1. Hides the Home, Explore and Reels buttons, and app-store / open-in-app links.
 * 2. Removes "Open the app" / "Use the app" banners and pop-ups.
 * 3. Locks the full-screen reel viewer: a reel opened from a DM plays, but
 *    swiping up/down to the next reel does nothing.
 * 4. Small app-like polish: no grey tap flash, gentle fade when switching
 *    chats, pop-ups that ease in.
 *
 * Banner detection is deliberately cautious. It only acts on text that is
 * inside an element pinned to the screen (position fixed/sticky) or a dialog,
 * never on text inside chats: a pinned box that contains a text box (the
 * message composer) or a lot of text (a conversation) is never touched.
 * Pop-ups are closed with their own "Not now" / "Close" button when they have
 * one, so the page doesn't stay greyed out; otherwise they are hidden.
 *
 * Plain ES5 with no dependencies, so it runs on old WebViews too.
 */
(function () {
  'use strict';
  if (window.__instadm) return;
  window.__instadm = { hidden: 0, dismissed: 0 };

  var HIDE_CSS =
    'a[href="/"], a[href="/explore/"], a[href^="/explore/"],' +
    'a[href="/reels/"], a[href^="/reels/"],' +
    'a[href*="play.google.com/store"], a[href*="apps.apple.com"],' +
    'a[href^="intent:"], a[href^="instagram:"]' +
    '{ display: none !important; }' +
    '[data-instadm-hidden] { display: none !important; }' +
    // App-like polish. Only broad, layout-neutral rules (opacity, the
    // pop-up's own transform), so nothing moves or breaks if Instagram
    // restructures its page.
    '* { -webkit-tap-highlight-color: transparent; }' +
    '@keyframes instadm-fade { from { opacity: 0; } to { opacity: 1; } }' +
    '@keyframes instadm-pop { from { opacity: 0; transform: translateY(12px) scale(.98); }' +
    ' to { opacity: 1; transform: none; } }' +
    '.instadm-route-in { animation: instadm-fade .2s ease-out both; }' +
    '[role="dialog"] { animation: instadm-pop .2s cubic-bezier(.2,.8,.2,1) both; }' +
    '@media (prefers-reduced-motion: reduce) {' +
    ' .instadm-route-in, [role="dialog"] { animation: none !important; } }';

  // "Open app", "Use the app", "Get the Instagram app", "See this post in the app", ...
  var APP_TEXT = new RegExp(
    '\\b(open|use|get|download|install|switch to|continue (in|on)|' +
      '(see|view|watch) (this|more|it)( \\w+)? (in|on))' +
      ' (the )?(instagram )?app\\b|' +
      '\\bopen instagram\\b|' +
      '\\b(better|best|easier|more) (in|on) the (instagram )?app\\b',
    'i'
  );
  var DISMISS_TEXT = new RegExp(
    '^(not now|close|dismiss|no,? thanks|cancel|' +
      '(continue|stay) (in|on|with) (the )?(browser|web|website|mobile web)|' +
      'use (the )?(web|browser|website))$',
    'i'
  );
  var MAX_BOX_TEXT = 300; // more text than this = probably content, not a banner
  var MAX_MATCH_TEXT = 200;
  var MAX_CLIMB = 12;
  var handledDialogs = typeof WeakSet === 'function' ? new WeakSet() : null;

  function addStyle() {
    if (document.getElementById('instadm-style')) return;
    var root = document.head || document.documentElement;
    if (!root) return;
    var s = document.createElement('style');
    s.id = 'instadm-style';
    s.textContent = HIDE_CSS;
    root.appendChild(s);
  }

  function textOf(el) {
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isPinned(el) {
    if (el.getAttribute) {
      var role = el.getAttribute('role');
      if (role === 'dialog' || role === 'alertdialog' || el.getAttribute('aria-modal') === 'true') {
        return true;
      }
    }
    var pos = window.getComputedStyle(el).position;
    return pos === 'fixed' || pos === 'sticky';
  }

  function isDialog(el) {
    var role = el.getAttribute('role');
    return role === 'dialog' || role === 'alertdialog' || el.getAttribute('aria-modal') === 'true';
  }

  function hasTextInput(el) {
    return !!el.querySelector('textarea, input[type="text"], input:not([type]), [contenteditable="true"], [role="textbox"]');
  }

  function interactive(el) {
    return el.querySelectorAll('a, button, [role="button"], [role="link"]');
  }

  function isAppOrDismissControl(el) {
    var t = textOf(el);
    var label = el.getAttribute('aria-label') || '';
    return APP_TEXT.test(t) || DISMISS_TEXT.test(t) || DISMISS_TEXT.test(label) ||
      /^(close|dismiss)$/i.test(label) || t === '×' || t === '✕';
  }

  /** The control (button/link) containing node, if any, within the box. */
  function controlFor(node, box) {
    var el = node;
    while (el && el !== box) {
      if (el.matches && el.matches('a, button, [role="button"], [role="link"]')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function hide(el) {
    if (el.hasAttribute('data-instadm-hidden')) return;
    el.setAttribute('data-instadm-hidden', '');
    window.__instadm.hidden++;
  }

  function tryDismiss(box) {
    var controls = interactive(box);
    for (var i = 0; i < controls.length; i++) {
      var c = controls[i];
      var t = textOf(c);
      var label = c.getAttribute('aria-label') || '';
      if (DISMISS_TEXT.test(t) || DISMISS_TEXT.test(label) || /^(close|dismiss)$/i.test(label)) {
        c.click();
        window.__instadm.dismissed++;
        return true;
      }
    }
    return false;
  }

  /** Grow from the pinned box to wrappers that hold nothing else (e.g. a dimmed backdrop). */
  function outermostWrapper(box) {
    var boxText = textOf(box);
    var el = box;
    while (el.parentElement && el.parentElement !== document.body &&
           el.parentElement !== document.documentElement &&
           textOf(el.parentElement) === boxText && isPinned(el.parentElement)) {
      el = el.parentElement;
    }
    return el;
  }

  function handleMatch(textNode) {
    if (!textNode.isConnected) return; // removed by an earlier match in this scan
    var start = textNode.parentElement;
    if (!start || start.closest('[data-instadm-hidden]')) return;

    // Find the nearest pinned ancestor; text that isn't pinned is page content.
    var box = null;
    var el = start;
    for (var i = 0; el && i < MAX_CLIMB; i++, el = el.parentElement) {
      if (el === document.body || el === document.documentElement) break;
      if (isPinned(el)) { box = el; break; }
    }
    if (!box) return;
    if (hasTextInput(box)) return; // composer / conversation: never touch
    if (textOf(box).length > MAX_BOX_TEXT) return; // too much content to be a banner

    var control = controlFor(textNode.parentElement, box);
    var others = 0;
    var all = interactive(box);
    for (var j = 0; j < all.length; j++) {
      if (!isAppOrDismissControl(all[j])) others++;
    }

    if (isDialog(box) || box.querySelector('[role="dialog"], [aria-modal="true"]')) {
      if (handledDialogs) {
        if (handledDialogs.has(box)) return; // already clicked "Not now" once
        handledDialogs.add(box);
      }
      if (tryDismiss(box)) {
        // If the page didn't remove it, hide it ourselves.
        setTimeout(function () { if (box.isConnected) hide(outermostWrapper(box)); }, 400);
      } else {
        hide(outermostWrapper(box));
      }
      return;
    }
    if (others > 1 && control) {
      // A real header/toolbar that also has an "Open app" button: hide just the button.
      hide(control);
      return;
    }
    if (others > 1) return; // pinned bar with other controls but the text isn't a button: leave it
    hide(outermostWrapper(box));
  }

  function scan() {
    addStyle();
    var body = document.body;
    if (!body) return;
    var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
    var matches = [];
    var node;
    while ((node = walker.nextNode())) {
      var v = node.nodeValue;
      if (v && v.length <= MAX_MATCH_TEXT && APP_TEXT.test(v)) matches.push(node);
    }
    for (var i = 0; i < matches.length; i++) {
      try { handleMatch(matches[i]); } catch (e) { /* never break the page */ }
    }
  }

  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(function () { pending = false; scan(); }, 250);
  }

  // ---- Gentle fade when moving between the inbox and a chat ----------------
  // Instagram changes pages with history.pushState; fade the main area in
  // after each change. Opacity only: transforms would shift pinned elements.
  function fadeMain() {
    var main = document.querySelector('main, [role="main"]');
    if (!main) return;
    main.classList.remove('instadm-route-in');
    void main.offsetWidth; // restart the animation
    main.classList.add('instadm-route-in');
    setTimeout(function () { main.classList.remove('instadm-route-in'); }, 300);
  }
  var lastPath = location.pathname;
  function onRoute() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    setTimeout(fadeMain, 30); // let the new page render first
  }
  ['pushState', 'replaceState'].forEach(function (name) {
    var original = history[name];
    history[name] = function () {
      var result = original.apply(this, arguments);
      try { onRoute(); } catch (e) { /* never break navigation */ }
      return result;
    };
  });
  window.addEventListener('popstate', onRoute);

  // ---- Reel viewer: watch the one you opened, no scrolling to the next ----
  // The viewer opens on top of the chat without changing the address, so it
  // is recognised by what it is: a video filling most of the screen. While
  // one is on screen, vertical swipes are cancelled and any scroll that still
  // happens (e.g. scripted) is put back. Horizontal moves and taps (play,
  // pause, mute, the X) still work; close it with the X or Back.
  function fullScreenVideo() {
    var videos = document.getElementsByTagName('video');
    var vw = window.innerWidth, vh = window.innerHeight;
    for (var i = 0; i < videos.length; i++) {
      var r = videos[i].getBoundingClientRect();
      if (r.width >= vw * 0.8 && r.height >= vh * 0.6 &&
          r.top < vh / 2 && r.bottom > vh / 2) {
        return videos[i];
      }
    }
    return null;
  }

  function scrollersAround(el) {
    var list = [];
    for (var n = el.parentElement; n; n = n.parentElement) {
      var oy = window.getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) {
        list.push({ el: n, top: n.scrollTop });
      }
    }
    var doc = document.scrollingElement;
    if (doc) list.push({ el: doc, top: doc.scrollTop });
    return list;
  }

  var lock = null; // { x, y, scrollers } while a touch starts on a reel viewer
  var touchStart = null;

  document.addEventListener('touchstart', function (e) {
    var t = e.touches[0];
    touchStart = t ? { x: t.clientX, y: t.clientY } : null;
    var video = fullScreenVideo();
    lock = video ? { scrollers: scrollersAround(video) } : null;
  }, { capture: true, passive: true });

  function blockVerticalMove(e, x, y) {
    if (!lock || !touchStart) return;
    var dx = Math.abs(x - touchStart.x), dy = Math.abs(y - touchStart.y);
    if (dy > 8 && dy > dx) {
      if (e.cancelable) e.preventDefault();
      e.stopImmediatePropagation(); // keep Instagram's own swipe code from seeing it
      window.__instadm.reelSwipesBlocked = (window.__instadm.reelSwipesBlocked || 0) + 1;
    }
  }

  document.addEventListener('touchmove', function (e) {
    var t = e.touches[0];
    if (t) blockVerticalMove(e, t.clientX, t.clientY);
  }, { capture: true, passive: false });

  document.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') blockVerticalMove(e, e.clientX, e.clientY);
  }, { capture: true, passive: false });

  document.addEventListener('scroll', function (e) {
    if (!lock) return;
    if (!fullScreenVideo()) { lock = null; return; } // viewer closed
    var target = e.target === document ? document.scrollingElement : e.target;
    for (var i = 0; i < lock.scrollers.length; i++) {
      var s = lock.scrollers[i];
      if (s.el === target && Math.abs(s.el.scrollTop - s.top) > 1) {
        s.el.scrollTop = s.top;
      }
    }
  }, { capture: true, passive: true });

  document.addEventListener('wheel', function (e) {
    if (fullScreenVideo() && e.cancelable) e.preventDefault();
  }, { capture: true, passive: false });

  addStyle();
  function start() {
    scan();
    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
