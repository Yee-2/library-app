<script setup lang="ts">
import { X } from 'lucide-vue-next'

defineProps<{
  open: boolean
  chapters: Array<{ id: string; label: string; cfi?: string; index?: number }>
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'jump', chapter: { cfi?: string; id?: string; index?: number }): void
}>()
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" @click.self="emit('close')">
    <div class="bg-white w-full sm:max-w-md sm:rounded-xl rounded-t-xl p-5 max-h-[80vh] flex flex-col">
      <div class="flex justify-between items-center mb-3">
        <h3 class="font-semibold">目录 ({{ chapters.length }})</h3>
        <button @click="emit('close')" class="text-ink-300"><X class="w-5 h-5" :stroke-width="1.75" /></button>
      </div>
      <div v-if="chapters.length === 0" class="text-center text-ink-300 py-6 text-sm">暂无目录</div>
      <div class="flex-1 overflow-auto space-y-1">
        <div v-for="(ch, i) in chapters" :key="ch.id || i"
             @click="emit('jump', ch)"
             class="card p-3 cursor-pointer hover:bg-ink-100 transition text-sm"
             :title="ch.label">
          <div class="truncate">{{ i + 1 }}. {{ ch.label }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
