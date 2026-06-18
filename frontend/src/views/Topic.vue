<script setup lang="ts">
/**
 * Topic - 单个话题页：展示该 tag 下所有帖子
 */
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { listPostsByTag } from '@/lib/books'
import { ArrowLeft, Hash, BookOpen, Heart, Image as ImageIcon } from 'lucide-vue-next'
import { splitContent } from '@/lib/parse'
import UserAvatar from '@/components/UserAvatar.vue'
import EmptyState from '@/components/EmptyState.vue'
import Skeleton from '@/components/Skeleton.vue'

const route = useRoute()
const router = useRouter()
const tag = computed(() => (route.params.tag as string) || '')
const posts = ref<any[]>([])
const loading = ref(false)

async function refresh() {
  if (!tag.value) return
  loading.value = true
  try {
    posts.value = await listPostsByTag(tag.value, 50)
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前'
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前'
  return Math.floor(s / 86400) + ' 天前'
}

function openUser(id: string) { router.push(`/user/${id}`) }
function openPost(id: string) { router.push(`/book/${id}`) }

function handleClick(content: string, e: MouseEvent) {
  // 处理内容里 @xxx / #xxx 点击 - 通过 data 属性识别
  const t = e.target as HTMLElement
  if (t?.dataset?.type === 'mention' && t.dataset.username) {
    // 跳到对应用户主页需要先解析 username → id，这里先做前缀跳转搜索
    e.preventDefault()
    router.push({ path: '/search', query: { q: '@' + t.dataset.username } })
  } else if (t?.dataset?.type === 'tag' && t.dataset.tag) {
    e.preventDefault()
    router.push(`/topic/${t.dataset.tag}`)
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-6">
    <div class="flex items-center gap-2 mb-4">
      <button @click="$router.back()" class="btn-ghost -ml-2 flex items-center gap-1">
        <ArrowLeft class="w-4 h-4" :stroke-width="1.75" />
        <span>返回</span>
      </button>
    </div>

    <div class="card p-5 mb-4 relative overflow-hidden">
      <div class="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-neon-pink/20 blur-3xl" />
      <div class="relative flex items-center gap-3">
        <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-neon-purple/30 to-neon-pink/20
                    border border-neon-purple/30 flex items-center justify-center
                    shadow-[0_0_24px_rgba(168,85,247,0.3)]">
          <Hash class="w-6 h-6 text-neon-pink" :stroke-width="1.75" />
        </div>
        <div class="flex-1 min-w-0">
          <h1 class="text-xl font-bold tracking-tight text-ink-50">#{{ tag }}</h1>
          <p class="text-xs text-ink-300 mt-0.5">话题下的所有帖子</p>
        </div>
      </div>
    </div>

    <div v-if="loading" class="space-y-3">
      <div v-for="i in 3" :key="i" class="card p-4 flex gap-3">
        <Skeleton variant="circle" width="36px" height="36px" />
        <div class="flex-1">
          <Skeleton variant="text" rows="2" />
        </div>
      </div>
    </div>

    <EmptyState
      v-else-if="posts.length === 0"
      :icon="Hash"
      title="还没有帖子使用这个话题"
      description="成为第一个讨论它的人吧"
    />

    <div v-else class="space-y-3">
      <div v-for="p in posts" :key="p.id" class="card p-4 flex gap-3">
        <UserAvatar :user="p.profiles" size="sm" clickable @click="openUser(p.user_id)" />
        <div class="flex-1 min-w-0">
          <div class="text-sm flex items-center gap-2 flex-wrap">
            <span class="font-medium text-ink-50 cursor-pointer hover:underline" @click="openUser(p.user_id)">
              {{ p.profiles?.username || '匿名' }}
            </span>
            <span class="text-xs text-ink-300">{{ timeAgo(p.created_at) }}</span>
          </div>
          <div class="text-sm text-ink-100 mt-1.5 whitespace-pre-wrap break-words" @click="handleClick(p.content, $event)">
            <template v-for="(seg, i) in splitContent(p.content || '')" :key="i">
              <a v-if="seg.type === 'mention'" class="post-link-mention" data-type="mention" :data-username="seg.value">@{{ seg.value }}</a>
              <a v-else-if="seg.type === 'tag'" class="post-link-tag" data-type="tag" :data-tag="seg.value">#{{ seg.value }}</a>
              <span v-else>{{ seg.value }}</span>
            </template>
          </div>
          <div v-if="p.image_url" class="mt-2">
            <img :src="p.image_url" class="rounded-xl max-h-64 object-cover border border-neon-purple/15" />
          </div>
          <div v-if="p.books" class="mt-2 flex items-center gap-2 p-2 bg-ink-800/40 rounded-xl text-xs border border-neon-purple/10"
               @click="openPost(p.book_id)">
            <BookOpen class="w-4 h-4 text-ink-300" :stroke-width="1.75" />
            <span class="line-clamp-1 flex-1 text-ink-100">{{ p.books.title }}</span>
          </div>
          <div class="flex items-center gap-3 mt-2 text-xs text-ink-300">
            <Heart class="w-3.5 h-3.5" :stroke-width="1.75" />
            <span>{{ p.like_count ?? 0 }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>