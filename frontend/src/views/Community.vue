<script setup lang="ts">
import { ref, onMounted, computed, onActivated } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import {
  listPublicBooks, listActivityFeed, searchPublicBooksFulltext,
  getPublicBookUrl, listCommunityPosts, createPost, deletePost, togglePostLike,
  type CommunityPost
} from '@/lib/books'
import { debounce } from '@/lib/utils'
import { Search, Activity, Globe, UserRound, Heart, Download, Send, Trash2, BookOpen } from 'lucide-vue-next'
import BookCard from '@/components/BookCard.vue'

const router = useRouter()
const auth = useAuthStore()
const tab = ref<'feed' | 'books' | 'people'>('feed')
const q = ref('')
const loading = ref(false)

const feed = ref<any[]>([])
const books = ref<any[]>([])
const people = ref<any[]>([])
const posts = ref<CommunityPost[]>([])

const postDraft = ref('')
const posting = ref(false)

const tabs = [
  { id: 'feed', label: '动态', icon: Activity },
  { id: 'books', label: '公开书', icon: Globe },
  { id: 'people', label: '用户', icon: UserRound },
] as const

async function refresh() {
  loading.value = true
  try {
    if (tab.value === 'feed') {
      const [activity, postList] = await Promise.all([
        listActivityFeed(50),
        listCommunityPosts({ limit: 30 }),
      ])
      feed.value = activity
      posts.value = postList
      const m = new Map<string, any>()
      feed.value.forEach((a: any) => {
        if (a.user_id && a.profiles && !m.has(a.user_id)) {
          m.set(a.user_id, { id: a.user_id, ...a.profiles })
        }
      })
      people.value = [...m.values()]
    } else if (tab.value === 'books') {
      books.value = q.value ? await searchPublicBooksFulltext(q.value) : await listPublicBooks({ pageSize: 30 })
    }
  } catch (e: any) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

const refreshDebounced = debounce(refresh, 300)
function onSearch() { refreshDebounced() }

onMounted(refresh)
onActivated(refresh)

function readBook(b: any) {
  router.push(`/book/${b.id}`)
}

function openUser(id: string) {
  router.push(`/user/${id}`)
}

async function downloadBook(b: any) {
  if (!auth.isLoggedIn) { router.push('/login'); return }
  try {
    const url = await getPublicBookUrl(b.id)
    const a = document.createElement('a')
    a.href = url
    a.download = `${b.title}.${b.file_format}`
    a.target = '_blank'
    a.click()
  } catch (e: any) {
    alert('下载失败：' + e.message)
  }
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return s + ' 秒前'
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前'
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前'
  return Math.floor(s / 86400) + ' 天前'
}

function activityText(a: any) {
  if (a.type === 'book_shared') return `公开了《${a.metadata?.title || '一本书'}》`
  if (a.type === 'review_added') return `给《${a.metadata?.book_id?.slice(0, 6) || '某书'}》打了 ${a.metadata?.rating} 星`
  if (a.type === 'achievement') return `解锁了成就`
  return '有动态'
}

async function submitPost() {
  if (!postDraft.value.trim() || !auth.isLoggedIn) return
  posting.value = true
  try {
    const p = await createPost(postDraft.value)
    posts.value = [p, ...posts.value]
    postDraft.value = ''
  } catch (e: any) {
    alert('发布失败：' + e.message)
  } finally {
    posting.value = false
  }
}

async function toggleLike(p: CommunityPost) {
  if (!auth.isLoggedIn) { router.push('/login'); return }
  const wasLiked = !!p.liked_by_me
  p.liked_by_me = !wasLiked
  p.like_count = (p.like_count ?? 0) + (p.liked_by_me ? 1 : -1)
  try {
    const r = await togglePostLike(p.id, wasLiked)
    p.liked_by_me = r.liked
  } catch (e: any) {
    p.liked_by_me = wasLiked
    p.like_count = (p.like_count ?? 0) + (p.liked_by_me ? 1 : -1)
    alert(e.message)
  }
}

async function deleteOwnPost(p: CommunityPost) {
  if (!confirm('确定删除这条帖子？')) return
  try {
    await deletePost(p.id)
    posts.value = posts.value.filter(x => x.id !== p.id)
  } catch (e: any) {
    alert('删除失败：' + e.message)
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-4">
    <div class="flex items-center gap-2 mb-4 sticky top-0 bg-slate-50/80 backdrop-blur-md z-10 py-3 -mx-4 px-4">
      <h1 class="text-2xl font-bold tracking-tight">社区</h1>
      <span class="text-xs text-slate-500">读书人的小圈子</span>
    </div>

    <!-- pill tabs -->
    <div class="inline-flex bg-slate-100 rounded-full p-1 text-sm gap-1 mb-4">
      <button
        v-for="t in tabs"
        :key="t.id"
        @click="tab = t.id; refresh()"
        :class="['px-4 h-8 rounded-full flex items-center gap-1.5 transition',
                 tab === t.id ? 'bg-white shadow-sm font-medium text-slate-900' : 'text-slate-500 hover:text-slate-700']"
      >
        <component :is="t.icon" class="w-3.5 h-3.5" :stroke-width="1.75" />
        <span>{{ t.label }}</span>
      </button>
    </div>

    <!-- 搜索框 -->
    <div v-if="tab === 'books'" class="mb-4">
      <div class="relative">
        <Search class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" :stroke-width="1.75" />
        <input v-model="q" @input="onSearch" placeholder="搜索书名/作者/简介…" class="input pl-10" />
      </div>
    </div>

    <div v-if="loading" class="text-center text-slate-500 py-8">加载中…</div>

    <!-- 动态流 -->
    <div v-else-if="tab === 'feed'" class="space-y-3">
      <!-- 发帖框 -->
      <div v-if="auth.isLoggedIn" class="card p-4">
        <textarea
          v-model="postDraft"
          rows="3"
          maxlength="2000"
          placeholder="说点什么…（最多 2000 字）"
          class="input resize-none"
        />
        <div class="flex justify-between items-center mt-2">
          <span class="text-xs text-slate-400">{{ postDraft.length }} / 2000</span>
          <button
            :disabled="posting || !postDraft.trim()"
            @click="submitPost"
            class="btn-primary h-8 px-3 text-xs disabled:opacity-50"
          >
            <Send class="w-3.5 h-3.5" :stroke-width="1.75" />
            <span>{{ posting ? '发布中…' : '发布' }}</span>
          </button>
        </div>
      </div>

      <!-- 用户帖子 -->
      <div v-for="p in posts" :key="p.id" class="card p-4 flex gap-3">
        <div
          class="w-9 h-9 rounded-full overflow-hidden bg-gradient-to-br from-brand-400 to-brand-600 text-white flex items-center justify-center text-sm font-medium cursor-pointer flex-shrink-0"
          @click="openUser(p.user_id)"
        >
          <img v-if="p.profiles?.avatar_url" :src="p.profiles.avatar_url" class="w-full h-full object-cover" alt="avatar" />
          <span v-else>{{ (p.profiles?.username || '?')[0].toUpperCase() }}</span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm flex items-center gap-2 flex-wrap">
            <span class="font-medium cursor-pointer hover:underline" @click="openUser(p.user_id)">
              {{ p.profiles?.username || '匿名' }}
            </span>
            <span class="text-xs text-slate-400">{{ timeAgo(p.created_at) }}</span>
          </div>
          <div class="text-sm text-slate-800 mt-1.5 whitespace-pre-wrap break-words">{{ p.content }}</div>
          <div v-if="p.books" class="mt-2.5 flex items-center gap-2 p-2 bg-slate-50 rounded-xl text-xs cursor-pointer hover:bg-slate-100 transition"
               @click="p.book_id && router.push(`/book/${p.book_id}`)">
            <img v-if="p.books.cover_url" :src="p.books.cover_url" class="w-8 h-10 object-cover rounded-md" alt="cover" />
            <div v-else class="w-8 h-10 rounded-md bg-slate-200 flex items-center justify-center">
              <BookOpen class="w-4 h-4 text-slate-400" :stroke-width="1.75" />
            </div>
            <span class="line-clamp-1 flex-1">{{ p.books.title }}</span>
          </div>
          <div class="flex items-center gap-3 mt-2.5">
            <button @click="toggleLike(p)" class="text-xs flex items-center gap-1 hover:opacity-70 transition">
              <Heart
                :fill="p.liked_by_me ? 'currentColor' : 'none'"
                :stroke-width="1.75"
                class="w-4 h-4"
                :class="p.liked_by_me ? 'text-rose-500' : 'text-slate-400'"
              />
              <span :class="p.liked_by_me ? 'text-rose-500' : 'text-slate-500'">{{ p.like_count ?? 0 }}</span>
            </button>
            <button v-if="auth.user?.id === p.user_id" @click="deleteOwnPost(p)" class="text-xs text-slate-400 hover:text-rose-500 ml-auto flex items-center gap-1 transition">
              <Trash2 class="w-3.5 h-3.5" :stroke-width="1.75" />
              <span>删除</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 自动动态 -->
      <div v-if="feed.length === 0 && posts.length === 0" class="text-center py-16">
        <Activity class="w-12 h-12 mx-auto text-slate-300 mb-2" :stroke-width="1.5" />
        <p class="text-slate-500">还没有动态，去公开一本书、关注其他人或发个帖吧</p>
      </div>
      <div v-for="a in feed" :key="'act-' + a.id" class="card p-3 flex gap-3 items-center">
        <div
          class="w-9 h-9 rounded-full overflow-hidden bg-gradient-to-br from-brand-400 to-brand-600 text-white flex items-center justify-center text-sm font-medium cursor-pointer flex-shrink-0"
          @click="openUser(a.user_id)"
        >
          <img v-if="a.profiles?.avatar_url" :src="a.profiles.avatar_url" class="w-full h-full object-cover" alt="avatar" />
          <span v-else>{{ (a.profiles?.username || '?')[0].toUpperCase() }}</span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm">
            <span class="font-medium cursor-pointer hover:underline" @click="openUser(a.user_id)">
              {{ a.profiles?.username || '匿名' }}
            </span>
            <span class="text-slate-600 ml-1"> {{ activityText(a) }}</span>
          </div>
          <div class="text-xs text-slate-400 mt-0.5">{{ timeAgo(a.created_at) }}</div>
        </div>
        <button
          v-if="a.type === 'book_shared'"
          @click="readBook({ id: a.ref_id })"
          class="text-xs text-brand-600 hover:underline"
        >查看</button>
      </div>
    </div>

    <!-- 公开书 -->
    <div v-else-if="tab === 'books'">
      <div v-if="books.length === 0" class="text-center py-16">
        <Globe class="w-12 h-12 mx-auto text-slate-300 mb-2" :stroke-width="1.5" />
        <p class="text-slate-500">暂无公开书</p>
      </div>
      <div v-else class="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <BookCard v-for="b in books" :key="b.id" :book="b" :show-format="false" :show-meta="false" @open="readBook">
          <template #actions>
            <div class="flex gap-1.5">
              <button @click="readBook(b)" class="flex-1 text-xs h-7 rounded-lg btn-primary">详情</button>
              <button @click="downloadBook(b)" class="text-xs h-7 px-2.5 rounded-lg btn-secondary" title="下载">
                <Download class="w-3.5 h-3.5" :stroke-width="1.75" />
              </button>
            </div>
          </template>
        </BookCard>
      </div>
    </div>

    <!-- 用户 -->
    <div v-else-if="tab === 'people'" class="space-y-2">
      <div v-if="people.length === 0" class="text-center py-16">
        <UserRound class="w-12 h-12 mx-auto text-slate-300 mb-2" :stroke-width="1.5" />
        <p class="text-slate-500">还没看到人</p>
      </div>
      <div v-for="p in people" :key="p.id" class="card p-3 flex items-center gap-3 cursor-pointer hover:shadow-md transition" @click="openUser(p.id)">
        <div class="w-10 h-10 rounded-full overflow-hidden bg-gradient-to-br from-brand-400 to-brand-600 text-white flex items-center justify-center font-medium flex-shrink-0">
          <img v-if="p.avatar_url" :src="p.avatar_url" class="w-full h-full object-cover" alt="avatar" />
          <span v-else>{{ (p.username || '?')[0].toUpperCase() }}</span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm">{{ p.username || '匿名' }}</div>
          <div class="text-xs text-slate-400 truncate">{{ p.bio || '这个人很懒，什么也没写' }}</div>
        </div>
        <span class="text-xs text-brand-600">查看 →</span>
      </div>
    </div>
  </div>
</template>
