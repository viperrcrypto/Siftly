'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { Upload, CheckCircle, ChevronRight, Loader2, Copy, Check, ExternalLink, Sparkles, Eye, Tag, Brain, Layers, StopCircle, RefreshCw, Clock, KeyRound, Trash2, XCircle } from 'lucide-react'
import * as Progress from '@radix-ui/react-progress'

type Step = 1 | 2 | 3
type Method = 'bookmarklet' | 'console' | 'live'

interface ImportResult {
  imported: number
  skipped: number
  total: number
}

type Stage = 'vision' | 'entities' | 'enrichment' | 'categorize' | 'parallel' | null

interface StageCounts {
  visionTagged: number
  entitiesExtracted: number
  enriched: number
  categorized: number
}

interface CategorizeStatus {
  status: 'idle' | 'running' | 'stopping'
  stage: Stage
  done: number
  total: number
  stageCounts: StageCounts
  lastError: string | null
  error: string | null
}

const STAGE_INFO: Record<NonNullable<Stage>, { label: string; icon: React.ReactNode; desc: string }> = {
  vision: {
    label: 'Analyzing images',
    icon: <Eye size={14} />,
    desc: 'Extracting text, objects, and context from photos, GIFs, and videos',
  },
  entities: {
    label: 'Extracting entities',
    icon: <Tag size={14} />,
    desc: 'Mining hashtags, URLs, and tool mentions from tweet data',
  },
  enrichment: {
    label: 'Generating semantic tags',
    icon: <Brain size={14} />,
    desc: 'Creating 30-50 searchable tags per bookmark for AI search',
  },
  categorize: {
    label: 'Categorizing',
    icon: <Layers size={14} />,
    desc: 'Assigning each bookmark to the most relevant categories',
  },
  parallel: {
    label: 'Processing all stages in parallel',
    icon: <Sparkles size={14} />,
    desc: 'Vision, enrichment, and categorization running concurrently across 20 workers',
  },
}

// ── Bookmarklet script (captures Twitter/X bookmark API responses as you scroll) ──

