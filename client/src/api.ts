const API = import.meta.env.VITE_API_URL || ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`)
  return data as T
}

export const api = {
  rates: () => request<{ usd: number; eur: number; rub: number; date: string; source: string }>('/api/rates'),
  sources: (category: string, signal?: AbortSignal) =>
    request<import('./types').Source[]>(`/api/sources?category=${category}`, { signal }),
  listings: (category: string, signal?: AbortSignal) =>
    request<import('./types').Listing[]>(`/api/listings?category=${category}`, { signal }),
  stats: (category: string, period = 'days') =>
    request<import('./types').Stats>(`/api/stats?category=${category}&period=${period}`),
  addSource: (url: string, category: string) =>
    request<{ source: import('./types').Source }>('/api/sources', {
      method: 'POST',
      body: JSON.stringify({ url, category }),
    }),
  deleteSource: (id: string) => request<void>(`/api/sources/${id}`, { method: 'DELETE' }),
  deleteListing: (id: string) => request<void>(`/api/listings/${id}`, { method: 'DELETE' }),
  parse: (category: string) =>
    request<{ results: { count: number; error?: string }[] }>('/api/parse', {
      method: 'POST',
      body: JSON.stringify({ category }),
    }),
}
