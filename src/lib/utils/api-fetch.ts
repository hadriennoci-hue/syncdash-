const BEARER = process.env.NEXT_PUBLIC_AGENT_BEARER_TOKEN ?? ''

export async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${BEARER}`,
      ...options?.headers,
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export async function apiPost(path: string, data: unknown) {
  return apiFetch(path, { method: 'POST', body: JSON.stringify(data) })
}

export async function apiPatch(path: string, data: unknown) {
  return apiFetch(path, { method: 'PATCH', body: JSON.stringify(data) })
}

export async function apiPut(path: string, data: unknown) {
  return apiFetch(path, { method: 'PUT', body: JSON.stringify(data) })
}

export async function apiDelete(path: string, data?: unknown) {
  return apiFetch(path, { method: 'DELETE', body: data ? JSON.stringify(data) : undefined })
}