const BOOKMARKLET_SCRIPT = `(async function(){
  if(!location.hostname.includes('twitter.com')&&!location.hostname.includes('x.com')){
    showToast('\u274c Please navigate to x.com/i/bookmarks or x.com/username/likes first','#ef4444');return;
  }
  var isLikes=location.pathname.includes('/likes');
  var source=isLikes?'like':'bookmark';
  var label=isLikes?'likes':'bookmarks';
  function showToast(msg,bg){
    var t=document.createElement('div');t.textContent=msg;
    Object.assign(t.style,{position:'fixed',bottom:'24px',left:'50%',transform:'translateX(-50%)',
      zIndex:'2147483647',padding:'10px 18px',background:bg||'#1e1b4b',color:'#fff',
      border:'1px solid rgba(255,255,255,0.15)',borderRadius:'8px',
      fontSize:'13px',fontWeight:'600',fontFamily:'system-ui,sans-serif',
      boxShadow:'0 4px 20px rgba(0,0,0,0.6)',whiteSpace:'nowrap',transition:'opacity 0.3s'});
    document.body.appendChild(t);
    setTimeout(function(){t.style.opacity='0';setTimeout(function(){t.remove();},300);},4000);
  }
  var all=[],seen=new Set();
  var btn=document.createElement('button');
  btn.textContent='Scroll, then Export 0 '+label+' \u2192';
  Object.assign(btn.style,{position:'fixed',top:'12px',right:'12px',zIndex:'2147483647',
    padding:'10px 18px',background:'#4f46e5',color:'#fff',border:'none',borderRadius:'8px',
    cursor:'pointer',fontSize:'14px',fontWeight:'700',
    boxShadow:'0 0 0 2px rgba(99,102,241,.4),0 4px 16px rgba(0,0,0,.4)',
    fontFamily:'system-ui,sans-serif'});
  function addTweet(t){
    if(!t||!t.rest_id||seen.has(t.rest_id))return;
    seen.add(t.rest_id);
    var leg=t.legacy||{},usr=(t.core&&t.core.user_results&&t.core.user_results.result&&t.core.user_results.result.legacy)||{};
    var rawMedia=(leg.extended_entities&&leg.extended_entities.media)||(leg.entities&&leg.entities.media)||[];
    var media=rawMedia.map(function(m){
      var thumb=m.media_url_https||'';
      if(m.type==='video'||m.type==='animated_gif'){
        var variants=m.video_info&&m.video_info.variants||[];
        var mp4s=variants.filter(function(v){return v.content_type==='video/mp4'&&v.url;}).sort(function(a,b){return(b.bitrate||0)-(a.bitrate||0);});
        if(mp4s.length)return{type:m.type==='animated_gif'?'gif':'video',url:mp4s[0].url};
        // No mp4 — degrade to photo so thumbnail shows correctly (actual video not available)
        if(thumb)return{type:'photo',url:thumb};
        return null;
      }
      return thumb?{type:'photo',url:thumb}:null;
    }).filter(Boolean);
    all.push({id:t.rest_id,author:usr.name||'Unknown',handle:'@'+(usr.screen_name||'unknown'),
      avatar:usr.profile_image_url_https||'',timestamp:leg.created_at||'',
      text:leg.full_text||leg.text||'',media:media,
      hashtags:(leg.entities&&leg.entities.hashtags||[]).map(function(h){return h.text;}),
      urls:(leg.entities&&leg.entities.urls||[]).map(function(u){return u.expanded_url;}).filter(Boolean)});
    btn.textContent='Export '+all.length+' '+label+' \u2192';
  }
  function processEntry(e){
    if(!e)return;
    var ic=e.content&&(e.content.itemContent||(e.content.item&&e.content.item.itemContent));
    if(ic&&ic.tweet_results){
      var t=ic.tweet_results.result;
      if(t){if(t.__typename==='TweetWithVisibilityResults'||t.__typename==='TweetWithVisibilityResult')t=t.tweet||t;addTweet(t);}
    }
    if(e.content&&e.content.items)e.content.items.forEach(function(i){processEntry({content:i.item||i});});
  }
  function findInstructions(obj,depth){
    if(!obj||typeof obj!=='object'||depth>6)return null;
    if(Array.isArray(obj))return null;
    if(Array.isArray(obj.instructions))return obj.instructions;
    for(var k in obj){if(Object.prototype.hasOwnProperty.call(obj,k)){var r=findInstructions(obj[k],depth+1);if(r)return r;}}
    return null;
  }
  function processData(d){
    var instr=findInstructions(d,0)||[];
    instr.forEach(function(i){(i.entries||[]).forEach(processEntry);(i.moduleItems||[]).forEach(processEntry);});
  }
  var autoBtn=document.createElement('button');
  function doExport(){
    window.fetch=origFetch;
    XMLHttpRequest.prototype.open=origOpen;
    XMLHttpRequest.prototype.send=origSend;
    if(!all.length){showToast('\u26a0\ufe0f No '+label+' captured \u2014 scroll or use Auto-scroll first!','#92400e');return;}
    [btn,autoBtn].forEach(function(el){try{document.body.removeChild(el);}catch(e){}});
    var blob=new Blob([JSON.stringify({bookmarks:all,source:source},null,2)],{type:'application/json'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');a.href=url;a.download=source+'s.json';a.click();
    setTimeout(function(){URL.revokeObjectURL(url);},1000);
    showToast('\u2705 Downloaded '+all.length+' '+label+'! Upload to Siftly.','#14532d');
  }
  btn.onclick=doExport;
  autoBtn.textContent='\u25b6 Auto-scroll';
  Object.assign(autoBtn.style,{position:'fixed',top:'58px',right:'12px',zIndex:'2147483647',
    padding:'8px 14px',background:'#18181b',color:'#a1a1aa',
    border:'1px solid #3f3f46',borderRadius:'8px',
    cursor:'pointer',fontSize:'12px',fontWeight:'600',fontFamily:'system-ui,sans-serif'});
  var autoScrolling=false;
  function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
  async function runAutoScroll(){
    var stagnant=0,lastCount=all.length;
    while(autoScrolling){
      window.scrollTo(0,document.documentElement.scrollHeight);
      var col=document.querySelector('[data-testid="primaryColumn"]');
      if(col)col.scrollTo(0,col.scrollHeight);
      await sleep(900);
      if(all.length>lastCount){stagnant=0;lastCount=all.length;}
      else{
        stagnant++;
        if(stagnant>=8){
          window.scrollTo(0,document.documentElement.scrollHeight);
          await sleep(2000);
          if(all.length===lastCount){
            autoScrolling=false;
            autoBtn.textContent='\u2705 Done \u2014 '+all.length+' captured';
            autoBtn.style.background='#14532d';autoBtn.style.color='#86efac';autoBtn.style.border='1px solid #166534';
            showToast('\u2705 Auto-scroll complete! '+all.length+' '+label+' ready. Click Export.','#14532d');
            return;
          }
          stagnant=0;
        }
      }
    }
    autoBtn.textContent='\u25b6 Auto-scroll';
    autoBtn.style.background='#18181b';autoBtn.style.color='#a1a1aa';autoBtn.style.border='1px solid #3f3f46';
  }
  autoBtn.onclick=function(){
    if(autoScrolling){autoScrolling=false;return;}
    autoScrolling=true;
    autoBtn.textContent='\u23f8 Stop';
    autoBtn.style.background='#4f46e5';autoBtn.style.color='#fff';autoBtn.style.border='none';
    runAutoScroll();
  };
  document.body.appendChild(btn);
  document.body.appendChild(autoBtn);
  var origFetch=window.fetch;
  window.fetch=async function(){
    var r=await origFetch.apply(this,arguments);
    try{
      var u=arguments[0] instanceof Request?arguments[0].url:String(arguments[0]);
      if(u.includes('/graphql/')){var d=await r.clone().json();processData(d);}
    }catch(ex){}
    return r;
  };
  var origOpen=XMLHttpRequest.prototype.open,origSend=XMLHttpRequest.prototype.send,xhrUrls=new WeakMap();
  XMLHttpRequest.prototype.open=function(){xhrUrls.set(this,String(arguments[1]||''));return origOpen.apply(this,arguments);};
  XMLHttpRequest.prototype.send=function(){
    var xhr=this,u=xhrUrls.get(xhr)||'';
    if(u.includes('/graphql/')){xhr.addEventListener('load',function(){try{processData(JSON.parse(xhr.responseText));}catch(ex){}});}
    return origSend.apply(this,arguments);
  };
  showToast('\u2705 Active! Scroll your '+label+' \u2014 counter updates above.','#1e1b4b');
})();`

const BOOKMARKLET_HREF = `javascript:${encodeURIComponent(BOOKMARKLET_SCRIPT)}`

