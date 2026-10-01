'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Type } from 'lucide-react'
import RootNode from './root-node'
import CategoryNode from './category-node'
import TweetNode from './tweet-node'
import ChainEdge from './chain-edge'
import { MindmapContext } from './mindmap-context'

const nodeTypes = { root: RootNode, category: CategoryNode, tweet: TweetNode }
const edgeTypes = { chain: ChainEdge }

// Golden angle — Fibonacci/sunflower spiral for organic, non-overlapping spread
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)) // ≈ 137.508°

function layoutTweetNodes(nodes: Node[], center: Node): Node[] {
  const count = nodes.length
  return nodes.map((n, i) => {
    const angle = i * GOLDEN_ANGLE
    // Scale radius with count so nodes never overlap, even at 100+ bookmarks
    const t = count > 1 ? (i + 0.5) / count : 0.5
    const maxRadius = Math.max(400, 80 * Math.sqrt(count))
    const radius = 110 + maxRadius * Math.sqrt(t)
    return {
      ...n,
      position: {
        x: center.position.x + Math.round(radius * Math.cos(angle)),
        y: center.position.y + Math.round(radius * Math.sin(angle)),
      },
    }
  })
}

// ── Canvas ────────────────────────────────────────────────────────────────────

interface MindmapCanvasProps {
  initialNodes: Node[]
  initialEdges: Edge[]
}

type ViewMode = 'categories' | 'focused'

export default function MindmapCanvas({ initialNodes, initialEdges }: MindmapCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [viewMode, setViewMode] = useState<ViewMode>('categories')
  const [focusedSlug, setFocusedSlug] = useState<string | null>(null)
  const [tweetCache, setTweetCache] = useState<Record<string, { nodes: Node[]; edges: Edge[] }>>({})
  const [bgColor, setBgColor] = useState('#111113')
  const [showLabels, setShowLabels] = useState(false)

  useEffect(() => {
    const update = () => setBgColor(document.documentElement.classList.contains('light') ? '#ececef' : '#111113')
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (viewMode === 'categories') {
      setNodes(initialNodes)
      setEdges(initialEdges)
    }
  }, [initialNodes, initialEdges, setNodes, setEdges, viewMode])

  const resetToCategories = useCallback(() => {
    setViewMode('categories')
    setFocusedSlug(null)
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  const handleNodeClick: NodeMouseHandler = useCallback(async (_, node) => {
    if (node.type === 'root') { resetToCategories(); return }
    if (node.type !== 'category') return

    const data = node.data as { slug: string; color: string }
    const { slug, color } = data

    // Toggle off
    if (viewMode === 'focused' && focusedSlug === slug) { resetToCategories(); return }

    setFocusedSlug(slug)
    setViewMode('focused')

    // Use cache
    if (tweetCache[slug]) {
      const { nodes: cn, edges: ce } = tweetCache[slug]
      const positioned = layoutTweetNodes(cn, node)
      setNodes([node, ...positioned])
      setEdges(ce)
      return
    }

    // Fetch
    try {
      const res = await fetch(`/api/mindmap?category=${slug}`)
      const { nodes: newNodes, edges: newEdges } = (await res.json()) as { nodes: Node[]; edges: Edge[] }
      const tweetNodes = newNodes.filter((n) => n.type === 'tweet')
      const positioned = layoutTweetNodes(tweetNodes, node)

      // Style edges: faint straight lines for tweet connections
      const styledEdges = (newEdges as Edge[]).map((e) => ({
        ...e,
        type: 'straight',
        style: { stroke: color, strokeWidth: 0.8, opacity: 0.25 },
        markerEnd: undefined,
      }))

      setTweetCache((prev) => ({ ...prev, [slug]: { nodes: tweetNodes, edges: styledEdges } }))
      setNodes([node, ...positioned])
      setEdges(styledEdges)
    } catch (err) {
      console.error('Failed to load category tweets:', err)
    }
  }, [viewMode, focusedSlug, tweetCache, setNodes, setEdges, resetToCategories])

  return (
    <MindmapContext.Provider value={{ showLabels }}>
    <div className="relative w-full h-full">
      {/* Top-left controls */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
        {viewMode === 'focused' && (
          <button
            onClick={resetToCategories}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900/90 border border-zinc-700 text-zinc-300 text-sm hover:bg-zinc-800 hover:text-zinc-100 transition-colors backdrop-blur-sm"
          >
            ← すべてのカテゴリ
          </button>
        )}
        {viewMode === 'focused' && (
          <button
            onClick={() => setShowLabels((v) => !v)}
            title={showLabels ? 'ラベルを隠す' : 'ラベルを表示'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors backdrop-blur-sm ${
              showLabels
                ? 'bg-indigo-600/80 border-indigo-500 text-white'
                : 'bg-zinc-900/90 border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
            }`}
          >
            <Type size={13} />
            ラベル
          </button>
        )}
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        defaultEdgeOptions={{
          type: 'chain',
          style: { stroke: '#6366f1', strokeWidth: 1.5, opacity: 0.8 },
          markerEnd: undefined,
        }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={2.5}
      >
        <Background color={bgColor} gap={24} size={1} />
        <Controls
          className="bg-zinc-900/90 border border-zinc-700 rounded-xl overflow-hidden backdrop-blur-sm"
          showInteractive={false}
        />
      </ReactFlow>

      {/* Hint */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-full bg-zinc-900/80 border border-zinc-800 text-xs text-zinc-500 pointer-events-none whitespace-nowrap">
        {viewMode === 'categories' ? 'カテゴリをクリックしてブックマークを見る' : 'バブルをドラッグ · ←で戻る'}
      </div>
    </div>
    </MindmapContext.Provider>
  )
}
