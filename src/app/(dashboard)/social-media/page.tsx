'use client'

import Image from 'next/image'
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiPatch } from '@/lib/utils/api-fetch'

type PostStatus = 'suggested' | 'validated' | 'canceled' | 'published'

interface SocialAccount {
  id: string
  label: string
  platform: string
  handle: string
}

interface SocialPost {
  postPk: number
  accountId: string
  content: string
  imageUrl?: string | null
  scheduledFor: string
  status: PostStatus
  publishedAt?: string | null
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function leftCardClass(status: PostStatus): string {
  if (status === 'validated') return 'bg-green-100 border-green-300'
  if (status === 'canceled') return 'bg-red-100 border-red-300'
  return 'bg-gray-100 border-gray-300'
}

export default function SocialMediaPage() {
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['social-media-posts'],
    queryFn: () => apiFetch<{ data: { accounts: SocialAccount[]; posts: SocialPost[] } }>('/api/social/posts'),
  })

  const accounts = data?.data?.accounts ?? []
  const posts = data?.data?.posts ?? []

  const postsByAccount = useMemo(() => {
    const map = new Map<string, SocialPost[]>()
    for (const p of posts) {
      const arr = map.get(p.accountId) ?? []
      arr.push(p)
      map.set(p.accountId, arr)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
    }
    return map
  }, [posts])

  const updateStatus = useMutation({
    mutationFn: ({ postPk, status }: { postPk: number; status: PostStatus }) =>
      apiPatch(`/api/social/posts/${postPk}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['social-media-posts'] }),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold">Social Media Pipelines</h1>
        <span className="text-xs text-muted-foreground">1 row per account, timeline left-to-right</span>
      </div>

      <div className="text-xs text-muted-foreground">
        Left: unpublished ({' '}
        <span className="px-1 rounded bg-gray-200">suggested</span> /{' '}
        <span className="px-1 rounded bg-green-200">validated</span> /{' '}
        <span className="px-1 rounded bg-red-200">canceled</span> ) • Right: <span className="px-1 rounded bg-blue-200">published</span>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading pipelines...</p>
      ) : (
        <div className="space-y-4">
          {accounts.map((account) => {
            const accountPosts = postsByAccount.get(account.id) ?? []
            const left = accountPosts.filter((p) => p.status !== 'published')
            const right = accountPosts.filter((p) => p.status === 'published')

            return (
              <div key={account.id} className="border border-border rounded p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium">{account.label}</div>
                  <div className="text-xs text-muted-foreground">{account.platform.toUpperCase()} • {account.handle}</div>
                </div>

                <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-start">
                  <div className="space-y-2">
                    <div className="text-[11px] text-muted-foreground">Unpublished plan</div>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {left.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No planned posts</span>
                      ) : (
                        left.map((p) => (
                          <article
                            key={p.postPk}
                            className={`min-w-[170px] max-w-[170px] border rounded p-2 ${leftCardClass(p.status)}`}
                          >
                            {p.imageUrl && (
                              <div className="relative w-full h-20 mb-2 rounded overflow-hidden bg-white/70">
                                <Image src={p.imageUrl} alt="" fill className="object-cover" />
                              </div>
                            )}
                            <p className="text-[11px] line-clamp-4">{p.content}</p>
                            <p className="text-[10px] text-muted-foreground mt-1">{formatDate(p.scheduledFor)}</p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              <button
                                className="text-[10px] px-1.5 py-0.5 rounded border border-green-400 bg-green-200"
                                onClick={() => updateStatus.mutate({ postPk: p.postPk, status: 'validated' })}
                              >
                                Validate
                              </button>
                              <button
                                className="text-[10px] px-1.5 py-0.5 rounded border border-red-400 bg-red-200"
                                onClick={() => updateStatus.mutate({ postPk: p.postPk, status: 'canceled' })}
                              >
                                Cancel
                              </button>
                              <button
                                className="text-[10px] px-1.5 py-0.5 rounded border border-gray-400 bg-gray-200"
                                onClick={() => updateStatus.mutate({ postPk: p.postPk, status: 'suggested' })}
                              >
                                Suggest
                              </button>
                            </div>
                          </article>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="h-full flex items-center">
                    <div className="text-[10px] text-muted-foreground px-2 py-1 rounded border border-border">NOW</div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-[11px] text-muted-foreground">Published</div>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {right.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No published posts</span>
                      ) : (
                        right.map((p) => (
                          <article key={p.postPk} className="min-w-[170px] max-w-[170px] border border-blue-300 bg-blue-100 rounded p-2">
                            {p.imageUrl && (
                              <div className="relative w-full h-20 mb-2 rounded overflow-hidden bg-white/70">
                                <Image src={p.imageUrl} alt="" fill className="object-cover" />
                              </div>
                            )}
                            <p className="text-[11px] line-clamp-4">{p.content}</p>
                            <p className="text-[10px] text-muted-foreground mt-1">Published {formatDate(p.publishedAt ?? p.scheduledFor)}</p>
                          </article>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
