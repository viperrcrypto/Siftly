'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { CheckCircle, ChevronRight, Copy, Check } from 'lucide-react'

// __SIFTLY_ORIGIN__ is replaced at runtime with window.location.origin so the
// bookmarklet always points to whichever host the user is running Siftly on.
const BOOKMARKLET_TEMPLATE = `javascript:(async()=>{const csrf=document.cookie.match(/ct0=([^;]+)/)?.[1];if(!csrf){alert('ct0 cookie not found. Make sure you are on x.com and logged in.');return;}const BEARER='AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I%2BxMb1nYFAA%3DUognEfK4ZPxYowpr4nMskopkC%2FDO';const QID='j5KExFXy1niL_uGnBhHNxA';const FEAT=JSON.stringify({graphql_timeline_v2_bookmark_timeline:true,responsive_web_graphql_exclude_directive_enabled:true,verified_phone_label_enabled:false,creator_subscriptions_tweet_preview_api_enabled:true,responsive_web_graphql_timeline_navigation_enabled:true,responsive_web_graphql_skip_user_profile_image_extensions_enabled:false,tweetypie_unmention_optimization_enabled:true,responsive_web_edit_tweet_api_enabled:true,graphql_is_translatable_rweb_tweet_is_translatable_enabled:true,view_counts_everywhere_api_enabled:true,longform_notetweets_consumption_enabled:true,responsive_web_twitter_article_tweet_consumption_enabled:true,tweet_awards_web_tipping_enabled:false,freedom_of_speech_not_reach_fetch_enabled:true,standardized_nudges_misinfo:true,tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled:true,longform_notetweets_rich_text_read_enabled:true,longform_notetweets_inline_media_enabled:true,responsive_web_enhance_cards_enabled:false});const tweets=[];let cursor=null;let pages=0;const status=document.createElement('div');status.style.cssText='position:fixed;top:16px;right:16px;background:#1a1a2e;color:#a5b4fc;border:1px solid #4f46e5;padding:12px 18px;border-radius:12px;font-family:system-ui;font-size:14px;z-index:99999;box-shadow:0 4px 24px rgba(0,0,0,.4)';status.textContent='bookmarkX: fetching page 1\u2026';document.body.appendChild(status);while(pages<100){const vars=JSON.stringify({count:100,includePromotedContent:false,...(cursor?{cursor}:{})});let data;try{const r=await fetch('/i/api/graphql/'+QID+'/Bookmarks?variables='+encodeURIComponent(vars)+'&features='+encodeURIComponent(FEAT),{credentials:'include',headers:{Authorization:'Bearer '+BEARER,'X-Csrf-Token':csrf}});if(!r.ok){status.remove();alert('Twitter API error '+r.status+'. The bookmarklet query ID may have changed \u2014 check bookmarkX for updates.');return;}data=await r.json();}catch(e){status.remove();alert('Fetch failed: '+e.message);return;}const instructions=data?.data?.bookmark_timeline_v2?.timeline?.instructions??[];let nextCursor=null;let count=0;for(const inst of instructions){if(inst.type!=='TimelineAddEntries')continue;for(const entry of inst.entries??[]){const c=entry.content;if(c?.entryType==='TimelineTimelineItem'){const t=c?.itemContent?.tweet_results?.result;if(t?.rest_id){tweets.push(t);count++;}}else if(c?.entryType==='TimelineTimelineCursor'&&c?.cursorType==='Bottom'){nextCursor=c.value;}}}if(!nextCursor||count===0)break;cursor=nextCursor;pages++;status.textContent='bookmarkX: fetched '+tweets.length+' bookmarks, loading more\u2026';}status.textContent='bookmarkX: saving '+tweets.length+' bookmarks\u2026';if(tweets.length===0){status.remove();alert('No bookmarks found. Make sure you are on x.com.');return;}try{const r=await fetch('__SIFTLY_ORIGIN__/api/import/bookmarklet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tweets})});const d=await r.json();status.remove();if(r.ok)alert('Done! Imported '+d.imported+' bookmarks'+(d.skipped?' ('+d.skipped+' duplicates skipped)':'')+'. Refresh Siftly to see them.');else alert('Siftly error: '+d.error);}catch(e){status.remove();alert('Could not reach Siftly at __SIFTLY_ORIGIN__. Is it running?');}})();`

