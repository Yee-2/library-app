<script setup lang="ts">
import { ref, onMounted, onActivated } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { listMyAchievements, listAllAchievements, listMyFavorites, listMyBooks, getMyReadingSummary, getUserProfile, uploadAvatar } from '@/lib/books'

const router = useRouter()
const auth = useAuthStore()
const achievements = ref<any[]>([])
const allAch = ref<any[]>([])
const favorites = ref<any[]>([])
const bookCount = ref(0)
const todaySeconds = ref(0)
const totalSeconds = ref(0)
const streak = ref(0)
const loadError = ref('')
const myProfile = ref<any>(null)
const uploadingAvatar = ref(false)
const avatarInput = ref<HTMLInputElement | null>(null)

async function refresh() {
  if (!auth.isLoggedIn) return
  loadError.value = ''
  try {
    const [mine, all, favs, books, summary, profileData] = await Promise.all([
      listMyAchievements(),
      listAllAchievements(),
      listMyFavorites(),
      listMyBooks(),
      getMyReadingSummary(365),
      getUserProfile(auth.user!.id).catch(() => ({ profile: null })),
    ])
    allAch.value = all
    achievements.value = mine
    favorites.value = favs
    bookCount.value = books.length
    myProfile.value = profileData?.profile || null
    totalSeconds.value = summary.reduce((s: number, r: any) => s + r.total_seconds, 0)
    const today = new Date().toISOString().slice(0, 10)
    const todayRow = summary.find((r: any) => r.stat_date === today)
    todaySeconds.value = todayRow?.total_seconds || 0

    // 连读
    const dates = new Set(summary.map((r: any) => r.stat_date))
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    let s = 0
    for (let i = 0; i < 60; i++) {
      const d = new Date(now); d.setDate(now.getDate() - i)
      if (dates.has(d.toISOString().slice(0, 10))) s++
      else break
    }
    streak.value = s
  } catch (e: any) {
    console.error('[me]', e)
    loadError.value = e?.message ?? '加载失败，请检查网络后重试'
  }
}

onMounted(refresh)
onActivated(refresh)

async function onAvatarChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  uploadingAvatar.value = true
  try {
    const url = await uploadAvatar(file)
    myProfile.value = { ...(myProfile.value || {}), avatar_url: url }
  } catch (err: any) {
    alert('上传失败：' + err.message)
  } finally {
    uploadingAvatar.value = false
    if (avatarInput.value) avatarInput.value.value = ''
  }
}

