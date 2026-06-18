<script setup lang="ts">
import { ref, onMounted, onActivated } from 'vue'
import { listAllAchievements, listMyAchievements } from '@/lib/books'
import { ArrowLeft, Trophy, Lock } from 'lucide-vue-next'

const items = ref<any[]>([])
const mine = ref<any[]>([])
const loading = ref(false)

async function refresh() {
  loading.value = true
  try {
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
    <div class="flex items-center gap-2 mb-5">
      <button @click="$router.back()" class="btn-ghost -ml-2 flex items-center gap-1">
        <ArrowLeft class="w-4 h-4" :stroke-width="1.75" />
        <span>返回</span>
      </button>
      <h1 class="text-2xl font-bold tracking-tight">成就徽章</h1>
      <span class="text-sm text-ink-300">{{ mine.length }} / {{ items.length }}</span>
    </div>

    <div v-if="loading" class="text-center text-ink-300 py-8">加载中…</div>

    <div v-else class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <div
        v-for="a in items"
        :key="a.id"
        :class="['card p-4 text-center transition',
                 unlocked(a.id) ? '' : 'opacity-40']"
      >
        <div
          class="w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-2 ring-2 ring-white/15 shadow-sm"
          :class="unlocked(a.id)
            ? 'bg-gradient-to-br from-amber-500/25 to-amber-400/15'
            : 'bg-ink-100'"
        >
          <span v-if="a.icon" class="text-3xl">{{ a.icon }}</span>
          <Trophy v-else class="w-8 h-8 text-amber-300" :stroke-width="1.5" />
        </div>
        <div class="font-semibold text-sm">{{ a.name }}</div>
        <div class="text-xs text-ink-300 mt-1 line-clamp-2 leading-relaxed">{{ a.description }}</div>
        <div v-if="unlocked(a.id)" class="text-[10px] text-amber-300 mt-2 font-medium">
          ✓ {{ new Date(unlockedAt(a.id)).toLocaleDateString('zh-CN') }}
        </div>
        <div v-else class="text-[10px] text-ink-300 mt-2 flex items-center justify-center gap-1">
          <Lock class="w-3 h-3" :stroke-width="1.75" />
          <span>未解锁</span>
        </div>
      </div>
    </div>
  </div>
</template>
