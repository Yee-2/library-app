<script setup lang="ts">
import { RouterView, RouterLink, useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { computed, ref, onMounted } from 'vue'
import { useAchievementsStore } from '@/stores/achievements'
import TabBar from '@/components/TabBar.vue'
import AchievementToast from '@/components/AchievementToast.vue'
import { Analytics } from '@vercel/analytics/vue'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const ach = useAchievementsStore()

const menuOpen = ref(false)

const showTabBar = computed(() => !route.meta.hideTab)
const userInitial = computed(() => {
  const email = auth.user?.email
  return email ? email[0].toUpperCase() : '?'
})

async function handleLogout() {
  await auth.signOut()
  menuOpen.value = false
  router.push('/')
}

onMounted(async () => {
  if (auth.isLoggedIn) {
    await ach.init()
    ach.checkAll()
  }
})
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- 顶部导航（仅在非 tab 页面显示） -->
    <header v-if="!showTabBar" class="sticky top-0 z-30 bg-white/85 backdrop-blur border-b border-slate-200">
      <div class="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <RouterLink to="/" class="flex items-center gap-2 text-brand-600 font-semibold">
          <img src="/favicon.svg" class="w-7 h-7" alt="logo" />
          <span class="hidden sm:inline">云端图书馆</span>
        </RouterLink>

        <nav class="flex items-center gap-1 text-sm">
          <RouterLink to="/" class="btn-ghost hidden sm:inline-flex">首页</RouterLink>
          <RouterLink to="/library" class="btn-ghost hidden sm:inline-flex">我的书架</RouterLink>
          <RouterLink to="/community" class="btn-ghost hidden sm:inline-flex">社区</RouterLink>

          <template v-if="auth.isLoggedIn">
            <div class="relative ml-2">
              <button
                class="w-8 h-8 rounded-full bg-brand-500 text-white text-sm font-medium flex items-center justify-center"
                @click="menuOpen = !menuOpen"
              >
                {{ userInitial }}
              </button>
              <div
                v-if="menuOpen"
                class="absolute right-0 mt-2 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1 text-sm"
                @click="menuOpen = false"
              >
                <div class="px-3 py-2 text-xs text-slate-500 truncate border-b border-slate-100">
                  {{ auth.user?.email }}
                </div>
                <RouterLink to="/library" class="block px-3 py-2 hover:bg-slate-50">我的书架</RouterLink>
                <RouterLink to="/stats" class="block px-3 py-2 hover:bg-slate-50">阅读统计</RouterLink>
                <RouterLink to="/achievements" class="block px-3 py-2 hover:bg-slate-50">成就</RouterLink>
                <button
                  @click="handleLogout"
                  class="w-full text-left px-3 py-2 hover:bg-slate-50 text-red-600"
                >
                  退出登录
                </button>
              </div>
            </div>
          </template>
          <template v-else>
            <RouterLink to="/login" class="btn-primary ml-2">登录</RouterLink>
          </template>
        </nav>
      </div>
    </header>

    <!-- 主体：tab 页面 keep-alive -->
    <main class="flex-1" :class="{ 'pb-20': showTabBar }">
      <RouterView v-slot="{ Component, route: r }">
        <transition name="fade" mode="out-in">
          <keep-alive :include="['home','library','community','me']">
            <component :is="Component" :key="r.fullPath" />
          </keep-alive>
        </transition>
      </RouterView>
    </main>

    <!-- 底部 TabBar -->
    <TabBar v-if="showTabBar" />

    <!-- 全局成就提示 -->
    <AchievementToast />

    <footer v-if="!showTabBar" class="border-t border-slate-200 py-4 text-center text-xs text-slate-400">
      © {{ new Date().getFullYear() }} 云端图书馆 · Powered by Supabase + Vercel
    </footer>

    <!-- Vercel Web Analytics -->
    <Analytics />
  </div>
</template>