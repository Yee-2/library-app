<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ref, onMounted, onActivated } from 'vue'
import { listActivityFeed, listPublicBooks } from '@/lib/books'
import { useAchievementsStore } from '@/stores/achievements'
import { Search, BookOpen, Users, Trophy, BarChart3, Sparkles, Palette, Star } from 'lucide-vue-next'
import BookCard from '@/components/BookCard.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import LoginPrompt from '@/components/LoginPrompt.vue'
import { maskUsername } from '@/lib/privacy'

const auth = useAuthStore()
const router = useRouter()
const ach = useAchievementsStore()
const feed = ref<any[]>([])
const hotBooks = ref<any[]>([])
const showLoginPrompt = ref(false)

async function refresh() {
  feed.value = (await listActivityFeed(10)).slice(0, 5)
  hotBooks.value = (await listPublicBooks({ pageSize: 6 })).slice(0, 6)
}
onMounted(refresh)
onActivated(refresh)

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return Math.floor(s / 60) + '分钟前'
  if (s < 86400) return Math.floor(s / 3600) + '小时前'
  return Math.floor(s / 86400) + '天前'
}

function activityIcon(type: string) {
  if (type === 'book_shared') return BookOpen
  if (type === 'review_added') return Star
  if (type === 'achievement') return Trophy
  return Sparkles
}

function onBookClick(id: string) {
  if (!auth.isLoggedIn) { showLoginPrompt.value = true; return }
  router.push(`/book/${id}`)
}
</script>

