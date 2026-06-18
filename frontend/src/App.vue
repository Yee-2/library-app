<script setup lang="ts">
import { RouterView, RouterLink, useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useAchievementsStore } from '@/stores/achievements'
import { getUserProfile } from '@/lib/books'
import { BookOpen, BarChart3, Trophy, LogOut, Search, Home, Users, Sparkles, Sun, Moon } from 'lucide-vue-next'
import TabBar from '@/components/TabBar.vue'
import AchievementToast from '@/components/AchievementToast.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import ToastHost from '@/components/ToastHost.vue'
import { maskEmail } from '@/lib/privacy'
import { useTheme } from '@/composables/useTheme'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const ach = useAchievementsStore()
const { theme, toggle: toggleTheme } = useTheme()

const menuOpen = ref(false)
const myProfile = ref<any>(null)
const scrolled = ref(false)

const showTabBar = computed(() => !route.meta.hideTab)
// 严格不读取 email 作为头像 fallback - 优先使用 username
const avatarInitial = computed(() => {
  const name = myProfile.value?.username?.trim()
  return name ? name[0].toUpperCase() : '?'
})

function onScroll() {
  scrolled.value = window.scrollY > 4
}

async function loadMyProfile() {
  if (auth.isLoggedIn && auth.user) {
    try {
      const { profile } = await getUserProfile(auth.user.id)
      myProfile.value = profile
    } catch { myProfile.value = null }
  } else {
    myProfile.value = null
  }
}

async function handleLogout() {
  await auth.signOut()
  myProfile.value = null
  menuOpen.value = false
  router.push('/')
}

watch(() => auth.isLoggedIn, loadMyProfile)

