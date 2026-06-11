<script setup lang="ts">
import { RouterView, RouterLink, useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useAchievementsStore } from '@/stores/achievements'
import { getUserProfile } from '@/lib/books'
import { BookOpen, BarChart3, Trophy, LogOut, Search, Home, Users } from 'lucide-vue-next'
import TabBar from '@/components/TabBar.vue'
import AchievementToast from '@/components/AchievementToast.vue'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const ach = useAchievementsStore()

const menuOpen = ref(false)
const myProfile = ref<any>(null)
const scrolled = ref(false)

const showTabBar = computed(() => !route.meta.hideTab)
const userInitial = computed(() => {
  const email = auth.user?.email
  return email ? email[0].toUpperCase() : '?'
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
  <div class="min-h-screen flex flex-col bg-slate-50">
    <!-- 顶部导航（仅在非 tab 页面显示） -->
    <header
      v-if="!showTabBar"
      class="sticky top-0 z-30 bg-white/80 backdrop-blur-md transition-shadow border-b"
      :class="scrolled ? 'shadow-sm border-slate-200/80' : 'border-transparent'"
    >
      <div class="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <RouterLink to="/" class="flex items-center gap-2 text-slate-900 font-semibold tracking-tight">
          <img src="/favicon.svg" class="w-7 h-7" alt="logo" />
          <span class="hidden sm:inline">云端图书馆</span>
        </RouterLink>

        <nav class="flex items-center gap-1 text-sm">
          <RouterLink to="/" class="btn-ghost hidden sm:inline-flex" active-class="text-brand-600">
            <Home class="w-4 h-4" :stroke-width="1.75" />
            <span class="ml-1">首页</span>
          </RouterLink>
          <RouterLink to="/library" class="btn-ghost hidden sm:inline-flex" active-class="text-brand-600">
            <BookOpen class="w-4 h-4" :stroke-width="1.75" />
            <span class="ml-1">书架</span>
          </RouterLink>
          <RouterLink to="/community" class="btn-ghost hidden sm:inline-flex" active-class="text-brand-600">
            <Users class="w-4 h-4" :stroke-width="1.75" />
            <span class="ml-1">社区</span>
          </RouterLink>

          <template v-if="auth.isLoggedIn">
            <div class="relative ml-2">
              <button
                class="w-9 h-9 rounded-full bg-brand-500 text-white text-sm font-medium flex items-center justify-center overflow-hidden ring-2 ring-white shadow-sm"
                @click="menuOpen = !menuOpen"
              >
                <img v-if="myProfile?.avatar_url" :src="myProfile.avatar_url" class="w-full h-full object-cover" alt="avatar" />
                <span v-else>{{ userInitial }}</span>
              </button>
              <Transition
                enter-active-class="transition duration-150"
                leave-active-class="transition duration-100"
                enter-from-class="opacity-0 scale-95"
                leave-to-class="opacity-0 scale-95"
              >
                <div
                  v-if="menuOpen"
                  class="absolute right-0 mt-2 w-48 bg-white/95 backdrop-blur border border-slate-200 rounded-2xl shadow-lg py-1.5 text-sm origin-top-right"
                  @click="menuOpen = false"
                >
                  <div class="px-3 py-2 text-xs text-slate-500 truncate border-b border-slate-100">
                    {{ auth.user?.email }}
                  </div>
                  <RouterLink to="/library" class="flex items-center gap-2 px-3 py-2 hover:bg-slate-50">
                    <BookOpen class="w-4 h-4 text-slate-500" :stroke-width="1.75" />我的书架
                  </RouterLink>
                  <RouterLink to="/stats" class="flex items-center gap-2 px-3 py-2 hover:bg-slate-50">
                    <BarChart3 class="w-4 h-4 text-slate-500" :stroke-width="1.75" />阅读统计
                  </RouterLink>
                  <RouterLink to="/achievements" class="flex items-center gap-2 px-3 py-2 hover:bg-slate-50">
                    <Trophy class="w-4 h-4 text-slate-500" :stroke-width="1.75" />成就
                  </RouterLink>
                  <button
                    @click="handleLogout"
                    class="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-rose-600"
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
        <transition name="fade" mode="out-in">
          <keep-alive :include="['home','library','community','me']">
            <component :is="Component" :key="r.fullPath" />
          </keep-alive>
        </transition>
      </RouterView>
    </main>

    <TabBar v-if="showTabBar" />

    <AchievementToast />

    <footer v-if="!showTabBar" class="border-t border-slate-200 py-5 text-center text-xs text-slate-400">
      © {{ new Date().getFullYear() }} 云端图书馆 · Powered by Supabase + Vercel
    </footer>
  </div>
</template>
