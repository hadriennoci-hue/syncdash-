const BEARER = process.env.NEXT_PUBLIC_AGENT_BEARER_TOKEN ?? ''

type ApiErrorBody = {
  error?: {
    message?: string
  }
}

export async function apiFetch<T = any>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  }
  if (!headers.Authorization && BEARER) {
    headers.Authorization = `Bearer ${BEARER}`
  }

  const res = await fetch(path, {
    ...options,
    headers,
  })
  if (!res.ok) {
    const rawBody: unknown = await res.json().catch(() => undefined)
    const body: ApiErrorBody | undefined =
      rawBody && typeof rawBody === 'object' ? (rawBody as ApiErrorBody) : undefined
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`)
  }
  return (await res.json()) as T
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