<template>
  <div>
    <!-- Hero -->
    <section class="bg-gradient-to-br from-primary-600 via-primary-700 to-accent-600 text-white relative overflow-hidden">
      <div class="absolute top-0 right-0 w-64 h-64 rounded-full bg-white/5 blur-3xl translate-x-1/3 -translate-y-1/3" />
      <div class="absolute bottom-0 left-0 w-48 h-48 rounded-full bg-white/5 blur-3xl -translate-x-1/4 translate-y-1/4" />
      <div class="absolute -bottom-6 left-1/2 -translate-x-1/2 w-[200%] h-12 rounded-[50%] bg-white/5" />
      <div class="max-w-3xl mx-auto px-4 py-12 sm:py-16 text-center relative">
        <h1 class="text-4xl sm:text-5xl font-bold mb-2 tracking-tight">书屿</h1>
        <p class="text-base sm:text-lg text-white/80 mb-1 font-serif tracking-wide">书海一屿，随心而读</p>
        <p class="text-xs sm:text-sm text-white/60 mb-6">自定义导入 · 多端同步 · AI 听书</p>
        <div
          @click="router.push('/search')"
          class="relative w-full max-w-md mx-auto cursor-pointer"
        >
          <Search class="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-300" :stroke-width="1.75" />
          <div class="w-full h-11 pl-11 pr-4 rounded-full bg-white/95 text-sm text-slate-500 flex items-center shadow-lg hover:bg-white transition">
            搜书名、作者，探索 7 万+ 公版好书…
          </div>
        </div>
        <div class="flex items-center justify-center gap-4 mt-3 text-xs text-white/50">
          <span>古登堡计划 · 7 万+ 英文</span>
          <span class="w-1 h-1 rounded-full bg-white/30" />
          <span>维基文库 · 中文公版</span>
          <span class="w-1 h-1 rounded-full bg-white/30" />
          <span>用户分享书库</span>
        </div>
      </div>
    </section>

    <!-- 快捷入口 -->
    <section class="max-w-3xl mx-auto px-4 py-5 grid grid-cols-4 gap-2">
      <RouterLink to="/library" class="text-center group">
        <div class="w-12 h-12 mx-auto rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center mb-1.5 transition-transform group-hover:scale-110">
          <BookOpen class="w-6 h-6" :stroke-width="1.75" />
        </div>
        <div class="text-xs">书架</div>
      </RouterLink>
      <RouterLink to="/community" class="text-center group">
        <div class="w-12 h-12 mx-auto rounded-2xl bg-emerald-500/15 text-emerald-300 flex items-center justify-center mb-1.5 transition-transform group-hover:scale-110">
          <Users class="w-6 h-6" :stroke-width="1.75" />
        </div>
        <div class="text-xs">社区</div>
      </RouterLink>
      <RouterLink to="/achievements" class="text-center group">
        <div class="w-12 h-12 mx-auto rounded-2xl bg-amber-500/15 text-amber-300 flex items-center justify-center mb-1.5 transition-transform group-hover:scale-110">
          <Trophy class="w-6 h-6" :stroke-width="1.75" />
        </div>
        <div class="text-xs">成就</div>
      </RouterLink>
      <RouterLink to="/stats" class="text-center group">
        <div class="w-12 h-12 mx-auto rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center mb-1.5 transition-transform group-hover:scale-110">
          <BarChart3 class="w-6 h-6" :stroke-width="1.75" />
        </div>
        <div class="text-xs">统计</div>
      </RouterLink>
    </section>

    <!-- 热门公开书 -->
    <section class="max-w-3xl mx-auto px-4 mb-5" v-if="hotBooks.length">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-lg font-semibold tracking-tight">热门分享</h2>
        <RouterLink to="/community" class="text-xs text-primary-600 hover:underline">查看更多 ›</RouterLink>
      </div>
      <div class="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x snap-mandatory">
        <div v-for="b in hotBooks" :key="b.id" class="w-24 flex-shrink-0 snap-start">
          <BookCard :book="b" :show-format="false" :show-meta="false" @open="onBookClick" />
        </div>
      </div>
    </section>

    <!-- 动态流 -->
    <section class="max-w-3xl mx-auto px-4 mb-5" v-if="feed.length">
      <h2 class="text-lg font-semibold tracking-tight mb-3">最近动态</h2>
      <div class="space-y-2">
        <div v-for="a in feed" :key="a.id" class="card p-3 flex gap-3 items-center">
          <UserAvatar :user="a.profiles" size="sm" />
          <div class="flex-1 min-w-0">
            <div class="text-sm">
              <span class="font-medium">{{ maskUsername(a.profiles?.username) }}</span>
              <span class="text-ink-500 ml-1">
                {{ a.type === 'book_shared' ? `公开了《${a.metadata?.title}》` :
                   a.type === 'review_added' ? `打了一篇书评` :
                   '有动态' }}
              </span>
            </div>
            <div class="text-xs text-ink-300 mt-0.5">{{ timeAgo(a.created_at) }}</div>
          </div>
          <component :is="activityIcon(a.type)" class="w-4 h-4 text-ink-300 flex-shrink-0" :stroke-width="1.75" />
        </div>
      </div>
    </section>

    <!-- 功能介绍 -->
    <section class="max-w-3xl mx-auto px-4 pb-6 grid grid-cols-2 gap-3">
      <div class="card p-4 flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center flex-shrink-0">
          <BookOpen class="w-5 h-5" :stroke-width="1.75" />
        </div>
        <div>
          <h3 class="font-semibold text-sm">多格式</h3>
          <p class="text-xs text-ink-300 mt-0.5">EPUB/PDF/TXT/MOBI</p>
        </div>
      </div>
      <div class="card p-4 flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center flex-shrink-0">
          <Palette class="w-5 h-5" :stroke-width="1.75" />
        </div>
        <div>
          <h3 class="font-semibold text-sm">多字体</h3>
          <p class="text-xs text-ink-300 mt-0.5">宋楷黑 + 主题</p>
        </div>
      </div>
      <div class="card p-4 flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-300 flex items-center justify-center flex-shrink-0">
          <Sparkles class="w-5 h-5" :stroke-width="1.75" />
        </div>
        <div>
          <h3 class="font-semibold text-sm">AI 听书</h3>
          <p class="text-xs text-ink-300 mt-0.5">多音色多语速</p>
        </div>
      </div>
      <div class="card p-4 flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-rose-500/15 text-rose-400 flex items-center justify-center flex-shrink-0">
          <Trophy class="w-5 h-5" :stroke-width="1.75" />
        </div>
        <div>
          <h3 class="font-semibold text-sm">成就体系</h3>
          <p class="text-xs text-ink-300 mt-0.5">坚持阅读有奖</p>
        </div>
      </div>
    </section>

    <LoginPrompt :open="showLoginPrompt" @close="showLoginPrompt = false" />
  </div>
</template>
