<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { listPublicBooks, getPublicBookUrl, uploadBook } from '@/lib/books'
import { useAuthStore } from '@/stores/auth'
import { formatBytes, formatDate } from '@/lib/utils'
import { useRouter } from 'vue-router'
import { Search, Download, BookOpen } from 'lucide-vue-next'
import BookCard from '@/components/BookCard.vue'

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

function openBook(id: string) {
  router.push(`/book/${id}`)
}
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-6">
    <div class="flex items-center justify-between mb-5">
      <h1 class="text-2xl font-bold tracking-tight">在线书库</h1>
      <span class="text-sm text-slate-500">收录用户公开分享的图书</span>
    </div>

    <div class="relative mb-5">
      <Search class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" :stroke-width="1.75" />
      <input v-model="q" placeholder="搜索书名或作者…" class="input pl-10" />
    </div>

    <div v-if="loading" class="text-center text-slate-500 py-12">加载中…</div>
    <div v-else-if="books.length === 0" class="text-center py-16">
      <BookOpen class="w-12 h-12 mx-auto text-slate-300 mb-2" :stroke-width="1.5" />
      <p class="text-slate-500">暂无公开图书</p>
    </div>

    <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      <BookCard v-for="b in books" :key="b.id" :book="b" :show-format="false" @open="openBook">
        <template #actions>
          <div class="flex gap-1.5">
            <button @click="download(b)" :disabled="downloading === b.id" class="flex-1 text-xs h-7 rounded-lg btn-primary">
              <Download class="w-3.5 h-3.5" :stroke-width="1.75" />
              <span>{{ downloading === b.id ? '…' : '下载' }}</span>
            </button>
            <button @click="borrowToMyShelf(b)" class="text-xs h-7 px-2.5 rounded-lg btn-secondary">借阅</button>
          </div>
        </template>
      </BookCard>
    </div>
  </div>
</template>
