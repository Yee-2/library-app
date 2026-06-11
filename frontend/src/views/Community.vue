<script setup lang="ts">
import { ref, onMounted, computed, onActivated } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import {
  listPublicBooks, listActivityFeed, searchPublicBooksFulltext,
  getPublicBookUrl, uploadBook
} from '@/lib/books'
import { debounce } from '@/lib/utils'

const router = useRouter()
const auth = useAuthStore()
const tab = ref<'feed' | 'books' | 'people'>('feed')
const q = ref('')
const loading = ref(false)

const feed = ref<any[]>([])
const books = ref<any[]>([])
const people = ref<any[]>([])   // 通过动态流里的 profiles 聚合

async function refresh() {
  loading.value = true
  try {
    if (tab.value === 'feed') {
      feed.value = await listActivityFeed(50)
      // 聚合动态流里出现的人
      const m = new Map<string, any>()
      feed.value.forEach((a: any) => {
        if (a.user_id && a.profiles && !m.has(a.user_id)) {
          m.set(a.user_id, { id: a.user_id, ...a.profiles })
        }
      })
      people.value = [...m.values()]
    } else if (tab.value === 'books') {
      books.value = q.value ? await searchPublicBooksFulltext(q.value) : await listPublicBooks({ pageSize: 30 })
    }
  } catch (e: any) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

const refreshDebounced = debounce(refresh, 300)
function onSearch() { refreshDebounced() }

onMounted(refresh)
onActivated(refresh)

function readBook(b: any) {
  // 公开书详情页（统一入口）
  router.push(`/book/${b.id}`)
}

function openUser(id: string) {
  router.push(`/user/${id}`)
}

async function downloadBook(b: any) {
  if (!auth.isLoggedIn) { router.push('/login'); return }
  try {
    const url = await getPublicBookUrl(b.id)
    const a = document.createElement('a')
    a.href = url
    a.download = `${b.title}.${b.file_format}`
    a.target = '_blank'
    a.click()
  } catch (e: any) {
    alert('下载失败：' + e.message)
  }
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return s + ' 秒前'
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前'
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前'
  return Math.floor(s / 86400) + ' 天前'
}

function activityText(a: any) {
  if (a.type === 'book_shared') return `公开了《${a.metadata?.title || '一本书'}》`
  if (a.type === 'review_added') return `给《${a.metadata?.book_id?.slice(0, 6) || '某书'}》打了 ${a.metadata?.rating} 星`
  if (a.type === 'achievement') return `解锁了成就`
  return '有动态'
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-4">
    <div class="flex items-center gap-2 mb-3 sticky top-0 bg-slate-50/95 backdrop-blur z-10 py-2">
      <h1 class="text-xl font-bold">社区</h1>
      <span class="text-xs text-slate-500">读书人的小圈子</span>
    </div>

    <!-- 搜索框 -->
    <div class="mb-3">
      <input v-if="tab === 'books'" v-model="q" @input="onSearch" placeholder="搜索书名/作者/简介…" class="input" />
    </div>

    <!-- 顶部 Tabs -->
    <div class="grid grid-cols-3 gap-1 bg-slate-100 rounded-lg p-1 text-sm mb-4">
      <button
        v-for="t in [['feed','动态'],['books','公开书'],['people','用户']] as const"
        :key="t[0]"
        @click="tab = t[0]; refresh()"
        :class="['py-2 rounded transition',
                 tab === t[0] ? 'bg-white shadow font-medium' : 'text-slate-500']"
      >{{ t[1] }}</button>
    </div>

    <div v-if="loading" class="text-center text-slate-500 py-8">加载中…</div>

    <!-- 动态流 -->
    <div v-else-if="tab === 'feed'" class="space-y-2">
      <div v-if="feed.length === 0" class="text-center text-slate-500 py-10">
        还没有动态，去公开一本书或关注其他人吧
      </div>
      <div v-for="a in feed" :key="a.id" class="card p-3 flex gap-3">
        <div
          class="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-brand-600
                 text-white flex items-center justify-center text-sm font-medium cursor-pointer"
          @click="openUser(a.user_id)"
        >
          {{ (a.profiles?.username || '?')[0].toUpperCase() }}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm">
            <span class="font-medium cursor-pointer hover:underline" @click="openUser(a.user_id)">
              {{ a.profiles?.username || '匿名' }}
            </span>
            <span class="text-slate-600"> {{ activityText(a) }}</span>
          </div>
          <div class="text-xs text-slate-400 mt-0.5">{{ timeAgo(a.created_at) }}</div>
        </div>
        <button
          v-if="a.type === 'book_shared'"
          @click="readBook({ id: a.ref_id })"
          class="text-xs text-brand-600 hover:underline"
        >查看</button>
      </div>
    </div>

    <!-- 公开书 -->
    <div v-else-if="tab === 'books'" class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <div v-if="books.length === 0" class="col-span-full text-center text-slate-500 py-8">暂无公开书</div>
      <div v-for="b in books" :key="b.id" class="card overflow-hidden flex flex-col">
        <div class="aspect-[3/4] bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center cursor-pointer"
             @click="readBook(b)">
          <img v-if="b.cover_url" :src="b.cover_url" class="w-full h-full object-cover" :alt="b.title" />
          <div v-else class="text-4xl opacity-30">📖</div>
        </div>
        <div class="p-2.5 flex-1 flex flex-col">
          <h3 class="font-medium text-sm line-clamp-2">{{ b.title }}</h3>
          <p class="text-xs text-slate-500 line-clamp-1">{{ b.author || '佚名' }}</p>
          <p class="text-[10px] text-slate-400 mt-0.5">
            {{ b.profiles?.username || '匿名' }} · ↓{{ b.download_count }}
          </p>
          <div class="mt-auto pt-2 flex gap-1">
            <button @click="readBook(b)" class="flex-1 text-xs btn-primary py-1">详情</button>
            <button @click="downloadBook(b)" class="text-xs btn-secondary py-1 px-2">下载</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 用户 -->
    <div v-else-if="tab === 'people'" class="space-y-2">
      <div v-if="people.length === 0" class="text-center text-slate-500 py-8">还没看到人</div>
      <div v-for="p in people" :key="p.id" class="card p-3 flex items-center gap-3 cursor-pointer" @click="openUser(p.id)">
        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white flex items-center justify-center font-medium">
          {{ (p.username || '?')[0].toUpperCase() }}
        </div>
        <div class="flex-1">
          <div class="font-medium text-sm">{{ p.username || '匿名' }}</div>
          <div class="text-xs text-slate-400">{{ p.bio || '这个人很懒，什么也没写' }}</div>
        </div>
        <span class="text-xs text-brand-600">查看 →</span>
      </div>
    </div>
  </div>
</template>