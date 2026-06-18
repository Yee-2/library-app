<script setup lang="ts">
/**
 * NicknamePrompt - 设置昵称引导弹窗
 * - 用于用户首次发帖/评论/点赞时，若 username 缺失或等同于 email 前缀，弹出此 Modal 引导设置
 * - 提供关闭（取消）和确认（保存）两种结果
 */
import { ref, watch } from 'vue'
import { Sparkles, X } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { updateMyProfile } from '@/lib/books'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'updated', username: string): void
}>()

const auth = useAuthStore()
const username = ref('')
const saving = ref(false)
const error = ref('')

watch(() => props.open, (v) => {
  if (v) {
    username.value = ''
    error.value = ''
  }
})

async function save() {
  const v = username.value.trim()
  if (!v) { error.value = '请输入昵称'; return }
  if (v.length > 30) { error.value = '昵称最多 30 个字符'; return }
  saving.value = true
  error.value = ''
  try {
    await updateMyProfile({ username: v })
    emit('updated', v)
    emit('close')
  } catch (e: any) {
    error.value = e?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

function close() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-150"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        @click.self="close"
      >
        <div
          class="w-full max-w-sm glass-panel rounded-3xl p-6 shadow-2xl
                 border border-neon-purple/30 shadow-[0_0_40px_rgba(168,85,247,0.25)]"
        >
          <div class="flex items-start justify-between mb-4">
            <div class="flex items-center gap-2">
              <div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-neon-purple/40 to-neon-pink/30
                          flex items-center justify-center border border-neon-purple/30">
                <Sparkles class="w-5 h-5 text-neon-pink" :stroke-width="2" />
              </div>
              <div>
                <h3 class="font-semibold text-ink-50">设置你的昵称</h3>
                <p class="text-xs text-ink-300 mt-0.5">让社区认识你（不再使用邮箱前缀）</p>
              </div>
            </div>
            <button @click="close" class="text-ink-300 hover:text-ink-50 p-1">
              <X class="w-5 h-5" :stroke-width="1.75" />
            </button>
          </div>

          <input
            v-model="username"
            maxlength="30"
            placeholder="例如：小书虫、夜读人…"
            class="input"
            @keyup.enter="save"
          />
          <p v-if="error" class="text-xs text-rose-400 mt-2">{{ error }}</p>
          <p class="text-xs text-ink-300 mt-2">最多 30 字符；不要包含邮箱地址或隐私信息</p>

          <div class="flex gap-2 mt-5">
            <button @click="close" class="flex-1 btn-secondary">稍后再说</button>
            <button
              @click="save"
              :disabled="saving || !username.trim()"
              class="flex-1 btn-primary disabled:opacity-50"
            >
              {{ saving ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
