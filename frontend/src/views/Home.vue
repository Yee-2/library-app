<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ref, onMounted, onActivated } from 'vue'
import { listActivityFeed, listPublicBooks } from '@/lib/books'
import { useAchievementsStore } from '@/stores/achievements'
import { Search, BookOpen, Users, Trophy, BarChart3, Sparkles, Palette, Star } from 'lucide-vue-next'
import BookCard from '@/components/BookCard.vue'

const auth = useAuthStore()
const router = useRouter()
const ach = useAchievementsStore()
const feed = ref<any[]>([])
const hotBooks = ref<any[]>([])

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
</script>

<template>
  <div>
    <!-- Hero -->
    <section class="bg-gradient-to-br from-brand-400 via-brand-500 to-brand-700 text-white relative overflow-hidden">
      <div class="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-white/10 blur-3xl" />
      <div class="absolute -bottom-12 -left-12 w-40 h-40 rounded-full bg-white/10 blur-3xl" />
      <div class="max-w-3xl mx-auto px-4 py-10 sm:py-14 text-center relative">
        <h1 class="text-3xl sm:text-4xl font-bold mb-2 tracking-tight">云端图书馆</h1>
        <p class="text-sm sm:text-base text-white/85 mb-6">自定义导入 · 多端同步 · AI 听书 · 读者社区</p>
        <div
          @click="router.push('/search')"
          class="relative w-full max-w-md mx-auto cursor-pointer"
        >
          <Search class="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" :stroke-width="1.75" />
          <div class="w-full h-11 pl-11 pr-4 rounded-full bg-white text-sm text-slate-400 flex items-center shadow-lg">
            搜书名、作者、关键词…
          </div>
        </div>
      </div>
    </section>

    <!-- 快捷入口 -->
    <section class="max-w-3xl mx-auto px-4 py-5 grid grid-cols-4 gap-2">
      <RouterLink to="/library" class="text-center group">
        <div class="w-12 h-12 mx-auto rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mb-1.5 transition-transform group-hover:scale-110">
          <BookOpen class="w-6 h-6" :stroke-width="1.75" />
        </div>
        <div class="text-xs">书架</div>
      </RouterLink>
      <RouterLink to="/community" class="text-center group">
        <div class="w-12 h-12 mx-auto rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-1.5 transition-transform group-hover:scale-110">
          <Users class="w-6 h-6" :stroke-width="1.75" />
        </div>
        <div class="text-xs">社区</div>
      </RouterLink>
      <RouterLink to="/achievements" class="text-center group">
        <div class="w-12 h-12 mx-auto rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-1.5 transition-transform group-hover:scale-110">
          <Trophy class="w-6 h-6" :stroke-width="1.75" />
        </div>
        <div class="text-xs">成就</div>
      </RouterLink>
      <RouterLink to="/stats" class="text-center group">
        <div class="w-12 h-12 mx-auto rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center mb-1.5 transition-transform group-hover:scale-110">
          <BarChart3 class="w-6 h-6" :stroke-width="1.75" />
        </div>
        <div class="text-xs">统计</div>
      </RouterLink>
    </section>

    <!-- 热门公开书 -->
    <section class="max-w-3xl mx-auto px-4 mb-5" v-if="hotBooks.length">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-lg font-semibold tracking-tight">热门分享</h2>
        <RouterLink to="/community" class="text-xs text-brand-600 hover:underline">查看更多 ›</RouterLink>
      </div>
      <div class="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x snap-mandatory">
        <div v-for="b in hotBooks" :key="b.id" class="w-24 flex-shrink-0 snap-start">
          <BookCard :book="b" :show-format="false" :show-meta="false" @open="(id) => router.push(`/book/${id}`)" />
        </div>
      </div>
    </section>

    <!-- 动态流 -->
    <section class="max-w-3xl mx-auto px-4 mb-5" v-if="feed.length">
      <h2 class="text-lg font-semibold tracking-tight mb-3">最近动态</h2>
      <div class="space-y-2">
        <div v-for="a in feed" :key="a.id" class="card p-3 flex gap-3 items-center">
          <div class="w-9 h-9 rounded-full overflow-hidden bg-gradient-to-br from-brand-400 to-brand-600 text-white flex items-center justify-center text-xs font-medium flex-shrink-0">
            <img v-if="a.profiles?.avatar_url" :src="a.profiles.avatar_url" class="w-full h-full object-cover" alt="avatar" />
            <span v-else>{{ (a.profiles?.username || '?')[0].toUpperCase() }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm">
              <span class="font-medium">{{ a.profiles?.username || '匿名' }}</span>
              <span class="text-slate-600 ml-1">
                {{ a.type === 'book_shared' ? `公开了《${a.metadata?.title}》` :
                   a.type === 'review_added' ? `打了一篇书评` :
                   '有动态' }}
              </span>
            </div>
            <div class="text-xs text-slate-400 mt-0.5">{{ timeAgo(a.created_at) }}</div>
          </div>
          <component :is="activityIcon(a.type)" class="w-4 h-4 text-slate-300 flex-shrink-0" :stroke-width="1.75" />
        </div>
      </div>
    </section>

    <!-- 功能介绍 -->
    <section class="max-w-3xl mx-auto px-4 pb-6 grid grid-cols-2 gap-3">
      <div class="card p-4 flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
          <BookOpen class="w-5 h-5" :stroke-width="1.75" />
        </div>
        <div>
          <h3 class="font-semibold text-sm">多格式</h3>
          <p class="text-xs text-slate-500 mt-0.5">EPUB/PDF/TXT/MOBI</p>
        </div>
      </div>
      <div class="card p-4 flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center flex-shrink-0">
          <Palette class="w-5 h-5" :stroke-width="1.75" />
        </div>
        <div>
          <h3 class="font-semibold text-sm">多字体</h3>
          <p class="text-xs text-slate-500 mt-0.5">宋楷黑 + 主题</p>
        </div>
      </div>
      <div class="card p-4 flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0">
          <Sparkles class="w-5 h-5" :stroke-width="1.75" />
        </div>
        <div>
          <h3 class="font-semibold text-sm">AI 听书</h3>
          <p class="text-xs text-slate-500 mt-0.5">多音色多语速</p>
        </div>
      </div>
      <div class="card p-4 flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center flex-shrink-0">
          <Trophy class="w-5 h-5" :stroke-width="1.75" />
        </div>
        <div>
          <h3 class="font-semibold text-sm">成就体系</h3>
          <p class="text-xs text-slate-500 mt-0.5">坚持阅读有奖</p>
        </div>
      </div>
    </section>
  </div>
</template>
