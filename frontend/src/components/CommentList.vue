<script setup lang="ts">
/**
 * CommentList - 帖子评论列表（支持二级回复）
 * - 复用 UserAvatar
 * - 默认折叠，点击"评论"展开
 * - 输入框可发表/回复
 */
import { ref, computed, onMounted, watch } from 'vue'
import { listComments, createComment, deleteComment, countComments, type Comment } from '@/lib/comments'
import { toast } from '@/lib/toast'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import { Trash2, CornerDownRight, Send } from 'lucide-vue-next'
import UserAvatar from '@/components/UserAvatar.vue'
import Skeleton from '@/components/Skeleton.vue'
import LoginPrompt from '@/components/LoginPrompt.vue'
import { maskUsername } from '@/lib/privacy'

const props = defineProps<{
  postId: string
}>()

const auth = useAuthStore()
const router = useRouter()

const open = ref(false)
const loading = ref(false)
const list = ref<Comment[]>([])
const initialCount = ref<number | null>(null)  // 未展开时显示的评论数
const draft = ref('')
const submitting = ref(false)
const showLoginPrompt = ref(false)

// 一级 + 二级分类
const rootComments = computed(() => list.value.filter(c => !c.parent_id))
function repliesOf(parentId: string) {
  return list.value.filter(c => c.parent_id === parentId)
}

const replyTo = ref<Comment | null>(null)
const replyDraft = ref('')

async function load() {
  if (!props.postId) return
  loading.value = true
  try {
    list.value = await listComments(props.postId)
    initialCount.value = list.value.length
  } catch (e: any) {
    console.error('[comments]', e)
  } finally {
    loading.value = false
  }
}

async function loadCount() {
  if (initialCount.value !== null) return
  try {
    initialCount.value = await countComments(props.postId)
  } catch {}
}

watch(open, (v) => { if (v) load() })
onMounted(loadCount)

function toggle() {
  if (!auth.isLoggedIn) { showLoginPrompt.value = true; return }
  open.value = !open.value
}

async function submitRoot() {
  const text = draft.value.trim()
  if (!text || submitting.value) return
  submitting.value = true
  try {
    const c = await createComment(props.postId, text, null)
    list.value = [...list.value, c]
    draft.value = ''
  } catch (e: any) {
    toast.error('评论失败：' + e.message)
  } finally {
    submitting.value = false
  }
}

async function submitReply() {
  if (!replyTo.value) return
  const text = replyDraft.value.trim()
  if (!text || submitting.value) return
  submitting.value = true
  try {
    const c = await createComment(props.postId, text, replyTo.value.id)
    list.value = [...list.value, c]
    replyDraft.value = ''
    replyTo.value = null
  } catch (e: any) {
    toast.error('回复失败：' + e.message)
  } finally {
    submitting.value = false
  }
}

async function removeComment(c: Comment) {
  if (!confirm('确定删除这条评论？')) return
  try {
    await deleteComment(c.id)
    list.value = list.value.filter(x => x.id !== c.id && x.parent_id !== c.id)
  } catch (e: any) {
    toast.error('删除失败：' + e.message)
  }
}

function openReply(c: Comment) {
  replyTo.value = c
  replyDraft.value = `@${c.profiles?.username || ''} `
}
function cancelReply() {
  replyTo.value = null
  replyDraft.value = ''
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return s + ' 秒前'
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前'
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前'
  return Math.floor(s / 86400) + ' 天前'
}

function openUser(id: string) { router.push(`/user/${id}`) }
</script>

