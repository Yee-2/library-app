<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { listMyBooks, uploadBook, deleteBook, togglePublic } from '@/lib/books'
import { detectFormat } from '@/lib/books'
import { toast } from '@/lib/toast'
import { formatBytes, formatDate } from '@/lib/utils'
import type { Book } from '@/types'
import { Upload, Search, Star, BarChart3, X, Globe, Lock, Trash2, BookOpen } from 'lucide-vue-next'
import BookCard from '@/components/BookCard.vue'
import LoginPrompt from '@/components/LoginPrompt.vue'

const router = useRouter()
const auth = useAuthStore()
const books = ref<Book[]>([])
const loading = ref(false)
const showUpload = ref(false)
const uploading = ref(false)
const search = ref('')
const filterFormat = ref<'all' | 'epub' | 'pdf' | 'txt' | 'mobi'>('all')
const showLoginPrompt = ref(false)

// 上传表单
const file = ref<File | null>(null)
const title = ref('')
const author = ref('')
const description = ref('')
const isPublic = ref(false)
const coverFile = ref<File | null>(null)

const formats = ['all', 'epub', 'pdf', 'txt', 'mobi'] as const

const filtered = computed(() => {
  return books.value.filter(b => {
    if (filterFormat.value !== 'all' && b.file_format !== filterFormat.value) return false
    if (search.value) {
      const q = search.value.toLowerCase()
      return b.title.toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q)
    }
    return true
  })
})

