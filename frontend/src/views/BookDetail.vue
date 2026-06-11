<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import {
  getBook, getPublicBookUrl, getMyBookFileUrl, listReviews, upsertReview, toggleFavorite, uploadBook
} from '@/lib/books'
import { formatDate } from '@/lib/utils'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const bookId = computed(() => route.params.id as string)

const book = ref<any>(null)
const reviews = ref<any[]>([])
const isFav = ref(false)
const loading = ref(false)
const showReview = ref(false)
const rRating = ref(5)
const rContent = ref('')
const actionLoading = ref(false)

async function refresh() {
  loading.value = true
  try {
    book.value = await getBook(bookId.value)
    reviews.value = await listReviews(bookId.value)
    if (auth.isLoggedIn) {
      const { data } = await supabase.from('favorites').select('user_id').eq('user_id', auth.user!.id).eq('book_id', bookId.value).maybeSingle()
      isFav.value = !!data
    }
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

async function borrow() {
  if (!auth.isLoggedIn) { router.push('/login'); return }
  actionLoading.value = true
  try {
    const url = await getPublicBookUrl(bookId.value)
    const res = await fetch(url)
    const blob = await res.blob()
    const file = new File([blob], `${book.value.title}.${book.value.file_format}`, { type: blob.type })
    await uploadBook(file, { title: book.value.title, author: book.value.author, description: book.value.description })
    router.push('/library')
  } catch (e: any) {
    console.error('[borrow]', e)
    alert('借阅失败：' + e.message)
  } finally {
    actionLoading.value = false
  }
}

async function download() {
  if (!auth.isLoggedIn) { router.push('/login'); return }
  try {
    const url = await getPublicBookUrl(bookId.value)
    const a = document.createElement('a')
    a.href = url
    a.download = `${book.value.title}.${book.value.file_format}`
    a.target = '_blank'
    a.click()
  } catch (e: any) {
    alert('下载失败：' + e.message)
  }
}

async function readNow() {
  router.push(`/read/${bookId.value}`)
}

async function fav() {
  if (!auth.isLoggedIn) { router.push('/login'); return }
  try {
    await toggleFavorite(bookId.value, isFav.value)
    isFav.value = !isFav.value
  } catch (e: any) {
    alert(e.message)
  }
}

async function submitReview() {
  try {
    await upsertReview(bookId.value, rRating.value, rContent.value)
    showReview.value = false
    rContent.value = ''
    await refresh()
  } catch (e: any) {
    alert('发布失败：' + e.message)
  }
}

const avgRating = computed(() => {
  if (reviews.value.length === 0) return 0
  return (reviews.value.reduce((s, r) => s + r.rating, 0) / reviews.value.length).toFixed(1)
})

const isOwner = computed(() => auth.user?.id === book.value?.user_id)
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-6">
    <div class="flex items-center gap-2 mb-4">
      <button @click="$router.back()" class="btn-ghost text-sm">← 返回</button>
    </div>

    <div v-if="loading" class="text-center text-slate-500 py-8">加载中…</div>

    <div v-else-if="book">
      <!-- 头部 -->
      <div class="card p-5 mb-4 flex gap-4">
        <div class="w-28 flex-shrink-0 aspect-[3/4] bg-slate-100 rounded-lg overflow-hidden">
          <img v-if="book.cover_url" :src="book.cover_url" class="w-full h-full object-cover" />
          <div v-else class="w-full h-full flex items-center justify-center text-3xl opacity-30">📖</div>
        </div>
        <div class="flex-1 min-w-0">
          <h1 class="text-xl font-bold line-clamp-2">{{ book.title }}</h1>
          <p class="text-sm text-slate-500 mt-1">{{ book.author || '佚名' }}</p>
          <div class="flex items-center gap-2 mt-2 text-xs text-slate-400">
            <span class="uppercase font-mono">{{ book.file_format }}</span>
            <span>·</span>
            <span>{{ (book.file_size / 1024 / 1024).toFixed(2) }} MB</span>
            <span>·</span>
            <span>↓ {{ book.download_count }} 次</span>
          </div>
          <div class="flex items-center gap-1 mt-2 text-sm">
            <span class="text-amber-500">★</span>
            <span class="font-medium">{{ avgRating }}</span>
            <span class="text-slate-400 text-xs">({{ reviews.length }} 评)</span>
          </div>
          <p v-if="book.description" class="text-sm text-slate-600 mt-3 line-clamp-4">{{ book.description }}</p>
        </div>
      </div>

      <!-- 操作 -->
      <div class="grid grid-cols-4 gap-2 mb-4">
        <button v-if="isOwner" @click="readNow" class="btn-primary col-span-2">📖 阅读</button>
        <button v-else @click="borrow" :disabled="actionLoading" class="btn-primary col-span-2">
          {{ actionLoading ? '借阅中…' : '📚 借阅到书架' }}
        </button>
        <button v-if="!isOwner" @click="download" class="btn-secondary">下载</button>
        <button @click="fav" :class="isFav ? 'btn-primary' : 'btn-secondary'">
          {{ isFav ? '★ 已收藏' : '☆ 收藏' }}
        </button>
      </div>

      <!-- 分享者 -->
      <div class="card p-3 mb-4 flex items-center gap-3 cursor-pointer"
           @click="book.profiles?.username && router.push(`/user/${book.user_id}`)">
        <div class="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white flex items-center justify-center text-sm font-medium">
          {{ (book.profiles?.username || '?')[0].toUpperCase() }}
        </div>
        <div class="flex-1">
          <div class="text-sm font-medium">{{ book.profiles?.username || '匿名' }}</div>
          <div class="text-xs text-slate-400">分享于 {{ formatDate(book.created_at) }}</div>
        </div>
        <span class="text-xs text-slate-400">查看主页 ›</span>
      </div>

      <!-- 书评 -->
      <div class="card p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold">书评 ({{ reviews.length }})</h3>
          <button v-if="auth.isLoggedIn" @click="showReview = !showReview" class="text-sm text-brand-600">
            写书评
          </button>
        </div>

        <div v-if="showReview" class="bg-slate-50 rounded-lg p-3 mb-3">
          <div class="flex items-center gap-1 mb-2">
            <span class="text-xs text-slate-500 mr-2">评分</span>
            <button v-for="n in 5" :key="n" @click="rRating = n" :class="n <= rRating ? 'text-amber-500' : 'text-slate-300'">★</button>
            <span class="text-xs text-slate-500 ml-2">{{ rRating }} 星</span>
          </div>
          <textarea v-model="rContent" rows="3" placeholder="说说你的看法…" class="input mb-2"></textarea>
          <div class="flex justify-end gap-2">
            <button @click="showReview = false" class="btn-secondary text-sm">取消</button>
            <button @click="submitReview" class="btn-primary text-sm">发布</button>
          </div>
        </div>

        <div v-if="reviews.length === 0" class="text-center text-slate-400 py-6 text-sm">还没有书评</div>
        <div v-else class="space-y-3">
          <div v-for="r in reviews" :key="r.id" class="border-b border-slate-100 last:border-0 pb-3 last:pb-0">
            <div class="flex items-center gap-2">
              <div class="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-xs">
                {{ (r.profiles?.username || '?')[0].toUpperCase() }}
              </div>
              <span class="text-sm font-medium">{{ r.profiles?.username || '匿名' }}</span>
              <span class="text-amber-500 text-sm">{{ '★'.repeat(r.rating) }}</span>
              <span class="text-xs text-slate-400 ml-auto">{{ formatDate(r.created_at) }}</span>
            </div>
            <p v-if="r.content" class="text-sm text-slate-600 mt-1.5 ml-9">{{ r.content }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>