<template>
  <div class="mt-2.5 border-t border-primary-100 pt-3">
    <button
      @click="toggle"
      class="text-xs flex items-center gap-1 text-ink-300 hover:text-primary-600 transition group"
    >
      <CornerDownRight class="w-3.5 h-3.5 group-hover:rotate-[-30deg] transition" :stroke-width="1.75" />
      <span>{{ open ? '收起' : '展开' }}评论 ({{ open ? list.length : (initialCount ?? '·') }})</span>
    </button>

    <Transition
      enter-active-class="transition-all duration-200"
      leave-active-class="transition-all duration-150"
      enter-from-class="opacity-0 max-h-0"
      leave-to-class="opacity-0 max-h-0"
    >
      <div v-if="open" class="mt-3 space-y-3 overflow-hidden">
        <!-- 输入框 -->
        <div class="flex gap-2">
          <UserAvatar :user="auth.user ? { username: (auth.user as any).username, avatar_url: null } : null" size="xs" />
          <div class="flex-1 flex gap-2">
            <input
              v-model="draft"
              @keyup.enter="submitRoot"
              maxlength="1000"
              placeholder="说点什么…"
              class="input flex-1 h-9 text-sm"
            />
            <button
              @click="submitRoot"
              :disabled="!draft.trim() || submitting"
              class="btn-icon btn-primary !w-9 disabled:opacity-50"
              title="发送"
            >
              <Send class="w-4 h-4" :stroke-width="1.75" />
            </button>
          </div>
        </div>

        <!-- 加载中骨架 -->
        <div v-if="loading" class="space-y-2">
          <div v-for="i in 2" :key="i" class="flex gap-2">
            <Skeleton variant="circle" width="24px" height="24px" />
            <Skeleton variant="text" :rows="2" />
          </div>
        </div>

        <!-- 评论列表 -->
        <div v-else-if="rootComments.length === 0" class="text-xs text-ink-300 text-center py-2">
          还没有评论，来抢沙发 ✨
        </div>

        <div v-else class="space-y-3">
          <div v-for="c in rootComments" :key="c.id" class="flex gap-2">
            <UserAvatar :user="c.profiles" size="xs" clickable @click="openUser(c.user_id)" />
            <div class="flex-1 min-w-0">
              <div class="rounded-xl bg-ink-50 px-3 py-2 border border-primary-600/10">
                <div class="flex items-center gap-2 mb-0.5">
                  <span class="text-xs font-medium text-ink-800 cursor-pointer hover:underline"
                        @click="openUser(c.user_id)">
                    {{ c.user_id === auth.user?.id ? (c.profiles?.username || '匿名') : maskUsername(c.profiles?.username) }}
                  </span>
                  <span class="text-[10px] text-ink-300">{{ timeAgo(c.created_at) }}</span>
                </div>
                <p class="text-xs text-ink-600 whitespace-pre-wrap break-words">{{ c.content }}</p>
              </div>
              <div class="flex items-center gap-3 mt-1 text-[10px] text-ink-300">
                <button class="hover:text-primary-600 transition" @click="openReply(c)">回复</button>
                <button
                  v-if="auth.user?.id === c.user_id"
                  class="hover:text-rose-400 transition flex items-center gap-0.5"
                  @click="removeComment(c)"
                >
                  <Trash2 class="w-3 h-3" :stroke-width="1.75" />删除
                </button>
              </div>

              <!-- 回复 -->
              <div v-if="repliesOf(c.id).length" class="mt-2 ml-2 space-y-2 border-l-2 border-primary-100 pl-3">
                <div v-for="r in repliesOf(c.id)" :key="r.id" class="flex gap-2">
                  <UserAvatar :user="r.profiles" size="xs" clickable @click="openUser(r.user_id)" />
                  <div class="flex-1 min-w-0">
                    <div class="rounded-xl bg-ink-50 px-3 py-2 border border-primary-600/10">
                      <div class="flex items-center gap-2 mb-0.5">
                        <span class="text-xs font-medium text-ink-800 cursor-pointer hover:underline"
                              @click="openUser(r.user_id)">
                          {{ r.user_id === auth.user?.id ? (r.profiles?.username || '匿名') : maskUsername(r.profiles?.username) }}
                        </span>
                        <span class="text-[10px] text-ink-300">{{ timeAgo(r.created_at) }}</span>
                      </div>
                      <p class="text-xs text-ink-600 whitespace-pre-wrap break-words">{{ r.content }}</p>
                    </div>
                    <div class="flex items-center gap-3 mt-1 text-[10px] text-ink-300">
                      <button
                        v-if="auth.user?.id === r.user_id"
                        class="hover:text-rose-400 transition flex items-center gap-0.5"
                        @click="removeComment(r)"
                      >
                        <Trash2 class="w-3 h-3" :stroke-width="1.75" />删除
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 回复输入框 -->
              <div v-if="replyTo?.id === c.id" class="flex gap-2 mt-2">
                <input
                  v-model="replyDraft"
                  @keyup.enter="submitReply"
                  maxlength="1000"
                  placeholder="回复…"
                  class="input flex-1 h-8 text-xs"
                />
                <button @click="submitReply" :disabled="!replyDraft.trim() || submitting"
                        class="btn-icon btn-primary !w-8 !h-8 disabled:opacity-50">
                  <Send class="w-3.5 h-3.5" :stroke-width="1.75" />
                </button>
                <button @click="cancelReply" class="btn-icon btn-ghost !w-8 !h-8">
                  ×
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <LoginPrompt :open="showLoginPrompt" @close="showLoginPrompt = false" />
  </div>
</template>