const CONSOLE_SCRIPT = `(async function() {
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
    const leg = t.legacy ?? {}, usr = t.core?.user_results?.result?.legacy ?? {};
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
      id: t.rest_id, author: usr.name ?? 'Unknown', handle: '@' + (usr.screen_name ?? 'unknown'),
      timestamp: leg.created_at ?? '', text: leg.full_text ?? leg.text ?? '', media,
      hashtags: (leg.entities?.hashtags ?? []).map(h => h.text),
      urls: (leg.entities?.urls ?? []).map(u => u.expanded_url).filter(Boolean)
    });
    btn.textContent = \`Export \${all.length} \${label} →\`;
  }
  function processEntry(e) {
    if (!e) return;
    const ic = e.content?.itemContent ?? e.content?.item?.itemContent;
    if (ic?.tweet_results) {
      let t = ic.tweet_results.result;
      if (t) {
        if (t.__typename === 'TweetWithVisibilityResults' || t.__typename === 'TweetWithVisibilityResult') t = t.tweet ?? t;
        addTweet(t);
      }
    }
    if (e.content?.items) e.content.items.forEach(i => processEntry({ content: i.item ?? i }));
  }
  function findInstructions(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 6) return null;
    if (Array.isArray(obj)) return null;
    if (Array.isArray(obj.instructions)) return obj.instructions;
    for (const k of Object.keys(obj)) { const r = findInstructions(obj[k], depth + 1); if (r) return r; }
    return null;
  }
  function processData(d) {
    const instr = findInstructions(d) ?? [];
    instr.forEach(i => {
      (i.entries ?? []).forEach(processEntry);
      (i.moduleItems ?? []).forEach(processEntry);
    });
  }
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
    [btn, autoBtn].forEach(el => { try { document.body.removeChild(el); } catch(e) {} });
    if (!all.length) { alert(\`No \${label} captured. Use Auto-scroll or scroll manually first.\`); return; }
    const blob = new Blob([JSON.stringify({ bookmarks: all, source }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = \`\${source}s.json\`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    console.log(\`✅ Downloaded \${all.length} \${label}!\`);
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
            autoBtn.textContent = \`✅ Done — \${all.length} captured\`;
            autoBtn.style.cssText += ';background:#14532d;color:#86efac;border:1px solid #166534';
            console.log(\`✅ Auto-scroll complete! \${all.length} \${label} ready. Click Export.\`);
            return;
          }
          stagnant = 0;
        }
      }
    }
    autoBtn.textContent = '▶ Auto-scroll';
    autoBtn.style.background = '#18181b'; autoBtn.style.color = '#a1a1aa'; autoBtn.style.border = '1px solid #3f3f46';
  }
  autoBtn.onclick = function() {
    if (autoScrolling) { autoScrolling = false; return; }
    autoScrolling = true;
    autoBtn.textContent = '⏸ Stop';
    autoBtn.style.background = '#4f46e5'; autoBtn.style.color = '#fff'; autoBtn.style.border = 'none';
    runAutoScroll();
  };
  document.body.appendChild(btn);
  document.body.appendChild(autoBtn);
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const r = await origFetch.apply(this, args);
    try {
      const u = args[0] instanceof Request ? args[0].url : String(args[0]);
      if (u.includes('/graphql/')) {
        const d = await r.clone().json();
        processData(d);
      }
    } catch(e) {}
    return r;
  };
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const xhrUrls = new WeakMap();
  XMLHttpRequest.prototype.open = function(...args) {
    xhrUrls.set(this, String(args[1] ?? ''));
    return origOpen.apply(this, args);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    const xhr = this, u = xhrUrls.get(xhr) ?? '';
    if (u.includes('/graphql/')) {
      xhr.addEventListener('load', function() {
        try { processData(JSON.parse(xhr.responseText)); } catch(e) {}
      });
    }
    return origSend.apply(this, args);
  };
  console.log(\`✅ Script active. Scroll through your \${label}, then click the purple button.\`);
})();`

// ── Draggable bookmarklet link ────────────────────────────────────────────────
// React blocks javascript: URLs set via JSX href as a security precaution.
// We bypass this by setting the href attribute imperatively after mount so the
// drag-to-bookmark-bar flow still works correctly in all browsers.

function DraggableBookmarklet() {
  const linkRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    // Set href imperatively — bypasses React's javascript: URL XSS guard
    linkRef.current?.setAttribute('href', BOOKMARKLET_HREF)
  }, [])

  return (
    <a
      ref={linkRef}
      draggable
      onClick={(e) => e.preventDefault()}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-grab active:cursor-grabbing select-none transition-colors"
      title="Drag this to your bookmarks bar — do not click"
    >
      📥 Export X Bookmarks
    </a>
  )
}

