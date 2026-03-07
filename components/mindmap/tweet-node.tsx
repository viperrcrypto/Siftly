'use client'

import { useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ExternalLink } from 'lucide-react'
import { useMindmapSettings } from './mindmap-context'

interface TweetNodeData {
  tweetId: string
  text: string
  authorHandle: string
  authorName: string
  tweetUrl: string
  thumbnailUrl: string | null
  mediaType: string | null
  categoryColor: string
  tweetCreatedAt: string | null
  hasMedia: boolean
  visualSummary: string | null
  [key: string]: unknown
}

function proxyUrl(url: string): string {
  return `/api/media?url=${encodeURIComponent(url)}`
}

const HANDLE_STYLE = { opacity: 0, width: 1, height: 1, minWidth: 1, minHeight: 1 }

export default function TweetNode({ data }: NodeProps) {
  const {
    text,
    authorHandle,
    tweetUrl,
    thumbnailUrl,
    mediaType,
    categoryColor = '#6366f1',
  } = data as TweetNodeData

  const [imgFailed, setImgFailed] = useState(false)
  const { showLabels } = useMindmapSettings()

  const isVideo = mediaType === 'video' || mediaType === 'gif'
  const color = categoryColor

  // Proxy through our media API to avoid CORS issues with Twitter CDN
  const proxied = thumbnailUrl ? proxyUrl(thumbnailUrl) : null
  const showImage = proxied !== null && !imgFailed

  return (
    <div className="flex flex-col items-center select-none" style={{ width: 72, gap: 0 }}>
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />

      {/* Circular node */}
      <div
        className="relative shrink-0"
        style={{
          width: 68,
          height: 68,
          borderRadius: '50%',
          border: `2px solid ${color}`,
          overflow: 'hidden',
          backgroundColor: `${color}18`,
          boxShadow: `0 0 0 3px ${color}18, 0 2px 12px ${color}35`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'grab',
          transition: 'box-shadow 0.2s',
          flexShrink: 0,
        }}
      >
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={proxied!}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          /* Text preview bubble — shown when no image is available */
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '8px',
              background: `radial-gradient(circle at 40% 35%, ${color}38, ${color}12)`,
            }}
          >
            <span
              style={{
                fontSize: 7.5,
                color: `${color}ee`,
                lineHeight: 1.35,
                textAlign: 'center',
                display: '-webkit-box',
                WebkitLineClamp: 4,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                wordBreak: 'break-word',
              }}
            >
              {text?.slice(0, 55) || '—'}
            </span>
          </div>
        )}

        {/* Video/GIF play badge */}
        {isVideo && showImage && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.28)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.88)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ fontSize: 7, marginLeft: 2 }}>▶</span>
            </div>
          </div>
        )}
      </div>

      {/* Label — shown only when toggle is on */}
      {showLabels && (
        <p
          style={{
            fontSize: 9,
            color: showImage ? '#a1a1aa' : `${color}bb`,
            textAlign: 'center',
            lineHeight: 1.35,
            maxWidth: 86,
            marginTop: 4,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            wordBreak: 'break-word',
          }}
        >
          {showImage
            ? (text?.slice(0, 40) ?? '—')
            : (authorHandle && authorHandle !== 'unknown' ? `@${authorHandle}` : (text?.slice(0, 40) ?? '—'))
          }
        </p>
      )}

      {/* External link */}
      <a
        href={tweetUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: -6,
          right: -4,
          color: color,
          opacity: 0.65,
          lineHeight: 1,
        }}
        title="Open tweet"
      >
        <ExternalLink size={9} />
      </a>

      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
    </div>
  )
}
