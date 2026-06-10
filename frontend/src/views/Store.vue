<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { listPublicBooks, getPublicBookUrl, uploadBook } from '@/lib/books'
import { useAuthStore } from '@/stores/auth'
import { formatBytes, formatDate } from '@/lib/utils'
import { useRouter } from 'vue-router'

const auth = useAuthStore()
const router = useRouter()

interface PubBook {
  id: string
  title: string
  author: string | null
  description: string | null
  cover_url: string | null
  file_format: string
  file_size: number | null
  download_count: number
  created_at: string
  profiles: { username: string | null } | null
}

const books = ref<PubBook[]>([])
const q = ref('')
const loading = ref(false)
const downloading = ref<string | null>(null)

async function refresh() {
  loading.value = true
  try {
    books.value = await listPublicBooks({ q: q.value || undefined })
  } catch (e: any) {
    alert('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}

let timer: any
watch(q, () => {
  clearTimeout(timer)
  timer = setTimeout(refresh, 300)
})
onMounted(refresh)

async function download(b: PubBook) {
  if (!auth.isLoggedIn) {
    router.push('/login')
    return
  }
  downloading.value = b.id
  try {
    const url = await getPublicBookUrl(b.id)
    // 触发下载
    const a = document.createElement('a')
    a.href = url
    a.download = `${b.title}.${b.file_format}`
    a.target = '_blank'
    a.click()
    await refresh()
  } catch (e: any) {
    alert('下载失败：' + e.message)
  } finally {
    downloading.value = null
  }
}

async function borrowToMyShelf(b: PubBook) {
  if (!auth.isLoggedIn) {
    router.push('/login')
    return
  }
  if (!confirm(`将《${b.title}》加入我的书架？`)) return
  try {
    // 先拿签名 URL，下载为 File，再走 uploadBook
    const url = await getPublicBookUrl(b.id)
    const res = await fetch(url)
    const blob = await res.blob()
    const file = new File([blob], `${b.title}.${b.file_format}`, { type: blob.type })
    await uploadBook(file, {
      title: b.title,
      author: b.author ?? undefined,
      description: b.description ?? undefined,
    })
    alert('已加入我的书架')
    router.push('/library')
  } catch (e: any) {
    alert('借阅失败：' + e.message)
  }
}
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-6">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-2xl font-bold">在线书库</h1>
      <span class="text-sm text-slate-500">收录用户公开分享的图书</span>
    </div>

    <input v-model="q" placeholder="搜索书名或作者…" class="input mb-4" />

    <div v-if="loading" class="text-center text-slate-500 py-12">加载中…</div>
    <div v-else-if="books.length === 0" class="text-center text-slate-500 py-12">
      <p>暂无公开图书</p>
    </div>

    <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      <div v-for="b in books" :key="b.id" class="card overflow-hidden flex flex-col">
        <div class="aspect-[3/4] bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center overflow-hidden">
          <img v-if="b.cover_url" :src="b.cover_url" class="w-full h-full object-cover" :alt="b.title" />
          <div v-else class="text-4xl opacity-30">📖</div>
        </div>
        <div class="p-3 flex-1 flex flex-col">
          <h3 class="font-medium text-sm line-clamp-2" :title="b.title">{{ b.title }}</h3>
          <p class="text-xs text-slate-500 line-clamp-1">{{ b.author || '佚名' }}</p>
          <p class="text-[10px] text-slate-400 mt-1">
            分享者: {{ b.profiles?.username || '匿名' }} · {{ formatDate(b.created_at) }}
          </p>
          <p v-if="b.description" class="text-xs text-slate-500 mt-1 line-clamp-2">{{ b.description }}</p>
          <div class="mt-2 flex items-center justify-between text-[10px] text-slate-400">
            <span class="uppercase font-mono">{{ b.file_format }}</span>
            <span>↓ {{ b.download_count }}</span>
          </div>
          <div class="mt-2 flex gap-1">
            <button
              @click="download(b)"
              :disabled="downloading === b.id"
              class="flex-1 text-xs btn-primary py-1.5"
            >
              {{ downloading === b.id ? '…' : '下载' }}
            </button>
            <button
              @click="borrowToMyShelf(b)"
              class="text-xs btn-secondary py-1.5 px-2"
            >
              借阅
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
