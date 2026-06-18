<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { listNotifications, markRead, markAllRead, type Notification } from '@/lib/notifications'
import { ArrowLeft, MessageCircle, CheckCheck } from 'lucide-vue-next'
import UserAvatar from '@/components/UserAvatar.vue'
import Skeleton from '@/components/Skeleton.vue'
import { maskUsername } from '@/lib/privacy'

const router = useRouter()
const notifications = ref<Notification[]>([])
const loading = ref(true)

async function refresh() {
  loading.value = true
  try {
    notifications.value = await listNotifications()
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return s + ' 秒前'
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前'
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前'
  return Math.floor(s / 86400) + ' 天前'
}

function openNotif(n: Notification) {
  markRead(n.id)
  n.read = true
  // 导航到社区页面，并传递 post_id 以定位到具体帖子
  router.push({ path: '/community', query: { post: n.post_id } })
}

async function readAll() {
  markAllRead(notifications.value.map(n => n.id))
  notifications.value.forEach(n => { n.read = true })
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-4">
    <div class="flex items-center justify-between mb-5">
      <div class="flex items-center gap-2">
        <button @click="$router.back()" class="btn-ghost -ml-2">
          <ArrowLeft class="w-4 h-4" :stroke-width="1.75" />
        </button>
        <h1 class="text-xl font-bold tracking-tight">消息</h1>
      </div>
      <button
        v-if="notifications.some(n => !n.read)"
        @click="readAll"
        class="text-xs text-neon-purple flex items-center gap-1 hover:underline"
      >
        <CheckCheck class="w-3.5 h-3.5" :stroke-width="1.75" />
        全部已读
      </button>
    </div>

    <div v-if="loading" class="space-y-3">
      <div v-for="i in 3" :key="i" class="card p-4 flex gap-3">
        <Skeleton variant="circle" width="36px" height="36px" />
        <div class="flex-1 space-y-2">
          <Skeleton variant="text" width="40%" />
          <Skeleton variant="text" :rows="2" />
        </div>
      </div>
    </div>

    <div v-else-if="notifications.length === 0" class="text-center py-16">
      <MessageCircle class="w-16 h-16 mx-auto text-ink-300 mb-3" :stroke-width="1.5" />
      <p class="text-ink-300 mb-1">暂无消息</p>
      <p class="text-xs text-ink-300/70">当有人回复你的帖子时，你会在这里收到通知</p>
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="n in notifications"
        :key="n.id"
        @click="openNotif(n)"
        class="card p-4 flex gap-3 cursor-pointer transition-all hover:shadow-[0_0_24px_rgba(168,85,247,0.3)] hover:border-neon-purple/40"
        :class="!n.read ? 'border-l-2 border-l-neon-purple' : ''"
      >
        <div class="relative">
          <UserAvatar :user="{ username: n.actor_name, avatar_url: n.actor_avatar }" size="sm" />
          <span class="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-neon-purple flex items-center justify-center">
            <MessageCircle class="w-2.5 h-2.5 text-white" :stroke-width="2" />
          </span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm">
            <span class="font-medium text-ink-50">{{ maskUsername(n.actor_name) }}</span>
            <span class="text-ink-300 ml-1">回复了你的帖子</span>
          </div>
          <p class="text-xs text-ink-400 mt-1 line-clamp-2">{{ n.comment_content }}</p>
          <div v-if="n.post_content" class="text-[10px] text-ink-300/70 mt-1.5 truncate">
            原帖：{{ n.post_content }}
          </div>
          <div class="text-[10px] text-ink-300 mt-1">{{ timeAgo(n.created_at) }}</div>
        </div>
        <span v-if="!n.read" class="w-2 h-2 rounded-full bg-neon-purple flex-shrink-0 mt-1"></span>
      </div>
    </div>
  </div>
</template>
