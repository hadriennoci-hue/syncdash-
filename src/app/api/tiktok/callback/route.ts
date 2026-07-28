import { NextRequest } from 'next/server'
import { exchangeAuthCode, stateMatches } from '@/lib/functions/tiktok-auth'
import { logOperation } from '@/lib/functions/log'

/**
 * GET /api/tiktok/callback
 *
 * OAuth redirect target for our TikTok Shop custom dev app. TikTok appends the
 * authorization `code` (+ `state`) after the seller approves. We verify `state`
 * (CSRF, if TIKTOK_OAUTH_STATE is configured), exchange the code for access +
 * refresh tokens, and store them in D1 `platform_tokens` (platform='tiktok_shop').
 *
 * This is a browser redirect endpoint (no bearer auth); security is the single-use
 * auth_code bound to our app_key plus the state check. Routed entirely through Wizhard
 * per the revised TikTok access rule.
 */
function page(title: string, body: string, ok: boolean): Response {
  const color = ok ? '#137333' : '#b3261e'
  const html = `<!doctype html><meta charset="utf-8"><title>${title}</title>
<div style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
  <h1 style="color:${color};font-size:1.25rem">${title}</h1>
  <p style="color:#444;line-height:1.5">${body}</p>
</div>`
  return new Response(html, { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  const apiError = searchParams.get('error') || searchParams.get('error_description')
  if (apiError) {
    return page('TikTok authorization was declined', `TikTok returned: ${apiError}`, false)
  }
  if (!code) {
    return page('Missing authorization code', 'No <code>code</code> parameter was present on the callback.', false)
  }
  if (!stateMatches(state, process.env.TIKTOK_OAUTH_STATE)) {
    return page('State check failed', 'The <code>state</code> value did not match. Start the authorization again.', false)
  }

  try {
    const result = await exchangeAuthCode(code)
    await logOperation({
      platform: 'tiktok_shop',
      action: 'create',
      status: 'success',
      message: `TikTok authorized${result.seller_name ? ` for ${result.seller_name}` : ''}; token expires ${result.expiresAt}`,
      triggeredBy: 'human',
    }).catch(() => {})
    return page(
      'TikTok Shop connected ✓',
      `Access token stored${result.seller_name ? ` for <b>${result.seller_name}</b>` : ''}. You can close this tab.`,
      true,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    await logOperation({ platform: 'tiktok_shop', action: 'create', status: 'error', message, triggeredBy: 'human' }).catch(() => {})
    return page('Token exchange failed', message, false)
  }
}
