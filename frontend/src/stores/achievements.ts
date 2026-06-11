// src/stores/achievements.ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { unlockAchievement, listMyAchievements, listAllAchievements, reportReadingHeartbeat } from '@/lib/books'
import { supabase } from '@/lib/supabase'

export const useAchievementsStore = defineStore('achievements', () => {
  const unlocked = ref<Set<string>>(new Set())
  const all = ref<Array<{ id: string; name: string; description: string; icon: string | null; threshold: number }>>([])
  const toastQueue = ref<Array<{ id: string; name: string; icon: string | null }>>([])
  const lastHeartbeat = ref(0)
  const lastScrollY = ref(0)

  async function init() {
    all.value = await listAllAchievements()
    const mine = await listMyAchievements()
    unlocked.value = new Set(mine.map((m: any) => m.achievement_id))
  }

  async function tryUnlock(id: string) {
    if (unlocked.value.has(id)) return
    const ok = await unlockAchievement(id)
    if (ok) {
      unlocked.value.add(id)
      const a = all.value.find(x => x.id === id)
      if (a) toastQueue.value.push({ id, name: a.name, icon: a.icon })
    }
  }

  /** 阅读心跳：每 30 秒调用一次 */
  async function heartbeat(bookId: string, wordsRead: number) {
    const now = Date.now()
    const seconds = Math.max(1, Math.round((now - lastHeartbeat.value) / 1000))
    lastHeartbeat.value = now
    if (seconds < 15) return   // 太短不上报
    await reportReadingHeartbeat(bookId, seconds, wordsRead)

    // 自动判断成就
    await checkAll()
  }

  /** 重新计算并解锁所有可达成的成就 */
  async function checkAll() {
    // 1. first_book / share_1：看 books 是否至少一本
    const { count: bookCount } = await supabase.from('books').select('*', { count: 'exact', head: true })
    if ((bookCount ?? 0) >= 1) await tryUnlock('first_book')

    // 2. share_1：至少一本公开的
    const { count: pubCount } = await supabase.from('books').select('*', { count: 'exact', head: true }).eq('is_public', true)
    if ((pubCount ?? 0) >= 1) await tryUnlock('share_1')

    // 3. pages_100 / pages_1000：累计阅读字数（粗略按 500 字/页换算）
    const { data: stats } = await supabase.from('reading_stats').select('total_words')
    const totalWords = (stats ?? []).reduce((s: number, r: any) => s + (r.total_words || 0), 0)
    const totalPages = Math.floor(totalWords / 500)
    if (totalPages >= 100) await tryUnlock('pages_100')
    if (totalPages >= 1000) await tryUnlock('pages_1000')

    // 4. note_10
    const { count: noteCount } = await supabase.from('notes').select('*', { count: 'exact', head: true })
    if ((noteCount ?? 0) >= 10) await tryUnlock('note_10')

    // 5. streak_7 / streak_30
    const { data: daily } = await supabase
      .from('reading_stats')
      .select('stat_date')
      .order('stat_date', { ascending: false })
      .limit(60)
    if (daily && daily.length > 0) {
      const streak = computeStreak(daily.map((d: any) => d.stat_date))
      if (streak >= 7) await tryUnlock('streak_7')
      if (streak >= 30) await tryUnlock('streak_30')
    }

    // 6. follower_5
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { count: followers } = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('followee_id', user.id)
      if ((followers ?? 0) >= 5) await tryUnlock('follower_5')
    }
  }

  function computeStreak(dates: string[]): number {
    if (dates.length === 0) return 0
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    let streak = 0
    const dateSet = new Set(dates)
    for (let i = 0; i < 60; i++) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      if (dateSet.has(key)) streak++
      else if (i > 0) break
      else return 0   // 今天没阅读就 streak = 0
    }
    return streak
  }

  function consumeToast() {
    return toastQueue.value.shift()
  }

  return { unlocked, all, toastQueue, lastHeartbeat, init, tryUnlock, checkAll, heartbeat, consumeToast }
})