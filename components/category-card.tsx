import Link from 'next/link'
import { Bookmark } from 'lucide-react'
import type { Category } from '@/lib/types'

interface CategoryCardProps {
  category: Category
}

export default function CategoryCard({ category }: CategoryCardProps) {
  return (
    <Link
      href={`/categories/${category.slug}`}
      className="block bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition-all"
      style={{ borderLeftColor: category.color, borderLeftWidth: '3px' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Bookmark
            size={13}
            className="shrink-0"
            style={{ color: category.color, fill: category.color }}
          />
          <span className="font-semibold text-zinc-100 text-sm truncate">{category.name}</span>
        </div>
        <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
          {category.bookmarkCount}
        </span>
      </div>

      {category.description && (
        <p className="mt-2 text-xs text-zinc-500 leading-relaxed line-clamp-2">
          {category.description}
        </p>
      )}

      {!category.description && (
        <p className="mt-2 text-xs text-zinc-600 italic">説明なし</p>
      )}

      <div className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500">
        <span>{category.bookmarkCount}件のブックマーク</span>
        {category.isAiGenerated && (
          <>
            <span>·</span>
            <span className="text-indigo-400">AI生成</span>
          </>
        )}
      </div>
    </Link>
  )
}
