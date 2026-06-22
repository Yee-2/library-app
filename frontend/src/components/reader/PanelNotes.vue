<script setup lang="ts">
import { NotebookPen, X } from 'lucide-vue-next'
import type { Note } from '@/types'

defineProps<{
  open: boolean
  notes: Note[]
  newNoteText: string
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update:newNoteText', v: string): void
  (e: 'add'): void
  (e: 'remove', id: string): void
}>()
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" @click.self="emit('close')">
    <div class="bg-white w-full sm:max-w-md sm:rounded-xl rounded-t-xl p-5 max-h-[80vh] flex flex-col">
      <div class="flex justify-between items-center mb-3">
        <h3 class="font-semibold">笔记 ({{ notes.length }})</h3>
        <button @click="emit('close')" class="text-ink-300"><X class="w-5 h-5" :stroke-width="1.75" /></button>
      </div>
      <div class="mb-3 flex gap-2">
        <input :value="newNoteText" @input="emit('update:newNoteText', ($event.target as HTMLInputElement).value)" placeholder="添加新笔记…" class="input" @keydown.enter="emit('add')" />
        <button @click="emit('add')" class="btn-primary">添加</button>
      </div>
      <div class="flex-1 overflow-auto space-y-2">
        <div v-if="notes.length === 0" class="text-center text-ink-300 py-6 text-sm">暂无笔记</div>
        <div v-for="n in notes" :key="n.id" class="card p-3">
          <div class="text-sm whitespace-pre-wrap">{{ n.content }}</div>
          <div v-if="n.comment" class="text-xs text-ink-300 mt-1">批注：{{ n.comment }}</div>
          <div class="flex justify-between items-center mt-2">
            <span class="text-xs text-ink-300">
              {{ n.page ? `第 ${n.page} 页` : '当前位置' }} · {{ new Date(n.created_at).toLocaleString('zh-CN') }}
            </span>
            <button @click="emit('remove', n.id)" class="text-red-500 text-xs">删</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
