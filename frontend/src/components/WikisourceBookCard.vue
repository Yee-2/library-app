<script setup lang="ts">
import type { WikisourceResult } from '@/composables/useWikisourceSearch'
import { BookOpen, Plus, Loader2 } from 'lucide-vue-next'

defineProps<{
  book: WikisourceResult
  importing: boolean
}>()

const emit = defineEmits<{
  import: [pageTitle: string]
}>()
</script>

<template>
  <div class="card p-3 flex items-center gap-3">
    <div class="w-12 h-16 bg-amber-100 rounded-md flex items-center justify-center flex-shrink-0">
      <BookOpen class="w-6 h-6 text-amber-400" :stroke-width="1.75" />
    </div>
    <div class="flex-1 min-w-0">
      <div class="font-medium text-sm line-clamp-1 text-ink-800">{{ book.title }}</div>
      <div class="flex items-center gap-2 mt-0.5">
        <span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded
                     bg-amber-500/15 text-amber-600 text-[10px] font-medium">
          🇨🇳 中文
        </span>
        <span v-if="book.chapters > 1" class="text-xs text-ink-300">{{ book.chapters }} 章</span>
      </div>
      <div class="text-xs text-ink-300 line-clamp-1 mt-1">{{ book.snippet }}</div>
    </div>
    <button
      :disabled="importing"
      class="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium
             bg-amber-500/15 text-amber-600 hover:bg-amber-500/25
             disabled:opacity-50 disabled:cursor-not-allowed transition flex-shrink-0"
      @click="emit('import', book.title)"
    >
      <Loader2 v-if="importing" class="w-3 h-3 animate-spin" :stroke-width="2" />
      <Plus v-else class="w-3 h-3" :stroke-width="2" />
      <span>{{ importing ? '导入中' : '加入' }}</span>
    </button>
  </div>
</template>