// ── Components ────────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const steps = ['Upload', 'Importing', 'Categorize']
  return (
    <div className="flex items-center gap-2 mb-8">
      {steps.map((label, i) => {
        const num = (i + 1) as Step
        const isActive = num === current
        const isDone = num < current
        return (
          <div key={label} className="flex items-center gap-2">
            <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-all ${
              isDone ? 'bg-emerald-500 text-white' : isActive ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-500'
            }`}>
              {isDone ? <CheckCircle size={14} /> : num}
            </div>
            <span className={`text-sm ${isActive ? 'text-zinc-100' : 'text-zinc-500'}`}>{label}</span>
            {i < steps.length - 1 && <ChevronRight size={14} className="text-zinc-700 ml-1" />}
          </div>
        )
      })}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
    >
      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

function UploadZone({ onFile }: { onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith('.json')) onFile(file)
  }, [onFile])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onFile(file)
  }, [onFile])

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
        dragging ? 'border-indigo-500 bg-indigo-500/5' : 'border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800/30'
      }`}
    >
      <Upload size={28} className="mx-auto mb-3 text-zinc-500" />
      <p className="text-zinc-300 font-medium text-sm">Drop your JSON file here</p>
      <p className="text-zinc-600 text-xs mt-1">or click to browse</p>
      <input ref={inputRef} type="file" accept=".json" className="hidden" onChange={handleFileChange} />
    </div>
  )
}

function BookmarkletTab({ onFile, importSource }: { onFile: (file: File) => void; importSource: 'bookmark' | 'like' }) {
  const targetUrl = importSource === 'like' ? 'https://x.com' : 'https://x.com/i/bookmarks'
  const targetLabel = importSource === 'like' ? 'x.com/YourUsername/likes' : 'x.com/i/bookmarks'
  const sourceLabel = importSource === 'like' ? 'likes' : 'bookmarks'
  const steps = [
    {
      num: 1,
      title: 'Add the bookmarklet to your bookmark bar',
      content: (
        <div className="mt-2 space-y-3">
          <p className="text-xs text-zinc-500">
            Show your bookmark bar first: <strong className="text-zinc-300">View → Show Bookmarks Bar</strong>
          </p>
          {/* Option A: Drag */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-800/60 border border-zinc-700/50">
            <div className="shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-bold">A</div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-zinc-300 mb-1.5">Drag to bookmark bar</p>
              <DraggableBookmarklet />
            </div>
          </div>
          {/* Option B: Manual (more reliable in Chrome) */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-zinc-800/60 border border-zinc-700/50">
            <div className="shrink-0 w-6 h-6 rounded-full bg-zinc-600/40 text-zinc-400 flex items-center justify-center text-xs font-bold mt-0.5">B</div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-zinc-300 mb-1.5">Manual (works in all browsers)</p>
              <ol className="text-xs text-zinc-500 space-y-0.5 mb-2">
                <li>1. Copy the URL below</li>
                <li>2. Right-click bookmark bar → <strong className="text-zinc-400">Add bookmark / New bookmark</strong></li>
                <li>3. Name it <em className="text-zinc-400">Export X Bookmarks</em> and paste the URL</li>
              </ol>
              <CopyButton text={BOOKMARKLET_HREF} />
            </div>
          </div>
        </div>
      ),
    },
    {
      num: 2,
      title: (
        <span>
          Go to{' '}
          <a
            href={targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 hover:underline inline-flex items-center gap-1"
          >
            {targetLabel} <ExternalLink size={11} />
          </a>{' '}
          while logged in
        </span>
      ),
    },
    {
      num: 3,
      title: `Click "Export X Bookmarks" in your bookmark bar`,
      content: (
        <p className="text-xs text-zinc-500 mt-1">
          A purple Export button will appear on the page
        </p>
      ),
    },
    {
      num: 4,
      title: 'Click "▶ Auto-scroll" to capture all bookmarks automatically',
      content: (
        <p className="text-xs text-zinc-500 mt-1">
          A second button appears below the export button. Click it and it will scroll through all your bookmarks automatically — stopping when done. Or scroll manually if you prefer.
        </p>
      ),
    },
    {
      num: 5,
      title: `Click the purple "Export N ${sourceLabel}" button`,
      content: (
        <p className="text-xs text-zinc-500 mt-1">
          A <code className="text-xs bg-zinc-800 px-1 py-0.5 rounded">{sourceLabel}.json</code> file will download automatically.
          Upload it below.
        </p>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <ol className="space-y-4">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-xs font-bold text-indigo-400 mt-0.5">
              {step.num}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-zinc-300 leading-relaxed">{step.title}</p>
              {step.content}
            </div>
          </li>
        ))}
      </ol>

      <div className="border-t border-zinc-800 pt-5">
        <p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider font-medium">Upload the downloaded file</p>
        <UploadZone onFile={onFile} />
      </div>
    </div>
  )
}

function ConsoleTab({ onFile, importSource }: { onFile: (file: File) => void; importSource: 'bookmark' | 'like' }) {
  const targetUrl = importSource === 'like' ? 'https://x.com' : 'https://x.com/i/bookmarks'
  const targetLabel = importSource === 'like' ? 'x.com/YourUsername/likes' : 'x.com/i/bookmarks'
  const sourceLabel = importSource === 'like' ? 'likes' : 'bookmarks'
  const steps = [
    {
      num: 1,
      title: (
        <span>
          Go to{' '}
          <a
            href={targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 hover:underline inline-flex items-center gap-1"
          >
            {targetLabel} <ExternalLink size={11} />
          </a>{' '}
          while logged in
        </span>
      ),
    },
    {
      num: 2,
      title: 'Open browser DevTools and go to the Console tab',
      content: (
        <p className="text-xs text-zinc-500 mt-1">
          Press <kbd className="text-xs bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 rounded font-mono">F12</kbd> on Windows/Linux or{' '}
          <kbd className="text-xs bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 rounded font-mono">⌘⌥J</kbd> on Mac,
          then click the <strong className="text-zinc-300">Console</strong> tab
        </p>
      ),
    },
    {
      num: 3,
      title: 'Paste and run the script below',
      content: (
        <div className="mt-2">
          <div className="relative rounded-xl overflow-hidden border border-zinc-700 bg-zinc-950">
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
              <span className="text-xs text-zinc-600 font-mono">console script</span>
              <CopyButton text={CONSOLE_SCRIPT} />
            </div>
            <pre className="text-xs text-zinc-400 p-3 overflow-auto max-h-40 font-mono leading-relaxed">
              {CONSOLE_SCRIPT.slice(0, 300)}...
            </pre>
          </div>
        </div>
      ),
    },
    {
      num: 4,
      title: `Press Enter, then scroll through all your ${sourceLabel}`,
      content: (
        <p className="text-xs text-zinc-500 mt-1">
          A purple button will appear. Scroll slowly to capture all {sourceLabel}, then click the button to download.
        </p>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <ol className="space-y-4">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-zinc-700 border border-zinc-600 flex items-center justify-center text-xs font-bold text-zinc-400 mt-0.5">
              {step.num}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-zinc-300 leading-relaxed">{step.title}</p>
              {step.content}
            </div>
          </li>
        ))}
      </ol>

      <div className="border-t border-zinc-800 pt-5">
        <p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider font-medium">Upload the downloaded file</p>
        <UploadZone onFile={onFile} />
      </div>
    </div>
  )
}

// ── Live Import Tab ───────────────────────────────────────────────────────────

interface LiveConfig {
  hasCredentials: boolean
  syncInterval: string
  lastSync: string | null
  schedulerRunning: boolean
}

const INTERVAL_LABELS: Record<string, string> = {
  off: 'Off',
  '1h': 'Every hour',
  '4h': 'Every 4 hours',
  '8h': 'Every 8 hours',
  '24h': 'Every 24 hours',
}

function LiveImportTab({ onSynced }: { onSynced: (result: ImportResult) => void }) {
  const [authToken, setAuthToken] = useState('')
  const [ct0, setCt0] = useState('')
  const [config, setConfig] = useState<LiveConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [interval, setInterval_] = useState('off')
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/import/live')
      .then(async (r) => {
        if (!r.ok) {
          setError('Failed to load sync configuration')
          return
        }
        const data: LiveConfig = await r.json()
        setConfig(data)
        setInterval_(data.syncInterval)
      })
      .catch(() => {
        setError('Could not connect to the server')
      })
  }, [])

  async function handleSaveCredentials() {
    if (!authToken.trim() || !ct0.trim()) {
      setError('Both auth_token and ct0 are required')
      return
    }
    setError('')
    setSaving(true)
    try {
      const res = await fetch('/api/import/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authToken: authToken.trim(), ct0: ct0.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Failed to save')
      }
      setConfig((c) => c
        ? { ...c, hasCredentials: true }
        : { hasCredentials: true, syncInterval: 'off', lastSync: null, schedulerRunning: false },
      )
      setAuthToken('')
      setCt0('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteCredentials() {
    try {
      const res = await fetch('/api/import/live', { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to remove credentials')
      setConfig((c) => c ? { ...c, hasCredentials: false, lastSync: null, schedulerRunning: false, syncInterval: 'off' } : c)
      setInterval_('off')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove credentials')
    }
  }

  async function handleSync() {
    setError('')
    setSyncing(true)
    try {
      const res = await fetch('/api/import/live/sync', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Sync failed')
      const imported = data.imported ?? 0
      const skipped = data.skipped ?? 0
      onSynced({ imported, skipped, total: imported + skipped })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  async function handleIntervalChange(newInterval: string) {
    const previousInterval = interval
    setInterval_(newInterval)
    try {
      const res = await fetch('/api/import/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncInterval: newInterval }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Failed to update sync schedule')
      }
      setConfig((c) => c ? { ...c, syncInterval: newInterval, schedulerRunning: newInterval !== 'off' } : c)
    } catch (err) {
      setInterval_(previousInterval)
      setError(err instanceof Error ? err.message : 'Failed to update sync schedule')
    }
  }

  return (
    <div className="space-y-6">
      {/* How to get credentials */}
      <div className="space-y-3">
        <p className="text-sm text-zinc-300 font-medium flex items-center gap-2">
          <KeyRound size={14} className="text-indigo-400" />
          X Session Cookies
        </p>
        <div className="text-xs text-zinc-500 space-y-1.5 pl-5">
          <p>1. Open <a href="https://x.com" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">x.com</a> and log in</p>
          <p>2. Open DevTools (<kbd className="bg-zinc-800 border border-zinc-700 px-1 py-0.5 rounded font-mono">F12</kbd>) &rarr; <strong className="text-zinc-400">Application</strong> tab &rarr; <strong className="text-zinc-400">Cookies</strong></p>
          <p>3. Copy <code className="bg-zinc-800 px-1 py-0.5 rounded">auth_token</code> and <code className="bg-zinc-800 px-1 py-0.5 rounded">ct0</code></p>
        </div>
      </div>

      {/* Credential status + input */}
      {config?.hasCredentials ? (
        <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-emerald-500/8 border border-emerald-500/20">
          <div className="flex items-center gap-2.5">
            <CheckCircle size={15} className="text-emerald-400 shrink-0" />
            <span className="text-sm text-emerald-300">Credentials saved</span>
            {config.lastSync && (
              <span className="text-xs text-zinc-500">
                &middot; Last sync: {new Date(config.lastSync).toLocaleString()}
              </span>
            )}
          </div>
          <button
            onClick={handleDeleteCredentials}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Remove credentials"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <input
              type="password"
              placeholder="auth_token"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 font-mono"
            />
            <input
              type="password"
              placeholder="ct0"
              value={ct0}
              onChange={(e) => setCt0(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 font-mono"
            />
          </div>
          <button
            onClick={handleSaveCredentials}
            disabled={saving || !authToken.trim() || !ct0.trim()}
            className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            {saving ? 'Saving...' : 'Save Credentials'}
          </button>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Sync button */}
      {config?.hasCredentials && (
        <>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-medium transition-colors flex items-center justify-center gap-2"
          >
            {syncing ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Syncing bookmarks...
              </>
            ) : (
              <>
                <RefreshCw size={16} />
                Sync Now
              </>
            )}
          </button>

          {/* Auto-sync schedule */}
          <div className="border-t border-zinc-800 pt-5">
            <p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider font-medium flex items-center gap-1.5">
              <Clock size={12} />
              Auto-Sync Schedule
            </p>
            <div className="grid grid-cols-5 gap-1.5">
              {Object.entries(INTERVAL_LABELS).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => handleIntervalChange(value)}
                  className={`px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                    interval === value
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {interval !== 'off' && (
              <p className="text-xs text-zinc-600 mt-2">
                Siftly will automatically sync new bookmarks from X {INTERVAL_LABELS[interval]?.toLowerCase()}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function InstructionsStep({ onFile, importSource, onLiveSynced }: { onFile: (file: File) => void; importSource: 'bookmark' | 'like'; onLiveSynced: (result: ImportResult) => void }) {
  const [method, setMethod] = useState<Method>('bookmarklet')

  return (
    <div>
      {/* Method tabs */}
      <div className="flex gap-1 mb-6 p-1 bg-zinc-800 rounded-xl">
        <button
          onClick={() => setMethod('live')}
          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
            method === 'live'
              ? 'bg-zinc-900 text-zinc-100 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <RefreshCw size={13} className="inline -mt-0.5 mr-1" />
          Live Import
          <span className="ml-1.5 text-xs text-indigo-400 font-normal">Recommended</span>
        </button>
        <button
          onClick={() => setMethod('bookmarklet')}
          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
            method === 'bookmarklet'
              ? 'bg-zinc-900 text-zinc-100 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Bookmarklet
        </button>
        <button
          onClick={() => setMethod('console')}
          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
            method === 'console'
              ? 'bg-zinc-900 text-zinc-100 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {'</>'} Console
        </button>
      </div>

      {method === 'live' ? (
        <LiveImportTab onSynced={onLiveSynced} />
      ) : method === 'bookmarklet' ? (
        <BookmarkletTab onFile={onFile} importSource={importSource} />
      ) : (
        <ConsoleTab onFile={onFile} importSource={importSource} />
      )}
    </div>
  )
}

function ImportingStep({ result }: {
  result: ImportResult | null
}) {
  if (!result) {
    return (
      <div className="flex flex-col items-center gap-4 py-10">
        <Loader2 size={40} className="text-indigo-400 animate-spin" />
        <p className="text-zinc-300 text-lg font-medium">Importing bookmarks...</p>
        <p className="text-zinc-500 text-sm">This may take a moment</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-6 py-8">
      <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
        <CheckCircle size={32} className="text-emerald-400" />
      </div>
      <div className="text-center">
        <p className="text-xl font-bold text-zinc-100">Import Complete</p>
        <p className="text-zinc-400 mt-1">
          <span className="text-emerald-400 font-semibold">{result.imported}</span> imported,{' '}
          <span className="text-zinc-500">{result.skipped} skipped</span> as duplicates
        </p>
      </div>
      <div className="flex items-center gap-2 text-indigo-400 text-sm">
        <Loader2 size={14} className="animate-spin" />
        Starting AI categorization…
      </div>
    </div>
  )
}

function CategorizeStep({ importedCount, force = false }: { importedCount: number; force?: boolean }) {
  const [status, setStatus] = useState<CategorizeStatus | null>(null)
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clean up poll interval on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  // On mount: attach to running pipeline, or start one if new bookmarks were imported.
  // importedCount: -1 = direct trigger (not from import), 0 = all skipped, >0 = new bookmarks
  useEffect(() => {
    // All skipped — nothing to categorize
    if (importedCount === 0) return

    void (async () => {
      try {
        const res = await fetch('/api/categorize')
        const data = await res.json() as CategorizeStatus
        if (data.status === 'running' || data.status === 'stopping') {
          // Pipeline already in progress — attach to it
          setStatus(data)
          setRunning(true)
          setStopping(data.status === 'stopping')
          pollStatus()
        } else {
          // Start a fresh pipeline for the newly imported bookmarks
          void startCategorization(force)
        }
      } catch {
        void startCategorization(force)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function stopCategorization() {
    setStopping(true)
    try {
      const res = await fetch('/api/categorize', { method: 'DELETE' })
      if (!res.ok) throw new Error('Server returned ' + res.status)
    } catch {
      setStopping(false)
      setError('Failed to stop pipeline — try again')
    }
  }

  async function startCategorization(force = false) {
    setError('')
    setRunning(true)
    setStopping(false)
    setDone(false)
    try {
      const res = await fetch('/api/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(force ? { force: true } : {}),
      })
      if (!res.ok && res.status !== 409) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Failed to start categorization')
      }
      pollStatus()
    } catch (err) {
      setError(`Failed to start: ${err instanceof Error ? err.message : String(err)}`)
      setRunning(false)
    }
  }

  function pollStatus() {
    if (pollRef.current) clearInterval(pollRef.current)
    let pollFailures = 0
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/categorize')
        const data = await res.json() as CategorizeStatus
        pollFailures = 0
        setStatus(data)
        if (data.status === 'stopping') setStopping(true)
        if (data.status === 'idle') {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          setDone(true)
          setRunning(false)
          setStopping(false)
        }
      } catch {
        pollFailures++
        if (pollFailures >= 5) {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          setRunning(false)
          setError('Lost connection to the server. The pipeline may still be running — refresh to check.')
        }
      }
    }, 1000)
  }

  const progress = status ? Math.round((status.done / Math.max(status.total, 1)) * 100) : 0
  const currentStageInfo = status?.stage ? STAGE_INFO[status.stage] : null

  return (
    <div className="space-y-6">
      {!running && !done && error && (
        <div className="space-y-3">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={() => void startCategorization()}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
          >
            Retry Categorization
          </button>
        </div>
      )}

      {running && (
        <div className="space-y-4">
          {/* Current stage */}
          {currentStageInfo && (
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-indigo-500/8 border border-indigo-500/20">
              <div className="text-indigo-400 mt-0.5 shrink-0">{currentStageInfo.icon}</div>
              <div>
                <p className="text-zinc-200 text-sm font-medium">{currentStageInfo.label}</p>
                <p className="text-zinc-500 text-xs mt-0.5">{currentStageInfo.desc}</p>
              </div>
              <Loader2 size={14} className="text-indigo-400 animate-spin shrink-0 ml-auto mt-0.5" />
            </div>
          )}

          {/* Stage counters */}
          {status?.stageCounts && (
            <div className="space-y-1.5">
              {([
                { key: 'visionTagged', label: 'images analyzed', icon: <Eye size={13} />, active: status.stage === 'vision' || status.stage === 'parallel' },
                { key: 'entitiesExtracted', label: 'entities extracted', icon: <Tag size={13} />, active: status.stage === 'entities' },
                { key: 'enriched', label: 'bookmarks enriched', icon: <Brain size={13} />, active: status.stage === 'enrichment' || status.stage === 'parallel' },
                { key: 'categorized', label: 'categorized', icon: <Layers size={13} />, active: status.stage === 'categorize' || status.stage === 'parallel' },
              ] as { key: keyof StageCounts; label: string; icon: React.ReactNode; active: boolean }[]).map(({ key, label, icon, active }) => {
                const count = status.stageCounts[key]
                const total = key === 'categorized' ? status.total : null
                return (
                  <div key={key} className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${active ? 'bg-indigo-500/8 border-indigo-500/20' : 'bg-zinc-800/40 border-zinc-700/30'}`}>
                    <span className={active ? 'text-indigo-400' : 'text-zinc-600'}>{icon}</span>
                    <span className={`text-sm font-semibold tabular-nums ${active ? 'text-indigo-300' : count > 0 ? 'text-zinc-200' : 'text-zinc-600'}`}>
                      {count}
                    </span>
                    <span className="text-zinc-500 text-sm">
                      {label}
                      {total != null && total > 0 ? <span className="text-zinc-600"> — {total - count} remaining</span> : null}
                    </span>
                    {active && <Loader2 size={12} className="text-indigo-400 animate-spin ml-auto shrink-0" />}
                    {!active && count > 0 && <CheckCircle size={12} className="text-emerald-500 ml-auto shrink-0" />}
                  </div>
                )
              })}
            </div>
          )}

          {/* Stop button */}
          <button
            onClick={() => void stopCategorization()}
            disabled={stopping}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed text-red-400 text-sm font-medium transition-colors border border-red-500/20"
          >
            <StopCircle size={15} />
            {stopping ? 'Stopping…' : 'Stop pipeline'}
          </button>

          {status?.lastError && (
            <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              ⚠ {status.lastError}
            </p>
          )}

          {/* Progress bar during categorize/parallel stage */}
          {(status?.stage === 'categorize' || status?.stage === 'parallel') && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-zinc-500">
                <span>{status.done} / {status.total} bookmarks</span>
                <span>{progress}%</span>
              </div>
              <Progress.Root className="relative h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                <Progress.Indicator
                  className="h-full bg-indigo-500 transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </Progress.Root>
            </div>
          )}
        </div>
      )}

      {done && (
        <div className="flex flex-col items-center gap-5 py-6">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle size={32} className="text-emerald-400" />
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-zinc-100">Categorization Complete!</p>
            {status?.stageCounts && (
              <p className="text-zinc-500 text-sm mt-1">
                {status.stageCounts.visionTagged} images analyzed ·{' '}
                {status.stageCounts.enriched} bookmarks enriched ·{' '}
                {status.stageCounts.categorized} categorized
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/bookmarks"
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
            >
              View your bookmarks
              <ChevronRight size={16} />
            </Link>
            <button
              onClick={() => void startCategorization(true)}
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors border border-zinc-700"
            >
              <RefreshCw size={14} />
              Reprocess all
            </button>
          </div>
          <CleanupPanel />
        </div>
      )}

      {/* All bookmarks already existed — nothing new to categorize */}
      {importedCount === 0 && !running && (
        <div className="flex flex-col items-center gap-5 py-6">
          <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center">
            <CheckCircle size={32} className="text-zinc-500" />
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-zinc-100">Already up to date</p>
            <p className="text-zinc-500 text-sm mt-1">All bookmarks in this file were already imported</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/bookmarks"
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
            >
              View your bookmarks
              <ChevronRight size={16} />
            </Link>
            <button
              onClick={() => void startCategorization(true)}
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors border border-zinc-700"
            >
              <RefreshCw size={14} />
              Reprocess all
            </button>
          </div>
          <CleanupPanel />
        </div>
      )}
    </div>
  )
}

function CleanupPanel() {
  const [hasCredentials, setHasCredentials] = useState<boolean | null>(null)
  const [source, setSource] = useState<'bookmark' | 'like' | 'all'>('all')
  const [speed, setSpeed] = useState<'fast' | 'normal' | 'safe'>('normal')
  const [cleaning, setCleaning] = useState(false)
  const [cleanDone, setCleanDone] = useState(false)
  const [status, setStatus] = useState<{ running: boolean; done: number; total: number; failed: number; speed?: string; lastError: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<{ uncleaned: number; uncleanedBookmarks: number; uncleanedLikes: number } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Check if credentials exist and get uncleaned count
    Promise.all([
      fetch('/api/import/live').then((r) => r.json()).catch(() => null),
      fetch('/api/cleanup/stats').then((r) => r.json()).catch(() => null),
      fetch('/api/cleanup').then((r) => r.json()).catch(() => null),
    ]).then(([liveCfg, statsData, cleanupStatus]) => {
      setHasCredentials(!!liveCfg?.hasCredentials)
      if (statsData) setStats(statsData)
      if (cleanupStatus?.running) {
        setCleaning(true)
        setStatus(cleanupStatus)
        startPolling()
      }
    })
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/cleanup')
        const data = await res.json()
        setStatus(data)
        if (!data.running) {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          setCleaning(false)
          setCleanDone(true)
          // Refresh stats
          fetch('/api/cleanup/stats').then((r) => r.json()).then(setStats).catch(() => {})
        }
      } catch {
        // keep polling
      }
    }, 1000)
  }

  const [confirmMessage, setConfirmMessage] = useState<string | null>(null)
  const [confirmTotal, setConfirmTotal] = useState(0)

  async function handleStart() {
    setError(null)
    setConfirmMessage(null)
    try {
      const res = await fetch('/api/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, speed }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
        return
      }
      // API returns a confirmation prompt first
      if (data.requiresConfirmation) {
        setConfirmMessage(data.message)
        setConfirmTotal(data.total)
        return
      }
      setCleaning(true)
      setCleanDone(false)
      startPolling()
    } catch {
      setError('Failed to start cleanup')
    }
  }

  async function handleConfirm() {
    setError(null)
    setConfirmMessage(null)
    try {
      const res = await fetch('/api/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, speed, confirmed: true }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
        return
      }
      setCleaning(true)
      setCleanDone(false)
      startPolling()
    } catch {
      setError('Failed to start cleanup')
    }
  }

  async function handleStop() {
    await fetch('/api/cleanup', { method: 'DELETE' }).catch(() => {})
  }

  if (!stats || stats.uncleaned === 0) return null

  function formatDuration(seconds: number) {
    if (seconds < 60) return `${seconds}s`
    if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`
    const h = Math.floor(seconds / 3600)
    const m = Math.ceil((seconds % 3600) / 60)
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }

  const progress = status ? Math.round((status.done / Math.max(status.total, 1)) * 100) : 0
  const activeSpeed: 'fast' | 'normal' | 'safe' = (status?.speed as 'fast' | 'normal' | 'safe') ?? speed
  const delayPerItem = { fast: 1, normal: 3, safe: 5 }[activeSpeed] as number

  return (
    <div className="border-t border-zinc-800 pt-5 mt-2">
      <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
            <XCircle size={20} className="text-red-400" />
          </div>
          <div>
            <p className="text-zinc-200 font-medium">Clean up X</p>
            <p className="text-zinc-500 text-sm mt-0.5">
              Remove {stats.uncleaned} imported item{stats.uncleaned !== 1 ? 's' : ''} from your X account.
              {stats.uncleanedBookmarks > 0 && stats.uncleanedLikes > 0
                ? ` (${stats.uncleanedBookmarks} bookmarks, ${stats.uncleanedLikes} likes)`
                : ''}
            </p>
          </div>
        </div>

        {!hasCredentials && !cleaning && !cleanDone && (
          <div className="rounded-xl bg-amber-500/8 border border-amber-500/20 p-4 space-y-2">
            <p className="text-sm text-amber-200">X credentials required</p>
            <p className="text-xs text-zinc-500">
              To remove items from X, save your <code className="text-zinc-400">auth_token</code> and <code className="text-zinc-400">ct0</code> cookies in the <strong>Live Import</strong> tab above.
            </p>
          </div>
        )}

        {hasCredentials && !cleaning && !cleanDone && !confirmMessage && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as 'bookmark' | 'like' | 'all')}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300 outline-none"
              >
                <option value="all">All ({stats.uncleaned})</option>
                {stats.uncleanedBookmarks > 0 && <option value="bookmark">Bookmarks ({stats.uncleanedBookmarks})</option>}
                {stats.uncleanedLikes > 0 && <option value="like">Likes ({stats.uncleanedLikes})</option>}
              </select>
              <select
                value={speed}
                onChange={(e) => setSpeed(e.target.value as 'fast' | 'normal' | 'safe')}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300 outline-none"
              >
                <option value="fast">Fast (1/sec)</option>
                <option value="normal">Normal (1/3sec)</option>
                <option value="safe">Safe (1/5sec)</option>
              </select>
              <button
                onClick={() => void handleStart()}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
              >
                <Trash2 size={14} />
                Remove from X
              </button>
            </div>
            <p className="text-xs text-zinc-600">
              {(() => {
                const count = source === 'all' ? stats.uncleaned : source === 'bookmark' ? stats.uncleanedBookmarks : stats.uncleanedLikes
                return `Estimated time: ~${formatDuration(count * ({ fast: 1, normal: 3, safe: 5 }[speed]))}`
              })()}
              {speed === 'safe' && ' — lowest risk of X flagging your account'}
              {speed === 'fast' && ' — slightly higher risk, but still within normal usage'}
            </p>
          </div>
        )}

        {confirmMessage && (
          <div className="rounded-xl bg-amber-500/8 border border-amber-500/20 p-4 space-y-3">
            <p className="text-sm text-amber-200">{confirmMessage}</p>
            <p className="text-xs text-zinc-500">
              Make sure your {confirmTotal} item{confirmTotal !== 1 ? 's are' : ' is'} safely imported in Siftly before proceeding.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => void handleConfirm()}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
              >
                <Trash2 size={14} />
                Yes, remove from X
              </button>
              <button
                onClick={() => setConfirmMessage(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm font-medium border border-zinc-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {cleaning && status && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Loader2 size={14} className="animate-spin text-red-400" />
                Removing {status.done} / {status.total}...
              </div>
              <button
                onClick={() => void handleStop()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs font-medium border border-zinc-700 transition-colors"
              >
                <StopCircle size={12} />
                Stop
              </button>
            </div>
            <div className="relative h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-red-500 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            {status.total > 0 && (
              <p className="text-xs text-zinc-600">
                ~{formatDuration((status.total - status.done) * delayPerItem)} remaining · {status.speed ?? 'normal'} speed
              </p>
            )}
          </div>
        )}

        {cleanDone && status && (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle size={16} className="text-emerald-400" />
            <span className="text-zinc-300">
              {status.done} removed from X
              {status.failed > 0 && <span className="text-zinc-500"> · {status.failed} failed</span>}
            </span>
          </div>
        )}

        {(status?.lastError && status.lastError !== 'Stopped by user') && (
          <p className="text-xs text-red-400">{status.lastError}</p>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  )
}

function UncategorizedBanner({ onCategorize, onReprocess }: { onCategorize: () => void; onReprocess: () => void }) {
  const [totalBookmarks, setTotalBookmarks] = useState<number | null>(null)
  const [uncategorized, setUncategorized] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/stats')
      .then((r) => {
        if (!r.ok) throw new Error('Stats fetch failed')
        return r.json()
      })
      .then((d: { totalBookmarks?: number; uncategorizedCount?: number }) => {
        setTotalBookmarks(d.totalBookmarks ?? 0)
        setUncategorized(d.uncategorizedCount ?? 0)
      })
      .catch(() => {
        // Stats unavailable — banner stays hidden, not a critical failure
      })
  }, [])

  if (!totalBookmarks || totalBookmarks === 0) return null

  return (
    <div className="space-y-3 mb-6">
      {uncategorized != null && uncategorized > 0 && (
        <div className="flex items-center justify-between gap-4 px-4 py-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/25">
          <div className="flex items-center gap-2.5 min-w-0">
            <Sparkles size={15} className="text-indigo-400 shrink-0" />
            <p className="text-sm text-indigo-300">
              <span className="font-semibold">{uncategorized.toLocaleString()}</span> bookmarks not yet processed
            </p>
          </div>
          <button
            onClick={onCategorize}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors shrink-0"
          >
            <Sparkles size={12} />
            Process
          </button>
        </div>
      )}
      <div className="flex items-center justify-between gap-4 px-4 py-3.5 rounded-xl bg-zinc-800/60 border border-zinc-700/40">
        <div className="flex items-center gap-2.5 min-w-0">
          <RefreshCw size={15} className="text-zinc-400 shrink-0" />
          <p className="text-sm text-zinc-400">
            Re-analyze all <span className="font-semibold text-zinc-300">{totalBookmarks.toLocaleString()}</span> bookmarks from scratch
          </p>
        </div>
        <button
          onClick={onReprocess}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-xs font-semibold transition-colors shrink-0"
        >
          <RefreshCw size={12} />
          Reprocess all
        </button>
      </div>
    </div>
  )
}

export default function ImportPage() {
  const [step, setStep] = useState<Step>(1)
  const [importSource, setImportSource] = useState<'bookmark' | 'like'>('bookmark')
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [forceReprocess, setForceReprocess] = useState(false)

  // Auto-resume to step 3 if the pipeline is already running (e.g. user navigated away and back)
  useEffect(() => {
    fetch('/api/categorize')
      .then((r) => r.json())
      .then((d: { status: string }) => {
        if (d.status === 'running' || d.status === 'stopping') setStep(3)
      })
      .catch(() => {})
  }, [])

  function handleLiveSynced(result: ImportResult) {
    setImportResult(result)
    setStep(2)
    setTimeout(() => setStep(3), 1500)
  }

  async function handleFile(file: File) {
    setStep(2)
    setImporting(true)
    setImportError('')

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('source', importSource)

      const res = await fetch('/api/import', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error ?? 'Import failed')

      const result: ImportResult = {
        imported: data.imported ?? data.count ?? 0,
        skipped: data.skipped ?? 0,
        total: (data.imported ?? data.count ?? 0) + (data.skipped ?? 0),
      }
      setImportResult(result)

      // Auto-advance to categorization after a brief moment to show the result
      setTimeout(() => setStep(3), 1500)
    } catch (err) {
      console.error('Import error:', err)
      setImportError(err instanceof Error ? err.message : 'Import failed')
      setStep(1)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-100">Import {importSource === 'like' ? 'Likes' : 'Bookmarks'}</h1>
        <p className="text-zinc-400 mt-1">Export your X/Twitter {importSource === 'like' ? 'likes' : 'bookmarks'} as JSON, then upload below.</p>
      </div>

      {/* Source selector */}
      {step === 1 && (
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setImportSource('bookmark')}
            className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border ${
              importSource === 'bookmark'
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
            }`}
          >
            Bookmarks
          </button>
          <button
            onClick={() => setImportSource('like')}
            className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border ${
              importSource === 'like'
                ? 'bg-pink-600 border-pink-500 text-white'
                : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
            }`}
          >
            Likes
          </button>
        </div>
      )}

      {step === 1 && <UncategorizedBanner onCategorize={() => setStep(3)} onReprocess={() => { setForceReprocess(true); setStep(3) }} />}

      {importError && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4">
          Import failed: {importError}
        </p>
      )}

      <StepIndicator current={step} />

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
        {step === 1 && <InstructionsStep onFile={handleFile} importSource={importSource} onLiveSynced={handleLiveSynced} />}
        {step === 2 && (
          <ImportingStep
            result={importing ? null : importResult}
          />
        )}
        {step === 3 && <CategorizeStep importedCount={importResult ? importResult.imported : -1} force={forceReprocess} />}
      </div>

      {/* Cleanup panel — always visible when there are imported items and credentials */}
      {step !== 3 && <CleanupPanel />}
    </div>
  )
}
