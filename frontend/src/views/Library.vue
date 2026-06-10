<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { listMyBooks, uploadBook, deleteBook, togglePublic } from '@/lib/books'
import { detectFormat } from '@/lib/books'
import { formatBytes, formatDate } from '@/lib/utils'
import type { Book } from '@/types'

const router = useRouter()
const books = ref<Book[]>([])
const loading = ref(false)
const showUpload = ref(false)
const uploading = ref(false)
const search = ref('')
const filterFormat = ref<'all' | 'epub' | 'pdf' | 'txt' | 'mobi'>('all')

// 上传表单
const file = ref<File | null>(null)
const title = ref('')
const author = ref('')
const description = ref('')
const isPublic = ref(false)
const coverFile = ref<File | null>(null)

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
  loading.value = true
  try {
    books.value = await listMyBooks()
  } catch (e: any) {
    alert('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

function onFilePick(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  if (!detectFormat(f.name)) {
    alert('仅支持 epub / pdf / txt / mobi 格式')
    return
  }
  file.value = f
  if (!title.value) title.value = f.name.replace(/\.[^.]+$/, '')
}
function onCoverPick(e: Event) {
  coverFile.value = (e.target as HTMLInputElement).files?.[0] ?? null
}

async function doUpload() {
  if (!file.value) return alert('请选择文件')
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
    alert('上传失败：' + e.message)
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
    alert('删除失败：' + e.message)
  }
}

async function handleTogglePublic(b: Book) {
  try {
    await togglePublic(b)
    await refresh()
  } catch (e: any) {
    alert('操作失败：' + e.message)
  }
}

function readBook(b: Book) {
  router.push(`/read/${b.id}`)
}
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-6">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">我的书架</h1>
      <button @click="showUpload = true" class="btn-primary">+ 导入图书</button>
    </div>

    <div class="flex flex-wrap gap-2 mb-4">
      <input v-model="search" placeholder="搜索书名/作者" class="input flex-1 min-w-[200px]" />
      <select v-model="filterFormat" class="input max-w-[140px]">
        <option value="all">全部格式</option>
        <option value="epub">EPUB</option>
        <option value="pdf">PDF</option>
        <option value="txt">TXT</option>
        <option value="mobi">MOBI</option>
      </select>
    </div>

    <div v-if="loading" class="text-center text-slate-500 py-12">加载中…</div>

    <div v-else-if="filtered.length === 0" class="text-center text-slate-500 py-12">
      <p class="mb-2">书架空空如也</p>
      <button @click="showUpload = true" class="text-brand-600 hover:underline">立即导入第一本</button>
    </div>

    <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      <div
        v-for="b in filtered"
        :key="b.id"
        class="card overflow-hidden flex flex-col hover:shadow-md transition group"
      >
        <div
          class="aspect-[3/4] bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center overflow-hidden cursor-pointer"
          @click="readBook(b)"
        >
          <img v-if="b.cover_url" :src="b.cover_url" class="w-full h-full object-cover" :alt="b.title" />
          <div v-else class="text-4xl opacity-30">📖</div>
        </div>
        <div class="p-3 flex-1 flex flex-col">
          <h3 class="font-medium text-sm line-clamp-2" :title="b.title">{{ b.title }}</h3>
          <p class="text-xs text-slate-500 line-clamp-1 mt-0.5">{{ b.author || '佚名' }}</p>
          <div class="mt-2 flex items-center justify-between text-[10px] text-slate-400">
            <span class="uppercase font-mono">{{ b.file_format }}</span>
            <span>{{ formatBytes(b.file_size) }}</span>
          </div>
          <div class="mt-2 flex items-center gap-1 text-[10px] text-slate-400">
            <span>{{ formatDate(b.updated_at) }}</span>
            <span v-if="b.is_public" class="px-1.5 py-0.5 bg-green-100 text-green-600 rounded">公开</span>
          </div>
          <div class="mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
            <button @click="readBook(b)" class="text-xs text-brand-600 hover:underline flex-1">阅读</button>
            <button @click="handleTogglePublic(b)" class="text-xs text-slate-500 hover:underline">
              {{ b.is_public ? '取消公开' : '公开' }}
            </button>
            <button @click="handleDelete(b)" class="text-xs text-red-500 hover:underline">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 上传弹窗 -->
    <div
      v-if="showUpload"
      class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4"
      @click.self="showUpload = false"
    >
      <div class="bg-white rounded-xl w-full max-w-md p-5">
        <h2 class="text-lg font-semibold mb-3">导入图书</h2>
        <div class="space-y-3">
          <div>
            <label class="text-xs text-slate-600">图书文件（epub/pdf/txt/mobi）</label>
            <input type="file" accept=".epub,.pdf,.txt,.mobi" @change="onFilePick" class="block mt-1 text-sm" />
            <p v-if="file" class="text-xs text-slate-500 mt-1">已选：{{ file.name }}</p>
          </div>
          <div>
            <label class="text-xs text-slate-600">书名</label>
            <input v-model="title" class="input mt-1" />
          </div>
          <div>
            <label class="text-xs text-slate-600">作者</label>
            <input v-model="author" class="input mt-1" />
          </div>
          <div>
            <label class="text-xs text-slate-600">简介（可选）</label>
            <textarea v-model="description" rows="3" class="input mt-1"></textarea>
          </div>
          <div>
            <label class="text-xs text-slate-600">封面图（可选）</label>
            <input type="file" accept="image/*" @change="onCoverPick" class="block mt-1 text-sm" />
          </div>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" v-model="isPublic" />
            <span>上传到公开书库（其他用户可见可下载）</span>
          </label>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button @click="showUpload = false" class="btn-secondary">取消</button>
          <button @click="doUpload" :disabled="!file || uploading" class="btn-primary">
            {{ uploading ? '上传中…' : '上传' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