const STEPS = [
  { label: 'Copy the code', desc: 'Click the "Copy Bookmarklet" button below.' },
  { label: 'Create a new bookmark', desc: 'In Chrome: right-click the bookmarks bar → "Add page…". In Firefox: Bookmarks menu → "New Bookmark".' },
  { label: 'Paste as the URL', desc: 'Set the Name to "Siftly Import" and paste the copied code as the URL/Location.' },
  { label: 'Go to x.com/i/bookmarks', desc: 'Make sure you are logged in to X.' },
  { label: 'Click your new bookmark', desc: 'It fetches all your bookmarks and saves them here automatically. A popup will confirm when done.' },
]

export default function TwitterImportPage() {
  const [copied, setCopied] = useState(false)
  const linkRef = useRef<HTMLAnchorElement>(null)
  const [bookmarkletCode, setBookmarkletCode] = useState('')

  // Build the bookmarklet with the actual server origin after mount
  useEffect(() => {
    const code = BOOKMARKLET_TEMPLATE.replaceAll('__SIFTLY_ORIGIN__', window.location.origin)
    setBookmarkletCode(code)
    if (linkRef.current) {
      linkRef.current.setAttribute('href', code)
    }
  }, [])

  function handleCopy() {
    navigator.clipboard.writeText(bookmarkletCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-100">Import All Bookmarks — Free</h1>
        <p className="text-zinc-400 mt-1">
          No extensions, no paywall. A one-click bookmarklet fetches everything straight from X.
        </p>
      </div>

      {/* Copy bookmarklet */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-4">
        <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider mb-4">
          Get the Bookmarklet
        </h2>
        <p className="text-sm text-zinc-400 mb-5">
          Copy this code and paste it as the URL of a new browser bookmark.
        </p>

        <div className="flex gap-3 items-stretch">
          <div className="flex-1 px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-500 text-xs font-mono truncate flex items-center">
            javascript:(async()=&gt;&#123;const csrf=…&#125;)();
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors shrink-0"
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? 'Copied!' : 'Copy Bookmarklet'}
          </button>
        </div>

        {/* Drag fallback — set via ref after mount */}
        <p className="mt-3 text-xs text-zinc-600">
          Or try dragging:{' '}
          <a
            ref={linkRef}
            href="#"
            className="text-indigo-400 underline cursor-grab"
            onClick={(e) => e.preventDefault()}
          >
            Siftly Import
          </a>{' '}
          to your bookmarks bar (may not work in all browsers).
        </p>
      </div>

      {/* Steps */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-4">
        <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider mb-4">
          How to use it
        </h2>
        <ol className="space-y-4">
          {STEPS.map((step, i) => (
            <li key={i} className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-xs font-bold text-indigo-400 mt-0.5">
                {i + 1}
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-200">{step.label}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{step.desc}</p>
              </div>
            </li>
          ))}
        </ol>

        <a
          href="https://x.com/i/bookmarks"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 mt-5 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors"
        >
          Open x.com/i/bookmarks <ChevronRight size={14} />
        </a>
      </div>

      {/* How it works */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-4">
        <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider mb-3">
          How it works
        </h2>
        <p className="text-sm text-zinc-400 leading-relaxed">
          The bookmarklet runs inside your browser on x.com, using your existing login session.
          It calls the same internal API Twitter&rsquo;s own website uses — no password, no API key, no extension required.
          Your credentials never leave your browser. All data goes directly to your local Siftly instance.
        </p>
      </div>

    </div>
  )
}
