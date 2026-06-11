<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch } from 'vue'
import { useAchievementsStore } from '@/stores/achievements'

const ach = useAchievementsStore()
let timer: any

function showNext() {
  const t = ach.consumeToast()
  if (!t) return
  const el = document.getElementById('ach-toast')
  if (!el) return
  el.innerHTML = `
    <div class="flex items-center gap-2">
      <div class="text-3xl">${t.icon || '🏆'}</div>
      <div>
        <div class="text-xs text-amber-100/80">解锁成就</div>
        <div class="font-bold">${t.name}</div>
      </div>
    </div>
  `
  el.classList.remove('translate-y-32', 'opacity-0')
  el.classList.add('translate-y-0', 'opacity-100')
  clearTimeout(timer)
  timer = setTimeout(hide, 3500)
}

function hide() {
  const el = document.getElementById('ach-toast')
  if (!el) return
  el.classList.add('translate-y-32', 'opacity-0')
  el.classList.remove('translate-y-0', 'opacity-100')
}

watch(() => ach.toastQueue.length, (n) => { if (n > 0) showNext() })

onMounted(() => {})
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div
    id="ach-toast"
    class="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl
           bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-2xl
           opacity-0 translate-y-32 transition-all duration-300 pointer-events-none"
  >
    <!-- 内容由 JS 注入 -->
  </div>
</template>