import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { xGetJson } from '@/lib/functions/social-x'

type XTweetResponse = {
  data?: { id: string; text: string; created_at?: string; author_id?: string }
  includes?: { users?: Array<{ id: string; name: string; username: string }> }
  errors?: Array<{ detail?: string; message?: string }>
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const tweetId = params.id
  if (!/^\d+$/.test(tweetId)) {
    return apiError('VALIDATION_ERROR', 'Invalid tweet id', 400)
  }

  const url = `https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=text,created_at,author_id&expansions=author_id&user.fields=name,username`

  let result: XTweetResponse
  try {
    result = await xGetJson<XTweetResponse>('komputerzz_x', url)
  } catch (err) {
    return apiError('UPSTREAM_ERROR', err instanceof Error ? err.message : 'X API error', 502)
  }

  if (!result.data) {
    return apiError('NOT_FOUND', 'Tweet not found', 404)
  }

  const author = result.includes?.users?.find((u) => u.id === result.data!.author_id)

  return apiResponse({
    id: result.data.id,
    text: result.data.text,
    createdAt: result.data.created_at ?? null,
    authorName: author?.name ?? null,
    authorUsername: author?.username ?? null,
  })
}
