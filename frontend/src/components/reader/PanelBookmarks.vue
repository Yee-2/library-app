<script setup lang="ts">
import { Bookmark as BookmarkIcon, Trash2, X } from 'lucide-vue-next'
import type { Bookmark } from '@/types'

defineProps<{
  open: boolean
  bookmarks: Bookmark[]
  format?: string
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'remove', id: string): void
  (e: 'jump', bookmark: Bookmark): void
  (e: 'add'): void
}>()
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" @click.self="emit('close')">
    <div class="bg-white w-full sm:max-w-md sm:rounded-xl rounded-t-xl p-5 max-h-[80vh] flex flex-col">
      <div class="flex justify-between items-center mb-3">
        <h3 class="font-semibold">书签 ({{ bookmarks.length }})</h3>
        <div class="flex items-center gap-2">
          <button @click="emit('add')" class="text-primary-600 text-sm">+ 添加当前页</button>
          <button @click="emit('close')" class="text-ink-300"><X class="w-5 h-5" :stroke-width="1.75" /></button>
        </div>
      </div>
      <div class="flex-1 overflow-auto space-y-2">
        <div v-if="bookmarks.length === 0" class="text-center text-ink-300 py-8 text-sm">暂无书签</div>
        <div v-for="b in bookmarks" :key="b.id" class="card p-3 flex items-center gap-2">
          <div class="w-1 self-stretch rounded" :style="{ background: b.color }"></div>
          <div class="flex-1 min-w-0">
            <div class="text-sm">{{ b.note || `第 ${b.page} 页` }}</div>
            <div class="text-xs text-ink-300">{{ new Date(b.created_at).toLocaleString('zh-CN') }}</div>
          </div>
          <button @click="emit('jump', b)" class="text-primary-600 text-sm">跳转</button>
          <button @click="emit('remove', b.id)" class="text-red-500 text-sm">删</button>
        </div>
      </div>
    </div>
  </div>
</template>
