<script setup lang="ts">
import { Settings, X } from 'lucide-vue-next'
import { FONT_OPTIONS, THEME_OPTIONS } from '@/types'

defineProps<{
  open: boolean
  fontId: string
  themeId: string
  fontSize: number
  lineHeight: number
  maxWidth: number
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'setFont', id: string): void
  (e: 'setTheme', id: string): void
  (e: 'zoom', delta: number): void
  (e: 'setLineHeight', v: number): void
  (e: 'setMaxWidth', v: number): void
}>()
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" @click.self="emit('close')">
    <div class="bg-white w-full sm:max-w-md sm:rounded-xl rounded-t-xl p-5 max-h-[80vh] overflow-auto">
      <div class="flex justify-between items-center mb-4">
        <h3 class="font-semibold">阅读设置</h3>
        <button @click="emit('close')" class="text-ink-300"><X class="w-5 h-5" :stroke-width="1.75" /></button>
      </div>

      <section class="mb-4">
        <h4 class="text-xs text-ink-300 mb-2">字体</h4>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="f in FONT_OPTIONS"
            :key="f.id"
            @click="emit('setFont', f.id)"
            :class="['px-3 py-2 rounded border text-sm',
                     fontId === f.id ? 'border-primary-500 bg-primary-100 text-primary-600' : 'border-primary-200']"
            :style="{ fontFamily: f.family }"
          >{{ f.preview }}</button>
        </div>
      </section>

      <section class="mb-4">
        <h4 class="text-xs text-ink-300 mb-2">字号</h4>
        <div class="flex items-center gap-2">
          <button @click="emit('zoom', -2)" class="btn-secondary px-3">A-</button>
          <div class="flex-1 text-center text-sm">{{ fontSize }}px</div>
          <button @click="emit('zoom', 2)" class="btn-secondary px-3">A+</button>
        </div>
      </section>

      <section class="mb-4">
        <h4 class="text-xs text-ink-300 mb-2">行间距</h4>
        <input type="range" min="1.2" max="2.4" step="0.1" :value="lineHeight"
               @input="emit('setLineHeight', +($event.target as HTMLInputElement).value)" class="w-full" />
        <div class="text-xs text-ink-300 text-center">{{ lineHeight }}</div>
      </section>

      <section class="mb-4">
        <h4 class="text-xs text-ink-300 mb-2">页面宽度</h4>
        <input type="range" min="480" max="960" step="40" :value="maxWidth"
               @input="emit('setMaxWidth', +($event.target as HTMLInputElement).value)" class="w-full" />
        <div class="text-xs text-ink-300 text-center">{{ maxWidth }}px</div>
      </section>

      <section>
        <h4 class="text-xs text-ink-300 mb-2">主题</h4>
        <div class="grid grid-cols-4 gap-2">
          <button
            v-for="t in THEME_OPTIONS"
            :key="t.id"
            @click="emit('setTheme', t.id)"
            :class="['h-12 rounded border-2',
                     themeId === t.id ? 'border-primary-500' : 'border-transparent']"
            :style="{ background: t.bg, color: t.color }"
          >{{ t.name }}</button>
        </div>
      </section>
    </div>
  </div>
</template>