onMounted(async () => {
  await loadMyProfile()
  if (auth.isLoggedIn) {
    await ach.init()
    ach.checkAll()
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
})
</script>

<template>
  <div class="min-h-screen flex flex-col bg-ink-900">
    <!-- 顶部导航（仅在非 tab 页面显示） -->
    <header
      v-if="!showTabBar"
      class="sticky top-0 z-30 glass-panel transition-shadow border-b"
      :class="scrolled ? 'shadow-sm border-neon-purple/20' : 'border-transparent'"
    >
      <div class="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <RouterLink to="/" class="flex items-center gap-2 text-ink-50 font-semibold tracking-tight">
          <img src="/favicon.svg" class="w-7 h-7 drop-shadow-[0_0_8px_rgba(168,85,247,0.7)]" alt="logo" />
          <span class="hidden sm:inline neon-text-purple">云端图书馆</span>
        </RouterLink>

        <nav class="flex items-center gap-1 text-sm">
          <RouterLink to="/" class="btn-ghost hidden sm:inline-flex" active-class="text-neon-purple">
            <Home class="w-4 h-4" :stroke-width="1.75" />
            <span class="ml-1">首页</span>
          </RouterLink>
          <RouterLink to="/library" class="btn-ghost hidden sm:inline-flex" active-class="text-neon-purple">
            <BookOpen class="w-4 h-4" :stroke-width="1.75" />
            <span class="ml-1">书架</span>
          </RouterLink>
          <RouterLink to="/community" class="btn-ghost hidden sm:inline-flex" active-class="text-neon-purple">
            <Users class="w-4 h-4" :stroke-width="1.75" />
            <span class="ml-1">社区</span>
          </RouterLink>

          <!-- 主题切换 -->
          <button
            class="btn-icon btn-ghost ml-1"
            :title="theme === 'dark' ? '切换到白天' : '切换到暗黑'"
            @click="toggleTheme"
          >
            <Transition
              enter-active-class="transition duration-200"
              leave-active-class="transition duration-150"
              enter-from-class="opacity-0 rotate-90"
              leave-to-class="opacity-0 -rotate-90"
              mode="out-in"
            >
              <Sun v-if="theme === 'dark'" key="sun" class="w-4 h-4" :stroke-width="1.75" />
              <Moon v-else key="moon" class="w-4 h-4" :stroke-width="1.75" />
            </Transition>
          </button>

          <template v-if="auth.isLoggedIn">
            <div class="relative ml-2">
              <button
                class="rounded-full overflow-hidden flex items-center justify-center text-white font-semibold
                       bg-gradient-to-br from-neon-purple to-neon-pink
                       w-9 h-9 ring-2 ring-white/15 shadow-lg
                       hover:scale-105 hover:shadow-[0_0_18px_rgba(168,85,247,0.6)] transition-all"
                :title="myProfile?.username ? `${myProfile.username} (${maskEmail(auth.user?.email)})` : '点击设置昵称'"
                @click="menuOpen = !menuOpen"
              >
                <img v-if="myProfile?.avatar_url" :src="myProfile.avatar_url" class="w-full h-full object-cover" alt="avatar" />
                <span v-else>{{ avatarInitial }}</span>
              </button>
              <Transition
                enter-active-class="transition duration-150"
                leave-active-class="transition duration-100"
                enter-from-class="opacity-0 scale-95"
                leave-to-class="opacity-0 scale-95"
              >
                <div
                  v-if="menuOpen"
                  class="absolute right-0 mt-2 w-56 glass-panel rounded-2xl shadow-2xl py-1.5 text-sm origin-top-right z-50"
                  @click="menuOpen = false"
                >
                  <div class="px-3 py-2 border-b border-neon-purple/15">
                    <div class="text-sm font-medium text-ink-50 truncate">
                      {{ myProfile?.username || '未设置昵称' }}
                    </div>
                    <div class="text-xs text-ink-300 truncate mt-0.5">
                      {{ maskEmail(auth.user?.email) }}
                    </div>
                  </div>
                  <RouterLink v-if="!myProfile?.username" to="/me" class="flex items-center gap-2 px-3 py-2 hover:bg-neon-purple/10 text-neon-purple">
                    <Sparkles class="w-4 h-4" :stroke-width="1.75" />设置昵称
                  </RouterLink>
                  <RouterLink to="/library" class="flex items-center gap-2 px-3 py-2 hover:bg-neon-purple/10 text-ink-100">
                    <BookOpen class="w-4 h-4 text-ink-300" :stroke-width="1.75" />我的书架
                  </RouterLink>
                  <RouterLink to="/stats" class="flex items-center gap-2 px-3 py-2 hover:bg-neon-purple/10 text-ink-100">
                    <BarChart3 class="w-4 h-4 text-ink-300" :stroke-width="1.75" />阅读统计
                  </RouterLink>
                  <RouterLink to="/achievements" class="flex items-center gap-2 px-3 py-2 hover:bg-neon-purple/10 text-ink-100">
                    <Trophy class="w-4 h-4 text-ink-300" :stroke-width="1.75" />成就
                  </RouterLink>
                  <button
                    @click="handleLogout"
                    class="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-rose-500/10 text-rose-400"
                  >
                    <LogOut class="w-4 h-4" :stroke-width="1.75" />退出登录
                  </button>
                </div>
              </Transition>
            </div>
          </template>
          <template v-else>
            <RouterLink to="/login" class="btn-primary ml-2">登录</RouterLink>
          </template>
        </nav>
      </div>
    </header>

    <main class="flex-1" :class="{ 'pb-20': showTabBar }">
      <RouterView v-slot="{ Component, route: r }">
        <transition name="fade-slide" mode="out-in">
          <keep-alive :include="['home','library','community','me']">
            <!-- 用 route.name 做 key，避免 query 变化时重建组件破坏 keep-alive -->
            <component :is="Component" :key="(r.name as string) || r.path" />
          </keep-alive>
        </transition>
      </RouterView>
    </main>

    <TabBar v-if="showTabBar" />

    <AchievementToast />
    <ToastHost />

    <footer v-if="!showTabBar" class="border-t border-neon-purple/15 py-5 text-center text-xs text-ink-300">
      © {{ new Date().getFullYear() }} 云端图书馆 · Powered by Supabase + Vercel
    </footer>
  </div>
</template>
