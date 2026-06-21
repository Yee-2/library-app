<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen, Globe, Plus, Loader2 } from 'lucide-vue-next'
import { useGutenbergImport } from '@/composables/useGutenbergImport'
import type { GutenbergBook } from '@/composables/useGutenbergSearch'

const props = defineProps<{
  book: GutenbergBook
}>()

const { importing, importAndGo } = useGutenbergImport()

const languageLabel = computed(() => props.book.language === 'zh' ? '中文' : '英文')
const languageFlag = computed(() => props.book.language === 'zh' ? '🇨🇳' : '🇺🇸')

function handleAdd() {
  importAndGo(props.book.gutenberg_id, props.book.language)
}
</script>

<template>
  <div class="card p-3 flex items-center gap-3 hover:shadow-md transition">
    <!-- 封面占位（古登堡暂时没封面图，从 epub 内嵌提取可在阶段 3 优化） -->
    <div class="w-12 h-16 bg-gradient-to-br from-ink-700 to-ink-800 rounded-md overflow-hidden flex-shrink-0 flex items-center justify-center">
      <BookOpen v-if="!importing" class="w-5 h-5 text-ink-200" :stroke-width="1.5" />
      <Loader2 v-else class="w-5 h-5 text-ink-200 animate-spin" :stroke-width="2" />
    </div>

    <!-- 信息 -->
    <div class="flex-1 min-w-0">
      <div class="font-medium text-sm line-clamp-1 text-ink-800">{{ book.title }}</div>
      <div class="text-xs text-ink-300 line-clamp-1 mt-0.5">
        {{ book.author || '佚名' }}
      </div>
      <div class="flex items-center gap-1.5 mt-1">
        <!-- 语言徽章 -->
        <span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px]
                     bg-ink-100 text-ink-500 border border-ink-200">
          <Globe class="w-2.5 h-2.5" :stroke-width="2" />
          {{ languageFlag }} {{ languageLabel }}
        </span>
        <!-- EPUB 格式 -->
        <span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-mono
                     bg-primary-50 text-primary-700 border border-primary-200">
          EPUB
        </span>
        <!-- 来源标识 -->
        <span class="text-[10px] text-ink-300">古登堡</span>
      </div>
    </div>

    <!-- 加入按钮 -->
    <button
      @click="handleAdd"
      :disabled="importing"
      class="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg
             bg-primary-600 hover:bg-primary-700 disabled:bg-ink-300
             text-white text-xs font-medium transition"
    >
      <Loader2 v-if="importing" class="w-3.5 h-3.5 animate-spin" :stroke-width="2.5" />
      <Plus v-else class="w-3.5 h-3.5" :stroke-width="2.5" />
      {{ importing ? '导入中' : '加入' }}
    </button>
  </div>
</template>