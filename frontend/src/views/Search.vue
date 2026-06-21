<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { debounce } from '@/lib/utils'
import { searchPublicBooksFulltext } from '@/lib/books'
import { useGutenbergSearch } from '@/composables/useGutenbergSearch'
import { useWikisourceSearch } from '@/composables/useWikisourceSearch'
import { isGutenbergEnabled } from '@/lib/featureFlags'
import GutenbergBookCard from '@/components/GutenbergBookCard.vue'
import WikisourceBookCard from '@/components/WikisourceBookCard.vue'
import {
  ArrowLeft, Search as SearchIcon, BookOpen, TrendingUp, Library as LibraryIcon, FileText
} from 'lucide-vue-next'
import { toast } from '@/lib/toast'

const router = useRouter()
const q = ref('')
const results = ref<any[]>([])              // 公开书库结果
const gutenbergResults = ref<any[]>([])     // 古登堡结果
const wikisourceResults = ref<any[]>([])    // 维基文库结果
const loading = ref(false)
const gutenbergLoading = ref(false)
const wikisourceLoading = ref(false)
const error = ref('')
const gutenbergError = ref('')
const wikisourceError = ref('')
const hasSearched = ref(false)
const importingWikisource = ref('')  // 正在导入的书名
const quickTags = ['武侠', '科幻', '推理', '历史', '言情', '哲学', '诗集', '散文', '名著', '编程']

const gutenbergEnabled = isGutenbergEnabled()
const gutenberg = useGutenbergSearch()
const wikisource = useWikisourceSearch()

async function importWikisource(pageTitle: string) {
  if (importingWikisource.value) return
  importingWikisource.value = pageTitle
  try {
    const { supabase } = await import('@/lib/supabase')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      toast.error('请先登录')
      router.push('/login')
      return
    }
    const token = session.access_token
    const res = await fetch(
      'https://ekeqxffoosynbitfmrqr.supabase.co/functions/v1/wikisource-import',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ page_title: pageTitle }),
      }
    )
    const data = await res.json()
    if (!res.ok) {
      toast.error(data?.message || data?.error || '导入失败')
      return
    }
    if (data.exists) {
      toast.info('已在你的书架')
    } else {
      toast.success('导入成功')
    }
    router.push(`/book/${data.book_id}`)
  } catch (e: any) {
    console.error('[wikisource-import]', e)
    toast.error(e?.message || '导入失败')
  } finally {
    importingWikisource.value = ''
  }
}

const doSearch = debounce(async () => {
  if (!q.value.trim()) {
    results.value = []
    gutenbergResults.value = []
    wikisourceResults.value = []
    error.value = ''
    gutenbergError.value = ''
    wikisourceError.value = ''
    hasSearched.value = false
    return
  }
  hasSearched.value = true

  loading.value = true
  if (gutenbergEnabled) gutenbergLoading.value = true
  wikisourceLoading.value = true

  const publicSearch = searchPublicBooksFulltext(q.value.trim())
    .then(data => { results.value = data; error.value = '' })
    .catch(e => {
      console.error('[search public]', e)
      error.value = e?.message ?? '公开书库搜索失败'
      results.value = []
    })
    .finally(() => { loading.value = false })

  const searches: Promise<unknown>[] = [publicSearch]

  if (gutenbergEnabled) {
    searches.push(
      gutenberg.search(q.value.trim())
        .then(() => {
          gutenbergResults.value = gutenberg.results.value
          gutenbergError.value = gutenberg.error.value
        })
        .catch(e => {
          console.error('[search gutenberg]', e)
          gutenbergError.value = e?.message ?? '古登堡搜索失败'
          gutenbergResults.value = []
        })
        .finally(() => { gutenbergLoading.value = false })
    )
  }

  // 维基文库搜索（中文专用，不限 feature flag）
  searches.push(
    wikisource.search(q.value.trim())
      .then(() => {
        wikisourceResults.value = wikisource.results.value
        wikisourceError.value = wikisource.error.value
      })
      .catch(e => {
        console.error('[search wikisource]', e)
        wikisourceError.value = e?.message ?? '维基文库搜索失败'
        wikisourceResults.value = []
      })
      .finally(() => { wikisourceLoading.value = false })
  )

  await Promise.all(searches)
}, 300)

function pickTag(t: string) {
  q.value = t
  doSearch()
}

function go(b: any) { router.push(`/book/${b.id}`) }

