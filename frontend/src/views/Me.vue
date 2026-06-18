<script setup lang="ts">
import { ref, computed, onMounted, onActivated } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { listMyAchievements, listAllAchievements, listMyFavorites, listMyBooks, getMyReadingSummary, getUserProfile, uploadAvatar } from '@/lib/books'
import { BookOpen, Star, BarChart3, Trophy, UserRound, IdCard, Flame, LogOut, Upload, ChevronRight, Sparkles } from 'lucide-vue-next'
import UserAvatar from '@/components/UserAvatar.vue'
import NicknamePrompt from '@/components/NicknamePrompt.vue'
import { isEmailLikeUsername, maskEmail } from '@/lib/privacy'

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
const showNicknamePrompt = ref(false)

const needsNickname = computed(() =>
  isEmailLikeUsername(myProfile.value?.username, auth.user?.email)
)

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

function onNicknameUpdated(name: string) {
  myProfile.value = { ...(myProfile.value || {}), username: name }
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
    <div class="card p-5 mb-3 bg-gradient-to-br from-neon-purple via-fuchsia-600 to-neon-pink text-white relative overflow-hidden">
      <div class="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
      <div class="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
      <div class="flex items-center gap-3 relative">
        <div class="relative group w-16 h-16">
          <div class="w-16 h-16 rounded-full overflow-hidden cursor-pointer ring-4 ring-white/30 shadow-md relative"
               @click="openMyProfile">
            <UserAvatar :user="myProfile" size="lg" />
          </div>
          <label class="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-[10px] opacity-0 group-hover:opacity-100 cursor-pointer rounded-full transition-opacity">
            <Upload class="w-3.5 h-3.5 mr-0.5" :stroke-width="1.75" />
            <span>{{ uploadingAvatar ? '上传中' : '更换' }}</span>
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
            {{ myProfile?.username || '未设置昵称' }}
          </div>
          <div class="text-xs text-white/70 truncate">{{ maskEmail(auth.user?.email) }}</div>
        </div>
        <button v-if="!auth.isLoggedIn" @click="router.push('/login')" class="bg-ink-50 text-neon-purple px-3 py-1.5 rounded-lg text-sm font-medium">
          登录
        </button>
        <button v-else @click="handleLogout" class="text-white/80 text-sm hover:text-white flex items-center gap-1">
          <LogOut class="w-3.5 h-3.5" :stroke-width="1.75" />
          退出
        </button>
      </div>

      <!-- 昵称引导条 -->
      <div
        v-if="auth.isLoggedIn && needsNickname"
        class="mt-4 flex items-center gap-2 px-3 py-2 rounded-xl
               bg-amber-400/20 border border-amber-300/40 backdrop-blur-sm text-amber-50 text-sm"
      >
        <Sparkles class="w-4 h-4 text-amber-200 flex-shrink-0" :stroke-width="1.75" />
        <span class="flex-1">设置一个昵称，让社区认识你</span>
        <button
          @click="showNicknamePrompt = true"
          class="px-2.5 py-1 rounded-lg bg-amber-300 text-amber-900 text-xs font-medium hover:bg-amber-300"
        >设置</button>
      </div>

      <!-- 统计小卡 -->
      <div class="grid grid-cols-4 gap-2 mt-4 text-center relative">
        <div class="rounded-xl bg-white/15 backdrop-blur-sm py-2.5">
          <div class="text-xl font-bold">{{ bookCount }}</div>
          <div class="text-xs text-white/70">藏书</div>
        </div>
        <div class="rounded-xl bg-white/15 backdrop-blur-sm py-2.5">
          <div class="text-xl font-bold">{{ favorites.length }}</div>
          <div class="text-xs text-white/70">收藏</div>
        </div>
        <div class="rounded-xl bg-white/15 backdrop-blur-sm py-2.5">
          <div class="text-xl font-bold">{{ fmtTime(todaySeconds) }}</div>
          <div class="text-xs text-white/70">今日阅读</div>
        </div>
        <div class="rounded-xl bg-white/15 backdrop-blur-sm py-2.5">
          <div class="text-xl font-bold flex items-center justify-center gap-1">
            <Flame v-if="streak > 0" class="w-4 h-4 text-amber-300" :fill="'currentColor'" :stroke-width="1.75" />
            <span>{{ streak }}</span>
          </div>
          <div class="text-xs text-white/70">连读天数</div>
        </div>
      </div>
    </div>

    <!-- 菜单列表 -->
    <div v-if="auth.isLoggedIn" class="space-y-2">
      <div v-if="loadError" class="card p-4 text-center text-rose-400 text-sm">{{ loadError }}</div>
      <div class="card divide-y divide-neon-purple/15">
        <button @click="router.push('/library')" class="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-ink-900 active:bg-ink-800/60 transition">
          <span class="w-9 h-9 rounded-xl bg-neon-purple/15 text-neon-purple flex items-center justify-center flex-shrink-0">
            <BookOpen class="w-5 h-5" :stroke-width="1.75" />
          </span>
          <span class="flex-1 text-left">我的书架</span>
          <ChevronRight class="w-4 h-4 text-ink-300" :stroke-width="1.75" />
        </button>
        <button @click="router.push('/favorites')" class="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-ink-900 active:bg-ink-800/60 transition">
          <span class="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-300 flex items-center justify-center flex-shrink-0">
            <Star class="w-5 h-5" :fill="'currentColor'" :stroke-width="1.75" />
          </span>
          <span class="flex-1 text-left">我的收藏</span>
          <ChevronRight class="w-4 h-4 text-ink-300" :stroke-width="1.75" />
        </button>
        <button @click="router.push('/stats')" class="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-ink-900 active:bg-ink-800/60 transition">
          <span class="w-9 h-9 rounded-xl bg-neon-purple/15 text-neon-purple flex items-center justify-center flex-shrink-0">
            <BarChart3 class="w-5 h-5" :stroke-width="1.75" />
          </span>
          <span class="flex-1 text-left">阅读统计</span>
          <ChevronRight class="w-4 h-4 text-ink-300" :stroke-width="1.75" />
        </button>
        <button @click="router.push('/achievements')" class="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-ink-900 active:bg-ink-800/60 transition">
          <span class="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-300 flex items-center justify-center flex-shrink-0">
            <Trophy class="w-5 h-5" :stroke-width="1.75" />
          </span>
          <span class="flex-1 text-left">我的成就</span>
          <span class="text-xs text-ink-300">{{ achievements.length }}/{{ allAch.length }}</span>
          <ChevronRight class="w-4 h-4 text-ink-300" :stroke-width="1.75" />
        </button>
        <button @click="router.push(`/follows/following/${auth.user?.id}`)" class="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-ink-900 active:bg-ink-800/60 transition">
          <span class="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-300 flex items-center justify-center flex-shrink-0">
            <UserRound class="w-5 h-5" :stroke-width="1.75" />
          </span>
          <span class="flex-1 text-left">我的关注</span>
          <ChevronRight class="w-4 h-4 text-ink-300" :stroke-width="1.75" />
        </button>
        <button @click="openMyProfile" class="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-ink-900 active:bg-ink-800/60 transition">
          <span class="w-9 h-9 rounded-xl bg-neon-purple/15 text-neon-purple flex items-center justify-center flex-shrink-0">
            <IdCard class="w-5 h-5" :stroke-width="1.75" />
          </span>
          <span class="flex-1 text-left">个人主页</span>
          <ChevronRight class="w-4 h-4 text-ink-300" :stroke-width="1.75" />
        </button>
      </div>

      <!-- 成就预览 -->
      <div class="card p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold text-sm">最近成就</h3>
          <button @click="router.push('/achievements')" class="text-xs text-neon-purple hover:underline">全部 ›</button>
        </div>
        <div v-if="achievements.length === 0" class="text-xs text-ink-300 py-4 text-center">
          还没解锁成就，上传一本书试试
        </div>
        <div v-else class="grid grid-cols-4 gap-3">
          <div
            v-for="a in achievements.slice(0, 4)"
            :key="a.achievement_id"
            class="text-center"
          >
            <div class="w-12 h-12 mx-auto rounded-full bg-gradient-to-br from-amber-500/25 to-amber-400/15 flex items-center justify-center ring-2 ring-white/15 shadow-sm">
              <span v-if="a.achievements?.icon" class="text-2xl">{{ a.achievements.icon }}</span>
              <Trophy v-else class="w-6 h-6 text-amber-300" :stroke-width="2" />
            </div>
            <div class="text-xs mt-1.5 line-clamp-1">{{ a.achievements?.name }}</div>
          </div>
        </div>
      </div>

      <div class="text-center text-xs text-ink-300 py-4">
        累计阅读 {{ fmtTime(totalSeconds) }}
      </div>
    </div>

    <div v-else class="text-center py-16">
      <BookOpen class="w-16 h-16 mx-auto text-ink-300 mb-3" :stroke-width="1.5" />
      <p class="text-ink-300 mb-4">登录后查看更多</p>
      <button @click="router.push('/login')" class="btn-primary">立即登录</button>
    </div>

    <NicknamePrompt :open="showNicknamePrompt" @close="showNicknamePrompt = false" @updated="onNicknameUpdated" />
  </div>
</template>