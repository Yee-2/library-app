<script setup lang="ts">
import { ref, onMounted, onActivated } from 'vue'
import { listAllAchievements, listMyAchievements } from '@/lib/books'
import { useAchievementsStore } from '@/stores/achievements'

const ach = useAchievementsStore()
const items = ref<any[]>([])
const mine = ref<any[]>([])
const loading = ref(false)

async function refresh() {
  loading.value = true
  try {
    await ach.init()
    items.value = await listAllAchievements()
    mine.value = await listMyAchievements()
  } finally {
    loading.value = false
  }
}

onMounted(refresh)
onActivated(refresh)

function unlocked(id: string) {
  return mine.value.some((m: any) => m.achievement_id === id)
}
function unlockedAt(id: string) {
  return mine.value.find((m: any) => m.achievement_id === id)?.unlocked_at
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-6">
    <div class="flex items-center gap-2 mb-4">
      <button @click="$router.back()" class="btn-ghost text-sm">← 返回</button>
      <h1 class="text-xl font-bold">成就徽章</h1>
      <span class="text-sm text-slate-500">{{ mine.length }} / {{ items.length }}</span>
    </div>

    <div v-if="loading" class="text-center text-slate-500 py-8">加载中…</div>

    <div v-else class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <div
        v-for="a in items"
        :key="a.id"
        :class="['card p-4 text-center transition',
                 unlocked(a.id) ? '' : 'opacity-40 grayscale']"
      >
        <div
          class="w-16 h-16 mx-auto rounded-full flex items-center justify-center text-3xl mb-2"
          :class="unlocked(a.id)
            ? 'bg-gradient-to-br from-amber-100 to-amber-200'
            : 'bg-slate-100'"
        >
          {{ a.icon || '🏆' }}
        </div>
        <div class="font-semibold text-sm">{{ a.name }}</div>
        <div class="text-xs text-slate-500 mt-1 line-clamp-2">{{ a.description }}</div>
        <div v-if="unlocked(a.id)" class="text-[10px] text-amber-600 mt-2">
          {{ new Date(unlockedAt(a.id)).toLocaleDateString('zh-CN') }}
        </div>
        <div v-else class="text-[10px] text-slate-400 mt-2">未解锁</div>
      </div>
    </div>
  </div>
</template>