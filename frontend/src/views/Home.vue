<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ref, onMounted, onActivated } from 'vue'
import { listActivityFeed, listPublicBooks } from '@/lib/books'
import { useAchievementsStore } from '@/stores/achievements'

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
</script>

<template>
  <div>
    <!-- Hero -->
    <section class="bg-gradient-to-br from-brand-500 to-brand-700 text-white">
      <div class="max-w-3xl mx-auto px-4 py-10 sm:py-14 text-center">
        <h1 class="text-3xl sm:text-4xl font-bold mb-2">云端图书馆</h1>
        <p class="text-sm sm:text-base text-brand-50/90 mb-5">自定义导入 · 多端同步 · AI 听书 · 读者社区</p>
        <input
          @click="router.push('/search')"
          readonly
          placeholder="🔍 搜书名、作者、关键词…"
          class="w-full max-w-md mx-auto px-4 py-2.5 rounded-full text-slate-800 text-sm placeholder:text-slate-400 cursor-pointer"
        />
      </div>
    </section>

    <!-- 快捷入口 -->
    <section class="max-w-3xl mx-auto px-4 py-5 grid grid-cols-4 gap-2">
      <RouterLink to="/library" class="text-center">
        <div class="w-12 h-12 mx-auto rounded-xl bg-brand-50 flex items-center justify-center text-2xl mb-1">📚</div>
        <div class="text-xs">书架</div>
      </RouterLink>
      <RouterLink to="/community" class="text-center">
        <div class="w-12 h-12 mx-auto rounded-xl bg-emerald-50 flex items-center justify-center text-2xl mb-1">🌐</div>
        <div class="text-xs">社区</div>
      </RouterLink>
      <RouterLink to="/achievements" class="text-center">
        <div class="w-12 h-12 mx-auto rounded-xl bg-amber-50 flex items-center justify-center text-2xl mb-1">🏆</div>
        <div class="text-xs">成就</div>
      </RouterLink>
      <RouterLink to="/stats" class="text-center">
        <div class="w-12 h-12 mx-auto rounded-xl bg-violet-50 flex items-center justify-center text-2xl mb-1">📊</div>
        <div class="text-xs">统计</div>
      </RouterLink>
    </section>

    <!-- 热门公开书 -->
    <section class="max-w-3xl mx-auto px-4 mb-5" v-if="hotBooks.length">
      <div class="flex items-center justify-between mb-2">
        <h2 class="font-semibold">热门分享</h2>
        <RouterLink to="/community" class="text-xs text-brand-600">查看更多 ›</RouterLink>
      </div>
      <div class="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
        <RouterLink
          v-for="b in hotBooks"
          :key="b.id"
          :to="`/book/${b.id}`"
          class="w-24 flex-shrink-0"
        >
          <div class="aspect-[3/4] bg-slate-100 rounded-lg overflow-hidden mb-1">
            <img v-if="b.cover_url" :src="b.cover_url" class="w-full h-full object-cover" />
            <div v-else class="w-full h-full flex items-center justify-center text-2xl opacity-30">📖</div>
          </div>
          <div class="text-xs line-clamp-1">{{ b.title }}</div>
          <div class="text-[10px] text-slate-400">↓ {{ b.download_count }}</div>
        </RouterLink>
      </div>
    </section>

    <!-- 动态流 -->
    <section class="max-w-3xl mx-auto px-4 mb-5" v-if="feed.length">
      <h2 class="font-semibold mb-2">最近动态</h2>
      <div class="space-y-2">
        <div v-for="a in feed" :key="a.id" class="card p-3 flex gap-3">
          <div class="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white flex items-center justify-center text-xs font-medium">
            {{ (a.profiles?.username || '?')[0].toUpperCase() }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm">
              <span class="font-medium">{{ a.profiles?.username || '匿名' }}</span>
              <span class="text-slate-600">
                {{ a.type === 'book_shared' ? `公开了《${a.metadata?.title}》` :
                   a.type === 'review_added' ? `打了一篇书评` :
                   '有动态' }}
              </span>
            </div>
            <div class="text-xs text-slate-400">{{ timeAgo(a.created_at) }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- 功能 -->
    <section class="max-w-3xl mx-auto px-4 pb-4 grid grid-cols-2 gap-2">
      <div class="card p-3">
        <div class="text-xl mb-1">📚</div>
        <h3 class="font-semibold text-sm">多格式</h3>
        <p class="text-xs text-slate-500">EPUB/PDF/TXT/MOBI</p>
      </div>
      <div class="card p-3">
        <div class="text-xl mb-1">🎨</div>
        <h3 class="font-semibold text-sm">多字体</h3>
        <p class="text-xs text-slate-500">宋楷黑 + 主题</p>
      </div>
      <div class="card p-3">
        <div class="text-xl mb-1">🤖</div>
        <h3 class="font-semibold text-sm">AI 听书</h3>
        <p class="text-xs text-slate-500">多音色多语速</p>
      </div>
      <div class="card p-3">
        <div class="text-xl mb-1">🏆</div>
        <h3 class="font-semibold text-sm">成就体系</h3>
        <p class="text-xs text-slate-500">坚持阅读有奖</p>
      </div>
    </section>
  </div>
</template>