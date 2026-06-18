<script setup lang="ts">
import { useRouter } from 'vue-router'
import { X } from 'lucide-vue-next'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const router = useRouter()

function goLogin() {
  emit('close')
  router.push('/login')
}
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-200"
    leave-active-class="transition-opacity duration-150"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
  >
    <div
      v-if="open"
      class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center"
      @click.self="emit('close')"
    >
      <div class="bg-white w-[85vw] max-w-sm rounded-2xl p-6 shadow-2xl text-center">
        <div class="w-14 h-14 mx-auto rounded-full bg-neon-purple/15 flex items-center justify-center mb-4">
          <svg class="w-7 h-7 text-neon-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.118a7.5 7.5 0 0 1 15 0A17.933 17.933 0 0 1 12 21.75a17.933 17.933 0 0 1-7.5-1.632Z" />
          </svg>
        </div>
        <h3 class="text-lg font-semibold text-ink-900 mb-2">需要登录</h3>
        <p class="text-sm text-ink-400 mb-6">登录后即可体验完整功能</p>
        <div class="flex gap-3">
          <button
            @click="emit('close')"
            class="flex-1 h-11 rounded-xl border border-ink-200 text-ink-500 text-sm font-medium hover:bg-ink-50 transition"
          >取消</button>
          <button
            @click="goLogin"
            class="flex-1 h-11 rounded-xl bg-gradient-to-r from-neon-purple to-neon-pink text-white text-sm font-medium shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition"
          >去登录</button>
        </div>
      </div>
    </div>
  </Transition>
</template>
