<script setup lang="ts">
/**
 * MentionPicker - @提及时弹出联想列表
 * - 监听 query 变化，调用 searchUsernames
 * - 点击插入 @username 到外部
 */
import { ref, watch } from 'vue'
import { searchUsernames } from '@/lib/books'
import UserAvatar from '@/components/UserAvatar.vue'

const props = defineProps<{
  query: string         // 当前光标前的 @query（不包含 @）
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'pick', username: string): void
  (e: 'close'): void
}>()

const results = ref<{ id: string; username: string; avatar_url: string | null }[]>([])
const loading = ref(false)

watch([() => props.open, () => props.query], async ([open, q]) => {
  if (!open || !q) { results.value = []; return }
  loading.value = true
  try {
    results.value = await searchUsernames(q, 6)
  } catch {
    results.value = []
  } finally {
    loading.value = false
  }
})

function pick(username: string) {
  emit('pick', username)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[80]"
      @click="emit('close')"
    >
      <div
        class="absolute bottom-24 left-1/2 -translate-x-1/2 w-72 max-w-[92vw]
               glass-panel rounded-2xl shadow-2xl py-1.5 overflow-hidden
               border border-neon-purple/30"
        @click.stop
      >
        <div class="px-3 py-2 text-[10px] uppercase tracking-wider text-ink-300 border-b border-neon-purple/15">
          选择用户
        </div>
        <div v-if="loading" class="px-3 py-3 text-xs text-ink-300 text-center">搜索中…</div>
        <div v-else-if="results.length === 0" class="px-3 py-3 text-xs text-ink-300 text-center">
          没有匹配 "{{ query }}"
        </div>
        <button
          v-for="u in results"
          :key="u.id"
          @click="pick(u.username || '')"
          class="w-full flex items-center gap-2 px-3 py-2 hover:bg-neon-purple/10 transition text-left"
        >
          <UserAvatar :user="u" size="xs" />
          <span class="text-sm text-ink-100">{{ u.username || '匿名' }}</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>