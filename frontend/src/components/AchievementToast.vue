<script setup lang="ts">
import { ref, onBeforeUnmount, watch } from 'vue'
import { Trophy } from 'lucide-vue-next'
import { useAchievementsStore } from '@/stores/achievements'

const ach = useAchievementsStore()
const visible = ref(false)
const current = ref<{ name: string; icon: string | null } | null>(null)
let timer: any

function showNext() {
  const t = ach.consumeToast()
  if (!t) return
  current.value = t
  visible.value = true
  clearTimeout(timer)
  timer = setTimeout(() => { visible.value = false }, 3500)
}

watch(() => ach.toastQueue.length, (n) => { if (n > 0) showNext() })
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-300 ease-out"
    leave-active-class="transition-all duration-300 ease-in"
    enter-from-class="translate-y-32 opacity-0"
    leave-to-class="translate-y-32 opacity-0"
  >
    <div
      v-if="visible"
      class="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl
             bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-2xl
             flex items-center gap-3 pointer-events-none"
    >
      <div class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
        <Trophy class="w-5 h-5 text-white" :stroke-width="2" />
      </div>
      <div>
        <div class="text-[11px] text-amber-50/80 font-medium">解锁成就</div>
        <div class="font-semibold text-sm leading-tight">{{ current?.name }}</div>
      </div>
    </div>
  </Transition>
</template>
