/*
 * Injected into instagram.com by InstaDM.
 *
 * 1. Hides the Home, Explore and Reels buttons, and app-store / open-in-app links.
 * 2. Removes "Open the app" / "Use the app" banners and pop-ups.
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
    '[data-instadm-hidden] { display: none !important; }';

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
