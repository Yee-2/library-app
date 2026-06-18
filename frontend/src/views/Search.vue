<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { debounce } from '@/lib/utils'
import { searchPublicBooksFulltext } from '@/lib/books'
import { ArrowLeft, Search as SearchIcon, BookOpen, TrendingUp } from 'lucide-vue-next'

const router = useRouter()
const q = ref('')
const scope = ref<'public' | 'mine'>('public')
const results = ref<any[]>([])
const loading = ref(false)
const error = ref('')
const hasSearched = ref(false)
const quickTags = ['武侠', '科幻', '推理', '历史', '言情', '哲学', '诗集', '散文', '名著', '编程']

const doSearch = debounce(async () => {
  if (!q.value.trim()) { results.value = []; error.value = ''; hasSearched.value = false; return }
  loading.value = true
  error.value = ''
  hasSearched.value = true
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

function pickTag(t: string) {
  q.value = t
  doSearch()
}

function go(b: any) { router.push(`/book/${b.id}`) }
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-6">
    <div class="flex items-center gap-2 mb-5">
      <button @click="$router.back()" class="btn-ghost -ml-2 flex items-center gap-1">
        <ArrowLeft class="w-4 h-4" :stroke-width="1.75" />
        <span>返回</span>
      </button>
      <h1 class="text-2xl font-bold tracking-tight text-ink-50">搜索</h1>
    </div>
    <div class="relative mb-5">
      <SearchIcon class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-300" :stroke-width="1.75" />
      <input
        v-model="q"
        @input="doSearch"
        placeholder="输入书名、作者、简介关键词…"
        class="input pl-10"
        autofocus
      />
    </div>

    <!-- 快捷搜索 -->
    <div v-if="!hasSearched" class="mb-5">
      <div class="flex items-center gap-2 mb-2.5 text-xs text-ink-300">
        <TrendingUp class="w-3.5 h-3.5" :stroke-width="1.75" />
        <span>热门标签</span>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="t in quickTags"
          :key="t"
          @click="pickTag(t)"
          class="px-3 py-1.5 rounded-lg text-xs border border-neon-purple/20 bg-ink-800/40 dark:bg-ink-800/40
                 hover:border-neon-purple/40 hover:bg-neon-purple/10 text-ink-200 transition"
        >{{ t }}</button>
      </div>
    </div>

    <div v-if="loading" class="text-center text-ink-300 py-8">搜索中…</div>
    <div v-else-if="error" class="text-center text-rose-400 py-8">{{ error }}</div>
    <div v-else-if="hasSearched && q && results.length === 0" class="text-center py-16">
      <BookOpen class="w-12 h-12 mx-auto text-ink-300 mb-2" :stroke-width="1.5" />
      <p class="text-ink-300">没找到相关结果</p>
    </div>
    <div v-else class="space-y-2">
      <div v-for="b in results" :key="b.id" class="card p-3 flex items-center gap-3 cursor-pointer hover:shadow-[0_0_20px_rgba(168,85,247,0.25)] transition" @click="go(b)">
        <div class="w-12 h-16 bg-ink-800/60 rounded-md overflow-hidden flex-shrink-0">
          <img v-if="b.cover_url" :src="b.cover_url" class="w-full h-full object-cover" :alt="b.title" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm line-clamp-1 text-ink-50">{{ b.title }}</div>
          <div class="text-xs text-ink-300">{{ b.author || '佚名' }}</div>
          <div v-if="b.description" class="text-xs text-ink-300 line-clamp-1 mt-0.5">{{ b.description }}</div>
        </div>
        <span class="text-xs text-ink-300 uppercase font-mono">{{ b.file_format }}</span>
      </div>
    </div>
  </div>
</template>