async function refresh() {
  if (!auth.isLoggedIn) return
  loading.value = true
  try {
    books.value = await listMyBooks()
  } catch (e: any) {
    toast.error('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

function onFilePick(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  if (!detectFormat(f.name)) {
    toast.error('仅支持 epub / pdf / txt / mobi 格式')
    return
  }
  file.value = f
  if (!title.value) title.value = f.name.replace(/\.[^.]+$/, '')
}
function onCoverPick(e: Event) {
  coverFile.value = (e.target as HTMLInputElement).files?.[0] ?? null
}

async function doUpload() {
  if (!file.value) return toast.error('请选择文件')
  uploading.value = true
  try {
    await uploadBook(file.value, {
      title: title.value,
      author: author.value,
      description: description.value,
      isPublic: isPublic.value,
      coverFile: coverFile.value,
    })
    showUpload.value = false
    file.value = null
    coverFile.value = null
    title.value = ''
    author.value = ''
    description.value = ''
    isPublic.value = false
    await refresh()
  } catch (e: any) {
    toast.error('上传失败：' + e.message)
  } finally {
    uploading.value = false
  }
}

async function handleDelete(b: Book) {
  if (!confirm(`确定删除《${b.title}》吗？`)) return
  try {
    await deleteBook(b)
    await refresh()
  } catch (e: any) {
    toast.error('删除失败：' + e.message)
  }
}

async function handleTogglePublic(b: Book) {
  try {
    await togglePublic(b)
    await refresh()
    const { useAchievementsStore } = await import('@/stores/achievements')
    const ach = useAchievementsStore()
    await ach.checkAll()
  } catch (e: any) {
    toast.error('操作失败：' + e.message)
  }
}

function readBook(b: Book | string) {
  const id = typeof b === 'string' ? b : b.id
  router.push(`/read/${id}`)
}
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-6">
    <!-- 未登录状态 -->
    <template v-if="!auth.isLoggedIn">
      <div class="text-center py-16">
        <BookOpen class="w-16 h-16 mx-auto text-ink-300 mb-3" :stroke-width="1.5" />
        <p class="text-ink-300 mb-1">登录后管理你的书架</p>
        <p class="text-xs text-ink-300/70 mb-4">导入、阅读、同步，一站式管理</p>
        <button @click="showLoginPrompt = true" class="btn-primary">登录书架</button>
      </div>
      <LoginPrompt :open="showLoginPrompt" @close="showLoginPrompt = false" />
    </template>

    <!-- 已登录状态 -->
    <template v-else>
    <div class="flex items-center justify-between mb-5">
      <h1 class="text-2xl font-bold tracking-tight">我的书架</h1>
      <div class="flex items-center gap-1">
        <button @click="router.push('/search')" class="btn-icon btn-ghost" title="搜索">
          <Search class="w-5 h-5" :stroke-width="1.75" />
        </button>
        <button @click="router.push('/favorites')" class="btn-icon btn-ghost" title="收藏">
          <Star class="w-5 h-5" :stroke-width="1.75" />
        </button>
        <button @click="router.push('/stats')" class="btn-icon btn-ghost" title="统计">
          <BarChart3 class="w-5 h-5" :stroke-width="1.75" />
        </button>
        <button @click="showUpload = true" class="btn-primary ml-2">
          <Upload class="w-4 h-4" :stroke-width="1.75" />
          <span>导入</span>
        </button>
      </div>
    </div>

    <!-- 搜索 + 格式筛选 -->
    <div class="flex flex-wrap items-center gap-2 mb-5">
      <div class="relative flex-1 min-w-[200px]">
        <Search class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-300" :stroke-width="1.75" />
        <input v-model="search" placeholder="搜索书名/作者" class="input pl-10" />
      </div>
      <div class="inline-flex bg-ink-800/60 rounded-full p-1 text-sm gap-1">
        <button
          v-for="f in formats"
          :key="f"
          @click="filterFormat = f"
          :class="['px-3 h-8 rounded-full transition',
                   filterFormat === f ? 'bg-white shadow-sm font-medium text-ink-900 shadow-[0_0_14px_rgba(168,85,247,0.35)]' : 'text-ink-300 hover:text-ink-100']"
        >
          {{ f === 'all' ? '全部' : f.toUpperCase() }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="text-center text-ink-300 py-12">加载中…</div>

    <!-- 空状态 -->
    <div v-else-if="filtered.length === 0" class="text-center py-16">
      <BookOpen class="w-16 h-16 mx-auto text-ink-300 mb-3" :stroke-width="1.5" />
      <p class="text-ink-300 mb-3">书架空空如也</p>
      <button @click="showUpload = true" class="btn-primary">
        <Upload class="w-4 h-4" :stroke-width="1.75" />
        <span>立即导入第一本</span>
      </button>
    </div>

    <!-- 书架网格 -->
    <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      <div v-for="b in filtered" :key="b.id" class="group/card relative">
        <BookCard :book="b" @open="readBook" />
        <!-- hover 操作按钮 -->
        <div class="absolute bottom-[68px] left-2 right-2 flex gap-1
                    opacity-0 group-hover/card:opacity-100 transition-opacity">
          <button @click="readBook(b)" class="flex-1 text-xs h-7 rounded-lg bg-ink-850/95 shadow text-neon-purple font-medium">
            阅读
          </button>
          <button @click="handleTogglePublic(b)" class="h-7 px-2 rounded-lg bg-ink-850/95 shadow text-ink-200 flex items-center justify-center" :title="b.is_public ? '取消公开' : '公开'">
            <component :is="b.is_public ? Lock : Globe" class="w-3.5 h-3.5" :stroke-width="1.75" />
          </button>
          <button @click="handleDelete(b)" class="h-7 px-2 rounded-lg bg-ink-850/95 shadow text-rose-400 flex items-center justify-center" title="删除">
            <Trash2 class="w-3.5 h-3.5" :stroke-width="1.75" />
          </button>
        </div>
        <div class="px-2.5 mt-1 flex items-center justify-between text-[10px] text-ink-300">
          <span>{{ formatDate(b.updated_at) }}</span>
        </div>
      </div>
    </div>

    <!-- 上传弹窗 -->
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-150"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showUpload"
        class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center"
        @click.self="showUpload = false"
      >
        <div class="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl p-6 max-h-[90vh] overflow-auto shadow-2xl">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-semibold tracking-tight">导入图书</h2>
            <button @click="showUpload = false" class="btn-icon btn-ghost -m-2">
              <X class="w-5 h-5" :stroke-width="1.75" />
            </button>
          </div>
          <div class="space-y-4">
            <div>
              <label class="text-xs font-medium text-ink-200 mb-1.5 block">图书文件（epub/pdf/txt/mobi）</label>
              <input type="file" accept=".epub,.pdf,.txt,.mobi" @change="onFilePick" class="block w-full text-sm text-ink-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-neon-purple/15 file:text-neon-purple hover:file:bg-neon-purple/25" />
              <p v-if="file" class="text-xs text-ink-300 mt-1.5">已选：{{ file.name }}</p>
            </div>
            <div>
              <label class="text-xs font-medium text-ink-200 mb-1.5 block">书名</label>
              <input v-model="title" class="input" />
            </div>
            <div>
              <label class="text-xs font-medium text-ink-200 mb-1.5 block">作者</label>
              <input v-model="author" class="input" />
            </div>
            <div>
              <label class="text-xs font-medium text-ink-200 mb-1.5 block">简介（可选）</label>
              <textarea v-model="description" rows="3" class="input"></textarea>
            </div>
            <div>
              <label class="text-xs font-medium text-ink-200 mb-1.5 block">封面图（可选）</label>
              <input type="file" accept="image/*" @change="onCoverPick" class="block w-full text-sm text-ink-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-neon-purple/15 file:text-neon-purple hover:file:bg-neon-purple/25" />
            </div>
            <label class="flex items-center gap-3 cursor-pointer select-none">
              <span class="relative inline-flex items-center">
                <input type="checkbox" v-model="isPublic" class="sr-only peer" />
                <span class="w-10 h-6 rounded-full bg-ink-800 peer-checked:bg-neon-purple/150 transition-colors pointer-events-none"></span>
                <span class="absolute left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform pointer-events-none peer-checked:translate-x-4"></span>
              </span>
              <span class="text-sm text-ink-100 flex-1">上传到公开书库（其他用户可下载）</span>
              <Globe class="w-4 h-4 text-ink-300" :stroke-width="1.75" />
            </label>
          </div>
          <div class="mt-6 flex justify-end gap-2">
            <button @click="showUpload = false" class="btn-secondary">取消</button>
            <button @click="doUpload" :disabled="!file || uploading" class="btn-primary">
              {{ uploading ? '上传中…' : '上传' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
    </template>
  </div>
</template>
