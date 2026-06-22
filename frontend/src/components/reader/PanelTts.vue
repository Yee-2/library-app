<script setup lang="ts">
import { Volume2, X, Pause, Play, Square, RefreshCw } from 'lucide-vue-next'

defineProps<{
  open: boolean
  playing: boolean
  paused: boolean
  voice: string
  speed: number
  voices: Array<{ id: string; name: string }>
  index: number
  queueLength: number
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'play'): void
  (e: 'pause'): void
  (e: 'resume'): void
  (e: 'stop'): void
  (e: 'restart'): void
  (e: 'setVoice', payload: { id: string }): void
  (e: 'setSpeed', v: number): void
}>()
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" @click.self="emit('close')">
    <div class="bg-white w-full sm:max-w-md sm:rounded-xl rounded-t-xl p-5">
      <div class="flex justify-between items-center mb-4">
        <h3 class="font-semibold">AI 听书</h3>
        <button @click="emit('close')" class="text-ink-300"><X class="w-5 h-5" :stroke-width="1.75" /></button>
      </div>

      <section class="mb-4">
        <h4 class="text-xs text-ink-300 mb-2">音色</h4>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="v in voices"
            :key="v.id"
            @click="emit('setVoice', { id: v.id })"
            :class="['px-3 py-2 rounded border text-sm text-left',
                     voice === v.id ? 'border-primary-500 bg-primary-100 text-primary-600' : 'border-primary-200']"
          >{{ v.name }}</button>
        </div>
      </section>

      <section class="mb-4">
        <h4 class="text-xs text-ink-300 mb-2">语速 ({{ speed.toFixed(1) }}x)</h4>
        <input type="range" min="0.5" max="2.0" step="0.1" :value="speed" class="w-full"
               @input="emit('setSpeed', +($event.target as HTMLInputElement).value)" />
      </section>

      <div v-if="playing" class="text-xs text-ink-300 mb-3">
        正在播放 {{ index + 1 }} / {{ queueLength }} 句
        <div class="h-1 bg-ink-100 rounded mt-1">
          <div class="h-full bg-primary-1000 rounded transition-all"
               :style="{ width: ((index + 1) / queueLength * 100) + '%' }"></div>
        </div>
      </div>

      <div class="flex gap-2">
        <button v-if="!paused" @click="emit('pause')" :disabled="!playing" class="btn-secondary flex-1">
          <Pause class="w-4 h-4" :stroke-width="1.75" />
          <span>暂停</span>
        </button>
        <button v-else @click="emit('resume')" class="btn-primary flex-1">
          <Play class="w-4 h-4" :stroke-width="1.75" />
          <span>继续</span>
        </button>
        <button @click="emit('stop')" :disabled="!playing" class="btn-secondary">
          <Square class="w-4 h-4" :stroke-width="1.75" />
          <span>停止</span>
        </button>
        <button @click="emit('restart')" class="btn-primary">
          <RefreshCw class="w-4 h-4" :stroke-width="1.75" />
          <span>重新播放</span>
        </button>
      </div>
      <p class="text-xs text-ink-300 mt-3">由 MiniMax M3 TTS 提供支持</p>
    </div>
  </div>
</template>
