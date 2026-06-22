// src/composables/useReaderHeartbeat.ts
import { onBeforeUnmount, onMounted } from 'vue'
import { useAchievementsStore } from '@/stores/achievements'

/**
 * 阅读器心跳 composable。
 * 每 30s 上报一次估算阅读时长；标签页隐藏时停止，回到前台后恢复。
 * 退出时立即上报剩余时长。
 */
export function useReaderHeartbeat(opts: {
  getBookId: () => string | undefined
  getProgressPct: () => number
  intervalMs?: number
}) {
  const interval = opts.intervalMs ?? 30_000
  const ach = useAchievementsStore()

  let timer: ReturnType<typeof setInterval> | null = null
  let visibilityHandler: (() => void) | null = null

  function report() {
    const bookId = opts.getBookId()
    if (!bookId) return
    const now = Date.now()
    const last = ach.lastHeartbeat || now
    const seconds = Math.max(0, Math.min(600, Math.round((now - last) / 1000)))
    if (seconds > 0) {
      const wordsRead = Math.max(1, Math.round(opts.getProgressPct() * 5 / Math.max(1, seconds)))
      ach.heartbeat(bookId, wordsRead).catch((e: any) => {
        if (import.meta.env.DEV) console.error('heartbeat failed', e)
      })
    }
    ach.lastHeartbeat = now
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') {
      if (timer) { clearInterval(timer); timer = null }
    } else {
      if (!timer) timer = setInterval(report, interval)
    }
  }

  function start() {
    if (timer) return
    timer = setInterval(report, interval)
    visibilityHandler = onVisibility
    document.addEventListener('visibilitychange', visibilityHandler)
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null }
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }
    report()
  }

  onMounted(start)
  onBeforeUnmount(stop)

  return { start, stop, report }
}