<script setup lang="ts">
import { ref, onMounted, onActivated, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import {
  listPublicBooks, listActivityFeed, searchPublicBooksFulltext,
  getPublicBookUrl, listCommunityPosts, createPost, deletePost, togglePostLike,
  uploadAvatar,
  type CommunityPost
} from '@/lib/books'
import { debounce } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import {
  Search, Activity, Globe, UserRound, Heart, Download, Send, Trash2,
  BookOpen, Plus, X, Image as ImageIcon, Smile
} from 'lucide-vue-next'
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

// ---- 发帖弹窗 ----
const showComposer = ref(false)
const postDraft = ref('')
const posting = ref(false)
const postImageUrl = ref<string | null>(null)
const postImageUploading = ref(false)
const showEmojiPicker = ref(false)

const EMOJI_LIST = [
  '😀','😂','🤣','😊','😍','🥰','😎','🤔','😢','😭',
  '😡','🥳','🤩','😏','😴','🤗','😱','🤯','🥺','😤',
  '👍','👎','❤️','🔥','⭐','🎉','💪','🙏','👀','✅',
  '❌','💡','📚','📖','✨','🌟','💖','🎵','☕','🌙',
  '🌈','🐱','🐶','🌸','🍀','🎨','🎭','🏠','🌍','🦋',
]

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

// ---- 发帖逻辑 ----
function openComposer() {
  if (!auth.isLoggedIn) { router.push('/login'); return }
  postDraft.value = ''
  postImageUrl.value = null
  showEmojiPicker.value = false
  showComposer.value = true
}

function closeComposer() {
  showComposer.value = false
  postDraft.value = ''
  postImageUrl.value = null
  showEmojiPicker.value = false
}

function insertEmoji(emoji: string) {
  postDraft.value += emoji
  showEmojiPicker.value = false
}

async function onPostImagePick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.size > 5 * 1024 * 1024) { alert('图片不能超过 5MB'); return }
  postImageUploading.value = true
  try {
    // 上传到 avatars 桶（已公开，已有 RLS 策略）
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('未登录')
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const path = `posts/${user.id}/${id}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('book-covers')
      .upload(path, file, { contentType: file.type })
    if (upErr) throw upErr
    const { data: pub } = supabase.storage.from('book-covers').getPublicUrl(path)
    postImageUrl.value = pub.publicUrl
  } catch (err: any) {
    alert('图片上传失败：' + err.message)
  } finally {
    postImageUploading.value = false
    ;(e.target as HTMLInputElement).value = ''
  }
}

function removePostImage() {
  postImageUrl.value = null
}

async function submitPost() {
  if (!postDraft.value.trim() && !postImageUrl.value) return
  posting.value = true
  try {
    const p = await createPost(postDraft.value, null, postImageUrl.value)
    posts.value = [p, ...posts.value]
    closeComposer()
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
    <!-- 顶部标题栏 -->
    <div class="flex items-center justify-between mb-4 sticky top-0 bg-slate-50/80 backdrop-blur-md z-10 py-3 -mx-4 px-4">
      <div class="flex items-center gap-2">
        <h1 class="text-2xl font-bold tracking-tight">社区</h1>
        <span class="text-xs text-slate-500">读书人的小圈子</span>
      </div>
      <button
        @click="openComposer"
        class="btn-icon btn-primary"
        title="发动态"
      >
        <Plus class="w-5 h-5" :stroke-width="2" />
      </button>
    </div>

    <!-- pill tabs -->
    <div class="inline-flex bg-slate-100 rounded-full p-1 text-sm gap-1 mb-4">
      <button
        v-for="t in [
          { id: 'feed', label: '动态', icon: Activity },
          { id: 'books', label: '公开书', icon: Globe },
          { id: 'people', label: '用户', icon: UserRound },
        ] as const"
        :key="t.id"
        @click="tab = t.id; refresh()"
        :class="['px-4 h-8 rounded-full flex items-center gap-1.5 transition',
                 tab === t.id ? 'bg-white shadow-sm font-medium text-slate-900' : 'text-slate-500 hover:text-slate-700']"
      >
        <component :is="t.icon" class="w-3.5 h-3.5" :stroke-width="1.75" />
        <span>{{ t.label }}</span>
      </button>
    </div>

    <!-- 搜索框（公开书 tab） -->
    <div v-if="tab === 'books'" class="mb-4">
      <div class="relative">
        <Search class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" :stroke-width="1.75" />
        <input v-model="q" @input="onSearch" placeholder="搜索书名/作者/简介…" class="input pl-10" />
      </div>
    </div>

    <div v-if="loading" class="text-center text-slate-500 py-8">加载中…</div>

    <!-- 动态流 -->
    <div v-else-if="tab === 'feed'" class="space-y-3">
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
          <div v-if="p.content" class="text-sm text-slate-800 mt-1.5 whitespace-pre-wrap break-words">{{ p.content }}</div>
          <!-- 帖子图片 -->
          <div v-if="p.image_url" class="mt-2">
            <img :src="p.image_url" class="rounded-xl max-h-64 object-cover border border-slate-100" alt="帖子图片" loading="lazy" />
          </div>
          <!-- 附书 -->
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

      <!-- 空状态 -->
      <div v-if="feed.length === 0 && posts.length === 0" class="text-center py-16">
        <Activity class="w-12 h-12 mx-auto text-slate-300 mb-2" :stroke-width="1.5" />
        <p class="text-slate-500">还没有动态，去公开一本书、关注其他人或发个帖吧</p>
      </div>

      <!-- 自动动态 -->
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

    <!-- ========== 发帖底部弹窗 ========== -->
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-150"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showComposer"
        class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end justify-center"
        @click.self="closeComposer"
      >
        <div class="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[85vh] flex flex-col">
          <!-- 弹窗头部 -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <button @click="closeComposer" class="btn-icon btn-ghost -m-2">
              <X class="w-5 h-5" :stroke-width="1.75" />
            </button>
            <span class="font-semibold text-sm">发动态</span>
            <button
              :disabled="posting || (!postDraft.trim() && !postImageUrl)"
              @click="submitPost"
              class="btn-primary h-8 px-4 text-xs disabled:opacity-50"
            >
              {{ posting ? '发布中…' : '发布' }}
            </button>
          </div>

          <!-- 内容区 -->
          <div class="flex-1 overflow-auto p-4">
            <textarea
              ref="composerTextarea"
              v-model="postDraft"
              rows="5"
              maxlength="2000"
              placeholder="分享你的阅读心得…"
              class="w-full border-0 outline-none resize-none text-sm leading-relaxed placeholder:text-slate-400"
              style="min-height: 120px;"
            ></textarea>

            <!-- 图片预览 -->
            <div v-if="postImageUrl" class="mt-2 relative inline-block">
              <img :src="postImageUrl" class="rounded-xl max-h-48 object-cover border border-slate-100" alt="预览" />
              <button @click="removePostImage" class="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-slate-800/80 text-white flex items-center justify-center">
                <X class="w-3.5 h-3.5" :stroke-width="2" />
              </button>
            </div>
            <div v-if="postImageUploading" class="mt-2 text-xs text-slate-500">图片上传中…</div>
          </div>

          <!-- 底部工具栏 -->
          <div class="flex items-center gap-2 px-4 py-3 border-t border-slate-100">
            <label class="btn-icon btn-ghost cursor-pointer" title="添加图片">
              <ImageIcon class="w-5 h-5 text-slate-500" :stroke-width="1.75" />
              <input type="file" accept="image/*" class="hidden" @change="onPostImagePick" />
            </label>
            <div class="relative">
              <button
                @click="showEmojiPicker = !showEmojiPicker"
                class="btn-icon btn-ghost"
                title="表情"
              >
                <Smile class="w-5 h-5 text-slate-500" :stroke-width="1.75" />
              </button>
              <!-- 表情选择器 -->
              <Transition
                enter-active-class="transition duration-150"
                leave-active-class="transition duration-100"
                enter-from-class="opacity-0 scale-95"
                leave-to-class="opacity-0 scale-95"
              >
                <div
                  v-if="showEmojiPicker"
                  class="absolute bottom-12 left-0 bg-white border border-slate-200 rounded-2xl shadow-lg p-3 w-72 max-h-48 overflow-auto z-10"
                >
                  <div class="grid grid-cols-10 gap-1">
                    <button
                      v-for="emoji in EMOJI_LIST"
                      :key="emoji"
                      @click="insertEmoji(emoji)"
                      class="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 transition text-base"
                    >{{ emoji }}</button>
                  </div>
                </div>
              </Transition>
            </div>
            <div class="flex-1"></div>
            <span class="text-xs text-slate-400">{{ postDraft.length }} / 2000</span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
