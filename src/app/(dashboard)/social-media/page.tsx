'use client'

import { useMemo, useState } from 'react'
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
  images?: string[]
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

function accountLineLabel(account: SocialAccount): string {
  if (account.platform === 'x') return `${account.label} X account`
  return `${account.label} ${account.platform} account`
}

function PlatformLogo({ platform }: { platform: string }) {
  if (platform === 'x') {
    return (
      <span
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-black text-white text-[10px] font-bold"
        title="X"
        aria-label="X"
      >
        X
      </span>
    )
  }

  return (
    <span
      className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-gray-300 text-[10px] font-bold"
      title={platform}
      aria-label={platform}
    >
      {platform.slice(0, 1).toUpperCase()}
    </span>
  )
}

export default function SocialMediaPage() {
  const qc = useQueryClient()
  const [expandedImages, setExpandedImages] = useState<Record<number, boolean>>({})

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

  function toggleImages(postPk: number) {
    setExpandedImages((prev) => ({ ...prev, [postPk]: !prev[postPk] }))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold">Social Media Pipelines</h1>
        <span className="text-xs text-muted-foreground">1 column per account, unpublished above published</span>
      </div>

      <div className="text-xs text-muted-foreground">
        Top: unpublished (
        <span className="px-1 rounded bg-gray-200">suggested</span> /{' '}
        <span className="px-1 rounded bg-green-200">validated</span> /{' '}
        <span className="px-1 rounded bg-red-200">canceled</span>) | Bottom: <span className="px-1 rounded bg-blue-200">published</span>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading pipelines...</p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {accounts.map((account) => {
            const accountPosts = postsByAccount.get(account.id) ?? []
            const unpublished = accountPosts
              .filter((p) => p.status === 'suggested' || p.status === 'validated')
              .slice(0, 6)
            const published = accountPosts
              .filter((p) => p.status === 'published')
              .sort((a, b) => new Date(b.publishedAt ?? b.scheduledFor).getTime() - new Date(a.publishedAt ?? a.scheduledFor).getTime())
              .slice(0, 2)

            return (
              <section key={account.id} className="border border-border rounded p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium flex items-center gap-1.5">
                    <PlatformLogo platform={account.platform} />
                    {accountLineLabel(account)}
                  </div>
                  <div className="text-xs text-muted-foreground">{account.handle}</div>
                </div>

                <div className="space-y-2">
                  <div className="text-[11px] text-muted-foreground">Unpublished plan</div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {unpublished.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No planned posts</span>
                    ) : (
                      unpublished.map((p) => (
                        <article
                          key={p.postPk}
                          className={`min-w-[170px] max-w-[170px] border rounded p-2 ${leftCardClass(p.status)}`}
                        >
                          {(p.images?.[0] ?? p.imageUrl) && (
                            <div className="w-full h-20 mb-2 rounded overflow-hidden bg-white/70">
                              <img
                                src={(p.images?.[0] ?? p.imageUrl)!}
                                alt=""
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            </div>
                          )}
                          <p className="text-[11px] line-clamp-4">{p.content}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">{formatDate(p.scheduledFor)}</p>
                          {!!p.images && p.images.length > 1 && (
                            <div className="mt-1">
                              <button
                                className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-white/70"
                                onClick={() => toggleImages(p.postPk)}
                              >
                                {expandedImages[p.postPk] ? 'Hide images' : `See ${p.images.length - 1} more image(s)`}
                              </button>
                              {expandedImages[p.postPk] && (
                                <div className="mt-1 grid grid-cols-3 gap-1">
                                  {p.images.slice(1, 4).map((img, idx) => (
                                    <div key={`${p.postPk}-${idx}`} className="h-10 rounded overflow-hidden bg-white/80">
                                      <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" />
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
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

                <div className="space-y-2 border-t border-border pt-2">
                  <div className="text-[11px] text-muted-foreground">Published</div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {published.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No published posts</span>
                    ) : (
                      published.map((p) => (
                        <article key={p.postPk} className="min-w-[170px] max-w-[170px] border border-blue-300 bg-blue-100 rounded p-2">
                          {(p.images?.[0] ?? p.imageUrl) && (
                            <div className="w-full h-20 mb-2 rounded overflow-hidden bg-white/70">
                              <img
                                src={(p.images?.[0] ?? p.imageUrl)!}
                                alt=""
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            </div>
                          )}
                          <p className="text-[11px] line-clamp-4">{p.content}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">Published {formatDate(p.publishedAt ?? p.scheduledFor)}</p>
                          {!!p.images && p.images.length > 1 && (
                            <div className="mt-1">
                              <button
                                className="text-[10px] px-1.5 py-0.5 rounded border border-blue-300 bg-white/70"
                                onClick={() => toggleImages(p.postPk)}
                              >
                                {expandedImages[p.postPk] ? 'Hide images' : `See ${p.images.length - 1} more image(s)`}
                              </button>
                              {expandedImages[p.postPk] && (
                                <div className="mt-1 grid grid-cols-3 gap-1">
                                  {p.images.slice(1, 4).map((img, idx) => (
                                    <div key={`${p.postPk}-pub-${idx}`} className="h-10 rounded overflow-hidden bg-white/80">
                                      <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" />
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </article>
                      ))
                    )}
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
