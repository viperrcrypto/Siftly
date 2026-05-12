(async function () {
  if (!location.hostname.includes('twitter.com') && !location.hostname.includes('x.com')) {
    showToast('❌ Please navigate to x.com/i/bookmarks or x.com/username/likes first', '#ef4444'); return;
  }
  var isLikes = location.pathname.includes('/likes');
  var source = isLikes ? 'like' : 'bookmark';
  var label = isLikes ? 'likes' : 'bookmarks';
  function showToast(msg, bg) {
    var t = document.createElement('div'); t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '2147483647', padding: '10px 18px', background: bg || '#1e1b4b', color: '#fff',
      border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px',
      fontSize: '13px', fontWeight: '600', fontFamily: 'system-ui,sans-serif',
      boxShadow: '0 4px 20px rgba(0,0,0,0.6)', whiteSpace: 'nowrap', transition: 'opacity 0.3s'
    });
    document.body.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 300); }, 4000);
  }
  var all = [], seen = new Set();
  var btn = document.createElement('button');
  btn.textContent = 'Scroll, then Export 0 ' + label + ' →';
  Object.assign(btn.style, {
    position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647',
    padding: '10px 18px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '8px',
    cursor: 'pointer', fontSize: '14px', fontWeight: '700',
    boxShadow: '0 0 0 2px rgba(99,102,241,.4),0 4px 16px rgba(0,0,0,.4)',
    fontFamily: 'system-ui,sans-serif'
  });
  function addTweet(t) {
    if (!t || !t.rest_id || seen.has(t.rest_id)) return;
    seen.add(t.rest_id);
    var leg=t.legacy||{},usr=(t.core&&t.core.user_results&&t.core.user_results.result&&t.core.user_results.result.legacy)||{};
    var rawMedia = (leg.extended_entities && leg.extended_entities.media) || (leg.entities && leg.entities.media) || [];
    var media = rawMedia.map(function (m) {
      var thumb = m.media_url_https || '';
      if (m.type === 'video' || m.type === 'animated_gif') {
        var variants = m.video_info && m.video_info.variants || [];
        var mp4s = variants.filter(function (v) { return v.content_type === 'video/mp4' && v.url; }).sort(function (a, b) { return (b.bitrate || 0) - (a.bitrate || 0); });
        if (mp4s.length) return { type: m.type === 'animated_gif' ? 'gif' : 'video', url: mp4s[0].url };
        // No mp4 — degrade to photo so thumbnail shows correctly (actual video not available)
        if (thumb) return { type: 'photo', url: thumb };
        return null;
      }
      return thumb ? { type: 'photo', url: thumb } : null;
    }).filter(Boolean);
    all.push({id:t.rest_id,author:usr.name||'Unknown',handle:'@'+(usr.screen_name||'unknown'),
      avatar:usr.profile_image_url_https||'',timestamp:leg.created_at||'',
      text: leg.full_text || leg.text || '', media: media,
      hashtags: (leg.entities && leg.entities.hashtags || []).map(function (h) { return h.text; }),
      urls: (leg.entities && leg.entities.urls || []).map(function (u) { return u.expanded_url; }).filter(Boolean)
    });
    btn.textContent = 'Export ' + all.length + ' ' + label + ' →';
  }
  function isTweetObj(o) { return o && typeof o === 'object' && typeof o.rest_id === 'string' && o.rest_id.length > 5 && (o.legacy || o.core); }
  function unwrapTweet(t) {
    if (!t) return null;
    if (t.__typename === 'TweetWithVisibilityResults' || t.__typename === 'TweetWithVisibilityResult') return t.tweet || t;
    return t;
  }
  function deepFindTweets(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 12) return;
    if (Array.isArray(obj)) { obj.forEach(function (item) { deepFindTweets(item, depth + 1); }); return; }
    if (obj.tweet_results && obj.tweet_results.result) { var tw = unwrapTweet(obj.tweet_results.result); if (tw) addTweet(tw); }
    else if (isTweetObj(obj)) { addTweet(unwrapTweet(obj)); }
    for (var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k) && k !== 'quoted_status_result') { deepFindTweets(obj[k], depth + 1); } }
  }
  function processData(d) { deepFindTweets(d, 0); }
  var autoBtn = document.createElement('button');
  function doExport() {
    window.fetch = origFetch;
    XMLHttpRequest.prototype.open = origOpen;
    XMLHttpRequest.prototype.send = origSend;
    if (!all.length) { showToast('⚠️ No ' + label + ' captured — scroll or use Auto-scroll first!', '#92400e'); return; }
    [btn, autoBtn].forEach(function (el) { try { document.body.removeChild(el); } catch (e) { } });
    var blob = new Blob([JSON.stringify({ bookmarks: all, source: source }, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = source + 's.json'; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast('✅ Downloaded ' + all.length + ' ' + label + '! Upload to Siftly.', '#14532d');
  }
  btn.onclick = doExport;
  autoBtn.textContent = '▶ Auto-scroll';
  Object.assign(autoBtn.style, {
    position: 'fixed', top: '58px', right: '12px', zIndex: '2147483647',
    padding: '8px 14px', background: '#18181b', color: '#a1a1aa',
    border: '1px solid #3f3f46', borderRadius: '8px',
    cursor: 'pointer', fontSize: '12px', fontWeight: '600', fontFamily: 'system-ui,sans-serif'
  });
  var autoScrolling = false;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function runAutoScroll() {
    var stagnant = 0, lastCount = all.length;
    while (autoScrolling) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      var col = document.querySelector('[data-testid="primaryColumn"]');
      if (col) col.scrollTo(0, col.scrollHeight);
      await sleep(900);
      if (all.length > lastCount) { stagnant = 0; lastCount = all.length; }
      else {
        stagnant++;
        if (stagnant >= 8) {
          window.scrollTo(0, document.documentElement.scrollHeight);
          await sleep(2000);
          if (all.length === lastCount) {
            autoScrolling = false;
            autoBtn.textContent = '✅ Done — ' + all.length + ' captured';
            autoBtn.style.background = '#14532d'; autoBtn.style.color = '#86efac'; autoBtn.style.border = '1px solid #166534';
            showToast('✅ Auto-scroll complete! ' + all.length + ' ' + label + ' ready. Click Export.', '#14532d');
            return;
          }
          stagnant = 0;
        }
      }
    }
    autoBtn.textContent = '▶ Auto-scroll';
    autoBtn.style.background = '#18181b'; autoBtn.style.color = '#a1a1aa'; autoBtn.style.border = '1px solid #3f3f46';
  }
  autoBtn.onclick = function () {
    if (autoScrolling) { autoScrolling = false; return; }
    autoScrolling = true;
    autoBtn.textContent = '⏸ Stop';
    autoBtn.style.background = '#4f46e5'; autoBtn.style.color = '#fff'; autoBtn.style.border = 'none';
    runAutoScroll();
  };
  document.body.appendChild(btn);
  document.body.appendChild(autoBtn);
  function isApiUrl(u) { return u.includes('/graphql/') || u.includes('/i/api/') || u.includes('/2/timeline'); }
  var origFetch = window.fetch;
  window.fetch = async function () {
    var r = await origFetch.apply(this, arguments);
    try {
      var u = arguments[0] instanceof Request ? arguments[0].url : String(arguments[0]);
      if (isApiUrl(u)) { var ct = r.headers.get('content-type') || ''; if (ct.includes('json')) { var d = await r.clone().json(); processData(d); } }
    } catch (ex) { }
    return r;
  };
  var origOpen = XMLHttpRequest.prototype.open, origSend = XMLHttpRequest.prototype.send, xhrUrls = new WeakMap();
  XMLHttpRequest.prototype.open = function () { xhrUrls.set(this, String(arguments[1] || '')); return origOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this, u = xhrUrls.get(xhr) || '';
    if (isApiUrl(u)) { xhr.addEventListener('load', function () { try { processData(JSON.parse(xhr.responseText)); } catch (ex) { } }); }
    return origSend.apply(this, arguments);
  };
  showToast('✅ Active! Scroll your ' + label + ' — counter updates above.', '#1e1b4b');
})();