function fmtTime(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}小时${m}分`
  return `${m}分钟`
}

async function handleLogout() {
  await auth.signOut()
  router.push('/')
}

function openMyProfile() {
  if (auth.user) router.push(`/user/${auth.user.id}`)
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-4">
    <!-- 头部 -->
    <div class="card p-5 mb-3 bg-gradient-to-br from-brand-500 to-brand-700 text-white">
      <div class="flex items-center gap-3">
        <div class="relative group w-14 h-14">
          <div class="w-14 h-14 rounded-full bg-white/20 overflow-hidden flex items-center justify-center text-2xl font-bold cursor-pointer"
               @click="openMyProfile">
            <img v-if="myProfile?.avatar_url" :src="myProfile.avatar_url" class="w-full h-full object-cover" alt="avatar" />
            <span v-else>{{ (auth.user?.email || '?')[0].toUpperCase() }}</span>
          </div>
          <label class="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-[10px] opacity-0 group-hover:opacity-100 cursor-pointer rounded-full transition-opacity">
            {{ uploadingAvatar ? '…' : '更换' }}
            <input
              ref="avatarInput"
              type="file"
              accept="image/*"
              class="hidden"
              :disabled="uploadingAvatar"
              @change="onAvatarChange"
            />
          </label>
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-bold text-lg truncate" @click="openMyProfile">
            {{ auth.user?.email?.split('@')[0] }}
          </div>
          <div class="text-xs text-white/70 truncate">{{ auth.user?.email }}</div>
        </div>
        <button v-if="!auth.isLoggedIn" @click="router.push('/login')" class="bg-white text-brand-600 px-3 py-1.5 rounded-lg text-sm font-medium">
          登录
        </button>
        <button v-else @click="handleLogout" class="text-white/80 text-sm hover:text-white">退出</button>
      </div>

      <!-- 统计小卡 -->
      <div class="grid grid-cols-4 gap-2 mt-5 text-center">
        <div>
          <div class="text-2xl font-bold">{{ bookCount }}</div>
          <div class="text-xs text-white/70">藏书</div>
        </div>
        <div>
          <div class="text-2xl font-bold">{{ favorites.length }}</div>
          <div class="text-xs text-white/70">收藏</div>
        </div>
        <div>
          <div class="text-2xl font-bold">{{ fmtTime(todaySeconds) }}</div>
          <div class="text-xs text-white/70">今日阅读</div>
        </div>
        <div>
          <div class="text-2xl font-bold">{{ streak > 0 ? '🔥 ' + streak : streak }}</div>
          <div class="text-xs text-white/70">连读天数</div>
        </div>
      </div>
    </div>

    <!-- 菜单列表 -->
    <div v-if="auth.isLoggedIn" class="space-y-2">
      <div v-if="loadError" class="card p-4 text-center text-red-500 text-sm">{{ loadError }}</div>
      <div class="card divide-y divide-slate-100">
        <button @click="router.push('/library')" class="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
          <span class="text-xl">📚</span>
          <span class="flex-1 text-left">我的书架</span>
          <span class="text-slate-400">›</span>
        </button>
        <button @click="router.push('/favorites')" class="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
          <span class="text-xl">⭐</span>
          <span class="flex-1 text-left">我的收藏</span>
          <span class="text-slate-400">›</span>
        </button>
        <button @click="router.push('/stats')" class="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
          <span class="text-xl">📊</span>
          <span class="flex-1 text-left">阅读统计</span>
          <span class="text-slate-400">›</span>
        </button>
        <button @click="router.push('/achievements')" class="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
          <span class="text-xl">🏆</span>
          <span class="flex-1 text-left">我的成就</span>
          <span class="text-xs text-slate-500">{{ achievements.length }}/{{ allAch.length }}</span>
          <span class="text-slate-400">›</span>
        </button>
        <button @click="router.push(`/follows/following/${auth.user?.id}`)" class="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
          <span class="text-xl">👥</span>
          <span class="flex-1 text-left">我的关注</span>
          <span class="text-slate-400">›</span>
        </button>
        <button @click="openMyProfile" class="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
          <span class="text-xl">🪪</span>
          <span class="flex-1 text-left">个人主页</span>
          <span class="text-slate-400">›</span>
        </button>
      </div>

      <!-- 成就预览 -->
      <div class="card p-4">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-semibold text-sm">最近成就</h3>
          <button @click="router.push('/achievements')" class="text-xs text-brand-600">全部 ›</button>
        </div>
        <div v-if="achievements.length === 0" class="text-xs text-slate-400 py-4 text-center">
          还没解锁成就，上传一本书试试
        </div>
        <div v-else class="grid grid-cols-4 gap-2">
          <div
            v-for="a in achievements.slice(0, 4)"
            :key="a.achievement_id"
            class="text-center"
          >
            <div class="w-12 h-12 mx-auto rounded-full bg-gradient-to-br from-amber-100 to-amber-200 flex items-center justify-center text-2xl">
              {{ a.achievements?.icon || '🏆' }}
            </div>
            <div class="text-xs mt-1 line-clamp-1">{{ a.achievements?.name }}</div>
          </div>
        </div>
      </div>

      <div class="text-center text-xs text-slate-400 py-4">
        累计阅读 {{ fmtTime(totalSeconds) }}
      </div>
    </div>

    <div v-else class="text-center text-slate-500 py-10">
      <p>登录后查看更多</p>
      <button @click="router.push('/login')" class="mt-3 btn-primary">立即登录</button>
    </div>
  </div>
</template>