const totalCount = computed(() =>
  results.value.length + gutenbergResults.value.length + wikisourceResults.value.length
)
const showGutenbergSection = computed(() => gutenbergResults.value.length > 0)
const showWikisourceSection = computed(() => wikisourceResults.value.length > 0)
const showPublicSection = computed(() => results.value.length > 0)
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-6">
    <div class="flex items-center gap-2 mb-5">
      <button @click="$router.back()" class="btn-ghost -ml-2 flex items-center gap-1">
        <ArrowLeft class="w-4 h-4" :stroke-width="1.75" />
        <span>返回</span>
      </button>
      <h1 class="text-2xl font-bold tracking-tight text-ink-800">搜索</h1>
    </div>
    <div class="relative mb-5">
      <SearchIcon class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-300" :stroke-width="1.75" />
      <input
        v-model="q"
        @input="doSearch"
        placeholder="搜书名、作者，古登堡 + 维基文库 + 公开书库…"
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
          class="px-3 py-1.5 rounded-lg text-xs border border-primary-200 bg-ink-100
                 hover:border-primary-300 hover:bg-primary-600/10 text-ink-500 transition"
        >{{ t }}</button>
      </div>
    </div>

    <!-- 加载中 -->
    <div v-if="(loading || gutenbergLoading || wikisourceLoading) && totalCount === 0" class="text-center text-ink-300 py-8">
      搜索中…
    </div>

    <!-- 完全无结果 -->
    <div v-else-if="hasSearched && q && totalCount === 0 && !loading && !gutenbergLoading"
         class="text-center py-16">
      <BookOpen class="w-12 h-12 mx-auto text-ink-300 mb-2" :stroke-width="1.5" />
      <p class="text-ink-300">没找到相关结果</p>
      <p class="text-xs text-ink-300 mt-1">试试其他关键词，或浏览公开书库</p>
    </div>

    <!-- 古登堡分组 -->
    <template v-else-if="hasSearched && (showGutenbergSection || showWikisourceSection || gutenbergLoading || wikisourceLoading)">
      <div v-if="showGutenbergSection || gutenbergLoading" class="mb-6">
        <div class="flex items-center gap-2 mb-3">
          <LibraryIcon class="w-4 h-4 text-primary-600" :stroke-width="2" />
          <h2 class="text-sm font-semibold text-ink-700">古登堡计划</h2>
          <span class="text-xs text-ink-300">
            {{ gutenbergLoading ? '搜索中…' : `${gutenbergResults.length} 本` }}
          </span>
          <span class="text-xs text-ink-300">· 公有领域 · {{ gutenbergEnabled ? '' : '未启用' }}</span>
        </div>
        <div v-if="gutenbergError" class="text-center text-rose-400 py-4 text-sm">
          古登堡搜索失败：{{ gutenbergError }}
        </div>
        <div v-else class="space-y-2">
          <GutenbergBookCard
            v-for="b in gutenbergResults"
            :key="b.gutenberg_id"
            :book="b"
          />
        </div>
      </div>

      <!-- 维基文库分组 -->
      <div v-if="showWikisourceSection || wikisourceLoading" class="mb-6">
        <div class="flex items-center gap-2 mb-3">
          <FileText class="w-4 h-4 text-amber-600" :stroke-width="2" />
          <h2 class="text-sm font-semibold text-ink-700">维基文库</h2>
          <span class="text-xs text-ink-300">
            {{ wikisourceLoading ? '搜索中…' : `${wikisourceResults.length} 本` }}
          </span>
          <span class="text-xs text-ink-300">· 中文公版 · 免费</span>
        </div>
        <div v-if="wikisourceError" class="text-center text-rose-400 py-4 text-sm">
          维基文库搜索失败：{{ wikisourceError }}
        </div>
        <div v-else class="space-y-2">
          <WikisourceBookCard
            v-for="b in wikisourceResults"
            :key="b.pageid"
            :book="b"
            :importing="importingWikisource === b.title"
            @import="importWikisource"
          />
        </div>
      </div>

      <!-- 公开书库分组 -->
      <div v-if="showPublicSection || loading">
        <div class="flex items-center gap-2 mb-3">
          <BookOpen class="w-4 h-4 text-emerald-600" :stroke-width="2" />
          <h2 class="text-sm font-semibold text-ink-700">公开书库</h2>
          <span class="text-xs text-ink-300">
            {{ loading ? '搜索中…' : `${results.length} 本` }}
          </span>
          <span class="text-xs text-ink-300">· 用户分享</span>
        </div>
        <div v-if="error" class="text-center text-rose-400 py-4 text-sm">
          公开书库搜索失败：{{ error }}
        </div>
        <div v-else class="space-y-2">
          <div v-for="b in results" :key="b.id"
               class="card p-3 flex items-center gap-3 cursor-pointer hover:shadow-md transition"
               @click="go(b)">
            <div class="w-12 h-16 bg-ink-100 rounded-md overflow-hidden flex-shrink-0">
              <img v-if="b.cover_url" :src="b.cover_url" class="w-full h-full object-cover" :alt="b.title" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm line-clamp-1 text-ink-800">{{ b.title }}</div>
              <div class="text-xs text-ink-300">{{ b.author || '佚名' }}</div>
              <div v-if="b.description" class="text-xs text-ink-300 line-clamp-1 mt-0.5">{{ b.description }}</div>
            </div>
            <span class="text-xs text-ink-300 uppercase font-mono">{{ b.file_format }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>