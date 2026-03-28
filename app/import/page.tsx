'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { Upload, CheckCircle, ChevronRight, Loader2, Copy, Check, ExternalLink, Sparkles, Eye, Tag, Brain, Layers, StopCircle, RefreshCw, Clock, KeyRound, Trash2, AlertCircle, User, LogOut } from 'lucide-react'
import * as Progress from '@radix-ui/react-progress'

type Step = 1 | 2 | 3
type Method = 'bookmarklet' | 'console' | 'live'

interface ImportResult {
  imported: number
  skipped: number
  total: number
  parsed: number
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

// ── Live Import Tab (OAuth 2.0 PKCE) ─────────────────────────────────────────

interface OAuthStatus {
  configured: boolean
  connected: boolean
  tokenExpired?: boolean
  user?: { id?: string; name?: string; username?: string } | null
  error?: string
}

function LiveImportTab({ onSynced }: { onSynced: (result: ImportResult) => void }) {
  const [status, setStatus] = useState<OAuthStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState('')

  // Check for OAuth callback params in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('x_connected') === 'true') {
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname)
    }
    if (params.get('x_error')) {
      setError(`OAuth error: ${params.get('x_error')}`)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  // Fetch status on mount
  useEffect(() => {
    fetch('/api/import/x-oauth/status')
      .then(async (r) => {
        if (!r.ok) throw new Error('Failed to check status')
        const data: OAuthStatus = await r.json()
        setStatus(data)
      })
      .catch(() => setError('Could not connect to the server'))
      .finally(() => setLoading(false))
  }, [])

  async function handleConnect() {
    setError('')
    setConnecting(true)
    try {
      const res = await fetch('/api/import/x-oauth/authorize')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to start OAuth')
      window.location.href = data.authUrl
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect')
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    setError('')
    setDisconnecting(true)
    try {
      const res = await fetch('/api/import/x-oauth/disconnect', { method: 'POST' })
      if (!res.ok) throw new Error('Failed to disconnect')
      setStatus({ configured: true, connected: false })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect')
    } finally {
      setDisconnecting(false)
    }
  }

  async function handleFetchBookmarks() {
    setError('')
    setSyncing(true)
    try {
      const res = await fetch('/api/import/x-oauth/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxPages: 10 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Fetch failed')
      onSynced({
        imported: data.imported ?? 0,
        skipped: data.skipped ?? 0,
        total: data.total ?? 0,
        parsed: data.total ?? 0,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed')
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-zinc-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="text-xs text-zinc-500 space-y-1.5 bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4">
        <p className="text-zinc-300 font-medium text-sm mb-2 flex items-center gap-2">
          <ExternalLink size={14} className="text-indigo-400" />
          X OAuth 2.0 (Recommended)
        </p>
        <p>Connect your X account using the official OAuth 2.0 flow. This is the X-approved method — no cookies or session tokens needed.</p>
        <p className="text-zinc-600 mt-1">Requires X OAuth Client ID in Settings. Scopes: bookmark.read, tweet.read, users.read</p>
        <p className="text-amber-400/80 mt-2 font-medium">Note: The X API requires a paid Basic tier ($200/mo) or higher for bookmark.read scope access. The free tier does not support fetching bookmarks.</p>
      </div>

      {/* Not configured */}
      {!status?.configured && (
        <div className="flex items-center gap-3 p-3.5 rounded-xl bg-amber-500/8 border border-amber-500/20">
          <AlertCircle size={15} className="text-amber-400 shrink-0" />
          <div>
            <p className="text-sm text-amber-300">X OAuth not configured</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Add your X OAuth Client ID (and optionally Client Secret) in{' '}
              <Link href="/settings" className="text-indigo-400 hover:underline">Settings</Link>
            </p>
          </div>
        </div>
      )}

      {/* Configured but not connected */}
      {status?.configured && !status?.connected && (
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="w-full py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-white font-medium transition-colors flex items-center justify-center gap-2.5"
        >
          {connecting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Redirecting to X...
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              Connect X Account
            </>
          )}
        </button>
      )}

      {/* Connected */}
      {status?.connected && (
        <>
          <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-emerald-500/8 border border-emerald-500/20">
            <div className="flex items-center gap-2.5">
              <CheckCircle size={15} className="text-emerald-400 shrink-0" />
              <div>
                <span className="text-sm text-emerald-300">Connected to X</span>
                {status.user?.username && (
                  <span className="text-xs text-zinc-500 ml-2">
                    <User size={11} className="inline -mt-0.5 mr-0.5" />
                    @{status.user.username}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Disconnect X account"
            >
              {disconnecting ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
            </button>
          </div>

          {status.tokenExpired && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
              <AlertCircle size={14} className="text-amber-400 shrink-0" />
              <p className="text-xs text-amber-300">Token expired. Siftly will try to auto-refresh, or you can reconnect.</p>
            </div>
          )}

          <button
            onClick={handleFetchBookmarks}
            disabled={syncing}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-medium transition-colors flex items-center justify-center gap-2"
          >
            {syncing ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Fetching bookmarks...
              </>
            ) : (
              <>
                <RefreshCw size={16} />
                Fetch Bookmarks from X
              </>
            )}
          </button>
        </>
      )}

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
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
        </div>
      )}
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
  const importSource = 'bookmark' as const
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

      const imported = data.imported ?? 0
      const skipped = data.skipped ?? 0
      const parsed = data.parsed ?? (imported + skipped)
      const result: ImportResult = {
        imported,
        skipped,
        total: imported + skipped,
        parsed,
      }
      setImportResult(result)

      if (parsed === 0) {
        // Parser couldn't extract any bookmarks — likely wrong format
        throw new Error('Could not parse any bookmarks from this file. Make sure you\'re uploading a Twitter/X bookmarks JSON export.')
      }

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
        <h1 className="text-2xl font-bold text-zinc-100">Import Bookmarks</h1>
        <p className="text-zinc-400 mt-1">Export your X/Twitter bookmarks as JSON, then upload below.</p>
      </div>

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
    </div>
  )
}
