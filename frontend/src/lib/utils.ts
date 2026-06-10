// src/lib/utils.ts
export function formatBytes(b: number | null | undefined) {
  if (!b) return '—'
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  return (b / 1024 / 1024).toFixed(2) + ' MB'
}

export function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function formatDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', { hour12: false })
}

export function debounce<T extends (...args: any[]) => any>(fn: T, ms = 500) {
  let timer: any
  return (...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

export function truncate(s: string, n = 100) {
  return s.length > n ? s.slice(0, n) + '…' : s
}
