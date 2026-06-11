<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { debounce } from '@/lib/utils'
import { searchPublicBooksFulltext } from '@/lib/books'

const router = useRouter()
const q = ref('')
const scope = ref<'public' | 'mine'>('public')
const results = ref<any[]>([])
const loading = ref(false)
const error = ref('')

const doSearch = debounce(async () => {
  if (!q.value.trim()) { results.value = []; error.value = ''; return }
  loading.value = true
  error.value = ''
  try {
    results.value = await searchPublicBooksFulltext(q.value.trim())
  } catch (e: any) {
    console.error('[search]', e)
    error.value = e?.message ?? '搜索失败，请重试'
    results.value = []
  } finally {
    loading.value = false
  }
}, 300)

function go(b: any) { router.push(`/book/${b.id}`) }
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-6">
    <div class="flex items-center gap-2 mb-4">
      <button @click="$router.back()" class="btn-ghost text-sm">← 返回</button>
      <h1 class="text-xl font-bold">搜索</h1>
    </div>
    <input
      v-model="q"
      @input="doSearch"
      placeholder="输入书名、作者、简介关键词…"
      class="input mb-4"
      autofocus
    />

    <div v-if="loading" class="text-center text-slate-500 py-8">搜索中…</div>
    <div v-else-if="error" class="text-center text-red-500 py-8">{{ error }}</div>
    <div v-else-if="q && results.length === 0" class="text-center text-slate-500 py-8">没找到相关结果</div>
    <div v-else class="space-y-2">
      <div v-for="b in results" :key="b.id" class="card p-3 flex items-center gap-3 cursor-pointer" @click="go(b)">
        <div class="w-12 h-16 bg-slate-100 rounded overflow-hidden flex-shrink-0">
          <img v-if="b.cover_url" :src="b.cover_url" class="w-full h-full object-cover" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm line-clamp-1">{{ b.title }}</div>
          <div class="text-xs text-slate-500">{{ b.author || '佚名' }}</div>
          <div v-if="b.description" class="text-xs text-slate-400 line-clamp-1 mt-0.5">{{ b.description }}</div>
        </div>
        <span class="text-xs text-slate-400 uppercase">{{ b.file_format }}</span>
      </div>
    </div>
  </div>
</template>