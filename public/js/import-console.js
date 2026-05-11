(async function () {
  if (!location.hostname.includes('twitter.com') && !location.hostname.includes('x.com')) {
    alert('Run this on x.com/i/bookmarks or x.com/username/likes'); return;
  }
  const isLikes = location.pathname.includes('/likes');
  const source = isLikes ? 'like' : 'bookmark';
  const label = isLikes ? 'likes' : 'bookmarks';
  const all = [], seen = new Set();
  function addTweet(t) {
    if (!t?.rest_id || seen.has(t.rest_id)) return;
    seen.add(t.rest_id);
    const leg = t.legacy ?? {};
    const ur = t.core?.user_results?.result ?? {};
    const uc = ur.core ?? {};
    const ul = ur.legacy ?? {};
    const author = uc.name ?? ul.name ?? 'Unknown';
    const handleSn = uc.screen_name ?? ul.screen_name ?? 'unknown';
    const avatar = ur.avatar?.image_url ?? ul.profile_image_url_https ?? '';
    const media = (leg.extended_entities?.media ?? leg.entities?.media ?? []).map(m => {
      const thumb = m.media_url_https ?? '';
      if (m.type === 'video' || m.type === 'animated_gif') {
        const mp4s = (m.video_info?.variants ?? []).filter(v => v.content_type === 'video/mp4' && v.url)
          .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
        if (mp4s.length) return { type: m.type === 'animated_gif' ? 'gif' : 'video', url: mp4s[0].url };
        // No mp4 — degrade to photo so thumbnail shows correctly (actual video not available)
        return thumb ? { type: 'photo', url: thumb } : null;
      }
      return thumb ? { type: 'photo', url: thumb } : null;
    }).filter(Boolean);
    all.push({
      id: t.rest_id, author, handle: '@' + handleSn, avatar,
      timestamp: leg.created_at ?? '', text: leg.full_text ?? leg.text ?? '', media,
      hashtags: (leg.entities?.hashtags ?? []).map(h => h.text),
      urls: (leg.entities?.urls ?? []).map(u => u.expanded_url).filter(Boolean)
    });
    btn.textContent = `Export ${all.length} ${label} →`;
  }
  function isTweetObj(o) {
    if (!o || typeof o !== 'object' || typeof o.rest_id !== 'string' || o.rest_id.length <= 5) return false;
    const leg = o.legacy;
    return !!(leg && (typeof leg.full_text === 'string' || typeof leg.text === 'string'));
  }
  function unwrapTweet(t) {
    if (!t) return null;
    if (t.__typename === 'TweetWithVisibilityResults' || t.__typename === 'TweetWithVisibilityResult') return t.tweet ?? t;
    return t;
  }
  function deepFindTweets(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 12) return;
    if (Array.isArray(obj)) { obj.forEach(item => deepFindTweets(item, depth + 1)); return; }
    if (obj.tweet_results?.result) { const tw = unwrapTweet(obj.tweet_results.result); if (tw) addTweet(tw); }
    else if (isTweetObj(obj)) { addTweet(unwrapTweet(obj)); }
    for (const k of Object.keys(obj)) { if (k !== 'quoted_status_result') deepFindTweets(obj[k], depth + 1); }
  }
  function processData(d) { deepFindTweets(d, 0); }
  const btn = document.createElement('button');
  btn.textContent = 'Scroll then click to Export →';
  Object.assign(btn.style, {
    position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647',
    padding: '10px 18px', background: '#4f46e5', color: '#fff',
    border: 'none', borderRadius: '8px', cursor: 'pointer',
    fontSize: '14px', fontWeight: '700',
    boxShadow: '0 0 0 2px rgba(99,102,241,.4),0 4px 16px rgba(0,0,0,.4)',
    fontFamily: 'system-ui,sans-serif'
  });
  function doExport() {
    window.fetch = origFetch;
    XMLHttpRequest.prototype.open = origOpen;
    XMLHttpRequest.prototype.send = origSend;
    [btn, autoBtn].forEach(el => { try { document.body.removeChild(el); } catch (e) { } });
    if (!all.length) { alert(`No ${label} captured. Use Auto-scroll or scroll manually first.`); return; }
    const blob = new Blob([JSON.stringify({ bookmarks: all, source }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${source}s.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    console.log(`✅ Downloaded ${all.length} ${label}!`);
  }
  btn.onclick = doExport;
  const autoBtn = document.createElement('button');
  autoBtn.textContent = '▶ Auto-scroll';
  Object.assign(autoBtn.style, {
    position: 'fixed', top: '58px', right: '12px', zIndex: '2147483647',
    padding: '8px 14px', background: '#18181b', color: '#a1a1aa',
    border: '1px solid #3f3f46', borderRadius: '8px', cursor: 'pointer',
    fontSize: '12px', fontWeight: '600', fontFamily: 'system-ui,sans-serif'
  });
  let autoScrolling = false;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  async function runAutoScroll() {
    let stagnant = 0, lastCount = all.length;
    while (autoScrolling) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      const col = document.querySelector('[data-testid="primaryColumn"]');
      col?.scrollTo(0, col.scrollHeight);
      await sleep(900);
      if (all.length > lastCount) { stagnant = 0; lastCount = all.length; }
      else {
        stagnant++;
        if (stagnant >= 8) {
          window.scrollTo(0, document.documentElement.scrollHeight);
          await sleep(2000);
          if (all.length === lastCount) {
            autoScrolling = false;
            autoBtn.textContent = `✅ Done — ${all.length} captured`;
            autoBtn.style.cssText += ';background:#14532d;color:#86efac;border:1px solid #166534';
            console.log(`✅ Auto-scroll complete! ${all.length} ${label} ready. Click Export.`);
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
  const isApiUrl = (u) => u.includes('/graphql/') || u.includes('/i/api/') || u.includes('/2/timeline');
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const r = await origFetch.apply(this, args);
    try {
      const u = args[0] instanceof Request ? args[0].url : String(args[0]);
      if (isApiUrl(u)) { const ct = r.headers.get('content-type') ?? ''; if (ct.includes('json')) { const d = await r.clone().json(); processData(d); } }
    } catch (e) { }
    return r;
  };
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const xhrUrls = new WeakMap();
  XMLHttpRequest.prototype.open = function (...args) {
    xhrUrls.set(this, String(args[1] ?? ''));
    return origOpen.apply(this, args);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const xhr = this, u = xhrUrls.get(xhr) ?? '';
    if (isApiUrl(u)) {
      xhr.addEventListener('load', function () {
        try { processData(JSON.parse(xhr.responseText)); } catch (e) { }
      });
    }
    return origSend.apply(this, args);
  };
  console.log(`✅ Script active. Scroll through your ${label}, then click the purple button.`);
})();