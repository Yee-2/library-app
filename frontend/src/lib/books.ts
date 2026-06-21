// src/lib/books.ts
import { supabase, FUNCTIONS_URL } from './supabase'
import type { Book, BookFormat, ReadingProgress, Bookmark, Note } from '@/types'

const ALLOWED_FORMATS: BookFormat[] = ['epub', 'pdf', 'txt', 'mobi']

export function detectFormat(filename: string): BookFormat | null {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if ((ALLOWED_FORMATS as string[]).includes(ext)) return ext as BookFormat
  return null
}

/** 上传文件到 Supabase Storage 并创建 book 记录 */
export async function uploadBook(file: File, meta: {
  title: string
  author?: string
  description?: string
  isPublic?: boolean
  coverFile?: File | null
}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登录')

  const format = detectFormat(file.name)
  if (!format) throw new Error('不支持的文件格式（仅支持 epub/pdf/txt/mobi）')

  // Storage object key 必须是纯 ASCII —— Supabase Storage 底层 S3 在 key 含
  // 中文/非 ASCII 字符时签名校验会抛 InvalidKey。原始文件名存到 original_filename 字段。
  const objectId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const filePath = `${user.id}/${objectId}.${format}`

  const { error: upErr } = await supabase.storage
    .from('book-files')
    .upload(filePath, file, { contentType: file.type || 'application/octet-stream' })
  if (upErr) throw upErr

  let coverUrl: string | null = null

  // 上传用户指定的封面文件
  if (meta.coverFile) {
    coverUrl = await uploadCoverFile(meta.coverFile, user.id)
  }

  // 无封面文件 + EPUB 格式 → 尝试提取内嵌封面
  if (!coverUrl && format === 'epub') {
    try {
      const embeddedCover = await extractEpubCover(file)
      if (embeddedCover) {
        coverUrl = await uploadCoverFile(embeddedCover, user.id)
      }
    } catch (e) {
      console.warn('[uploadBook] EPUB 封面提取失败（不影响上传）:', e)
    }
  }

  const row: Record<string, any> = {
    user_id: user.id,
    title: meta.title.trim() || file.name.replace(/\.[^.]+$/, ''),
    author: meta.author?.trim() || null,
    description: meta.description?.trim() || null,
    cover_url: coverUrl,
    file_url: filePath,
    file_format: format,
    file_size: file.size,
    is_public: !!meta.isPublic,
    original_filename: file.name,
  }

  let data: any = null
  let error: any = null
  ;({ data, error } = await supabase.from('books').insert(row).select().single())

  // 兼容：006 迁移未跑时 original_filename 列还不存在 → 降级不带该字段再试一次
  if (error && /original_filename.*does not exist/i.test(error.message ?? '')) {
    delete row.original_filename
    ;({ data, error } = await supabase.from('books').insert(row).select().single())
  }

  if (error) throw error
  return data as Book
}

/** 上传封面文件到 Supabase Storage，返回公开 URL */
async function uploadCoverFile(file: File, userId: string): Promise<string> {
  const coverId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const coverExt = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const coverPath = `${userId}/${coverId}.${coverExt}`
  const { error: coverErr } = await supabase.storage
    .from('book-covers')
    .upload(coverPath, file, { contentType: file.type || 'image/jpeg' })
  if (coverErr) throw coverErr
  const { data: pub } = supabase.storage.from('book-covers').getPublicUrl(coverPath)
  return pub.publicUrl
}

/** 从 EPUB 文件中提取封面图片，返回 File 对象；无封面返回 null */
async function extractEpubCover(file: File): Promise<File | null> {
  const ePub = (await import('epubjs')).default
  const buf = await file.arrayBuffer()
  const book = ePub(buf)
  try {
    const coverUrl = await book.coverUrl()
    if (!coverUrl) return null
    const res = await fetch(coverUrl)
    if (!res.ok) return null
    const blob = await res.blob()
    const ext = blob.type.split('/')[1] || 'jpg'
    return new File([blob], `cover.${ext}`, { type: blob.type })
  } catch {
    return null
  } finally {
    book.destroy()
  }
}

export async function listMyBooks() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data as Book[]
}

/**
 * 列出我的本地书（排除在线导入的古登堡书）
 */
export async function listMyLocalBooks() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .eq('user_id', user.id)
    // 通过 NOT EXISTS 排除有 gutenberg_books 记录的书
    .not('id', 'in', `(
      select book_id from public.gutenberg_books
    )`)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data as Book[]
}

/**
 * 列出我的在线古登堡书（JOIN gutenberg_books 拿 language/format）
 */
export async function listMyOnlineBooks() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from('books')
    .select('*, gutenberg_books!inner(language, format, gutenberg_id)')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Array<Book & {
    gutenberg_books: { language: string; format: string | null; gutenberg_id: number }[]
  }>
}

/**
 * 检查一本书是否是古登堡在线书（Reader.vue 用）
 */
export async function checkIsGutenbergBook(bookId: string): Promise<{
  isGutenberg: boolean
  gutenberg_id?: number
  language?: 'zh' | 'en'
  format?: 'epub' | 'txt' | null
} | null> {
  const { data, error } = await supabase
    .from('gutenberg_books')
    .select('gutenberg_id, language, format')
    .eq('book_id', bookId)
    .maybeSingle()
  if (error) {
    console.warn('[checkIsGutenbergBook]', error)
    return null
  }
  if (!data) return { isGutenberg: false }
  return {
    isGutenberg: true,
    gutenberg_id: data.gutenberg_id,
    language: data.language as 'zh' | 'en',
    format: data.format as 'epub' | 'txt' | null,
  }
}

export async function listPublicBooks(opts: { q?: string; page?: number; pageSize?: number } = {}) {
  const page = opts.page ?? 0
  const pageSize = opts.pageSize ?? 20
  let query = supabase
    .from('books')
    .select('*, profiles!books_user_id_profiles_fkey(username)')
    .eq('is_public', true)
    .order('download_count', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1)
  if (opts.q) {
    query = query.or(`title.ilike.%${opts.q}%,author.ilike.%${opts.q}%`)
  }
  const { data, error } = await query
  if (error) throw error
  return data as (Book & { profiles: { username: string | null } | null })[]
}

export async function getBook(id: string) {
  // 优先带 profiles JOIN（获取分享者用户名）
  let { data, error } = await supabase
    .from('books')
    .select('*, profiles!books_user_id_profiles_fkey(username)')
    .eq('id', id)
    .maybeSingle()

  // JOIN 失败时降级：不带 profiles 查询
  if (error || !data) {
    const fallback = await supabase
      .from('books')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (fallback.error) throw fallback.error
    if (!fallback.data) throw new Error('书籍不存在或已被删除')
    data = { ...fallback.data, profiles: null }
  }
  return data
}

export async function deleteBook(book: Book) {
  await supabase.storage.from('book-files').remove([book.file_url])
  if (book.cover_url) {
    const coverPath = book.cover_url.split('/book-covers/')[1]
    if (coverPath) await supabase.storage.from('book-covers').remove([coverPath])
  }
  const { error } = await supabase.from('books').delete().eq('id', book.id)
  if (error) throw error
}

export async function togglePublic(book: Book) {
  const { error } = await supabase
    .from('books')
    .update({ is_public: !book.is_public })
    .eq('id', book.id)
  if (error) throw error
}

export async function getMyBookFileUrl(book: Book) {
  const { data, error } = await supabase.storage
    .from('book-files')
    .createSignedUrl(book.file_url, 3600)
  if (error) throw error
  return data.signedUrl
}

/**
 * 从 gutenberg-fetch Edge Function 拉在线图书，转换为 Blob URL
 * @returns { blobUrl, format, contentType, size }
 */
export async function fetchOnlineBookFile(bookId: string): Promise<{
  blobUrl: string
  format: 'epub' | 'txt'
  contentType: string
  size: number
  fromCache: boolean
}> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('未登录或会话已过期')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)  // 30s 足够 gutenberg.org 下载

  try {
    const res = await fetch(`${FUNCTIONS_URL}/gutenberg-fetch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ book_id: bookId }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`古登堡代理失败 (${res.status}): ${text || '服务暂时不可用'}`)
    }
    const json = await res.json()
    // base64 → bytes → Blob → blob URL
    const binStr = atob(json.data_base64)
    const bytes = new Uint8Array(binStr.length)
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i)
    const blob = new Blob([bytes], { type: json.content_type })
    const blobUrl = URL.createObjectURL(blob)

    return {
      blobUrl,
      format: json.format,
      contentType: json.content_type,
      size: json.size,
      fromCache: !!json.from_cache,
    }
  } catch (e: any) {
    if (e.name === 'AbortError') throw new Error('古登堡代理超时，请检查网络后重试')
    throw e
  } finally {
    clearTimeout(timeout)
  }
}

export async function getPublicBookUrl(bookId: string) {
  const { data: { session } } = await supabase.auth.getSession()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)  // 15s 超时

  try {
    const res = await fetch(`${FUNCTIONS_URL}/public-book-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ book_id: bookId }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`获取下载链接失败 (${res.status}): ${text || '服务暂时不可用'}`)
    }
    return (await res.json()).url as string
  } catch (e: any) {
    if (e.name === 'AbortError') throw new Error('请求超时，请检查网络后重试')
    throw e
  } finally {
    clearTimeout(timeout)
  }
}

/** 检查用户是否已拥有同名书籍 */
export async function findMyDuplicate(title: string): Promise<Book | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('books')
    .select('*')
    .eq('user_id', user.id)
    .ilike('title', title.trim())
    .maybeSingle()
  return data as Book | null
}

/** 检查用户是否已公开同名书籍 */
export async function findMyPublicDuplicate(title: string): Promise<Book | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('books')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_public', true)
    .ilike('title', title.trim())
    .maybeSingle()
  return data as Book | null
}

// =============== 头像 / 资料编辑 ===============

/** 上传头像到 avatars 桶，更新 profiles.avatar_url，返回带 cache-buster 的 URL */
export async function uploadAvatar(file: File): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登录')
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
  if (file.size > 2 * 1024 * 1024) throw new Error('头像不能超过 2MB')

  // ASCII key: <user_id>/<uuid>.<ext>
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const path = `${user.id}/${id}.${ext}`

  const { error: upErr } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type })
  if (upErr) throw upErr

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
  // cache-buster 让旧头像立刻被新头像替换
  const url = `${pub.publicUrl}?t=${Date.now()}`

  const { error: updErr } = await supabase
    .from('profiles')
    .update({ avatar_url: url })
    .eq('id', user.id)
  if (updErr) throw updErr
  return url
}

/** 更新自己的 profile（bio / username） */
export async function updateMyProfile(updates: { bio?: string; username?: string }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登录')
  const clean: Record<string, any> = {}
  if (typeof updates.bio === 'string') clean.bio = updates.bio.trim().slice(0, 200) || null
  if (typeof updates.username === 'string') clean.username = updates.username.trim().slice(0, 30) || null
  if (Object.keys(clean).length === 0) return null
  const { data, error } = await supabase
    .from('profiles')
    .update(clean)
    .eq('id', user.id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function upsertProgress(p: Omit<ReadingProgress, 'id' | 'user_id' | 'last_read_at'>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('reading_progress').upsert(
    { ...p, user_id: user.id, last_read_at: new Date().toISOString() },
    { onConflict: 'user_id,book_id' }
  )
}

export async function getProgress(bookId: string) {
  const { data } = await supabase
    .from('reading_progress')
    .select('*')
    .eq('book_id', bookId)
    .maybeSingle()
  return data as ReadingProgress | null
}

export async function listBookmarks(bookId: string) {
  const { data } = await supabase
    .from('bookmarks')
    .select('*')
    .eq('book_id', bookId)
    .order('created_at', { ascending: false })
  return (data ?? []) as Bookmark[]
}

export async function addBookmark(b: Omit<Bookmark, 'id' | 'user_id' | 'created_at'>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登录')
  const { data, error } = await supabase
    .from('bookmarks')
    .insert({ ...b, user_id: user.id })
    .select()
    .single()
  if (error) throw error
  return data as Bookmark
}

export async function deleteBookmark(id: string) {
  await supabase.from('bookmarks').delete().eq('id', id)
}

export async function listNotes(bookId: string) {
  const { data } = await supabase
    .from('notes')
    .select('*')
    .eq('book_id', bookId)
    .order('created_at', { ascending: false })
  return (data ?? []) as Note[]
}

export async function addNote(n: Omit<Note, 'id' | 'user_id' | 'created_at'>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登录')
  const { data, error } = await supabase
    .from('notes')
    .insert({ ...n, user_id: user.id })
    .select()
    .single()
  if (error) throw error
  return data as Note
}

export async function deleteNote(id: string) {
  await supabase.from('notes').delete().eq('id', id)
}

// =============================================================
// 第二、三阶段：统计 / 社区 / 关注 / 成就
// =============================================================

export async function reportReadingHeartbeat(bookId: string, seconds: number, words: number) {
  if (seconds <= 0 && words <= 0) return
  await supabase.rpc('aggregate_reading_session', {
    p_book_id: bookId,
    p_seconds: seconds,
    p_words: words,
  })
}

export async function getMyReadingSummary(days = 30) {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
  const { data } = await supabase
    .from('reading_stats')
    .select('stat_date, total_seconds, total_words, sessions_count')
    .gte('stat_date', since)
    .order('stat_date', { ascending: true })
  return data ?? []
}

export async function unlockAchievement(id: string) {
  const { data } = await supabase.rpc('unlock_achievement', { p_id: id })
  return !!data
}

export async function listMyAchievements() {
  const { data } = await supabase
    .from('user_achievements')
    .select('*, achievements(*)')
    .order('unlocked_at', { ascending: false })
  return data ?? []
}

export async function listAllAchievements() {
  const { data } = await supabase.from('achievements').select('*').order('threshold')
  return (data ?? []) as Array<{ id: string; name: string; description: string; icon: string | null; threshold: number }>
}

export async function listReviews(bookId: string) {
  const { data } = await supabase
    .from('reviews')
    .select('*, profiles!reviews_user_id_profiles_fkey(username, avatar_url)')
    .eq('book_id', bookId)
    .order('created_at', { ascending: false })
  return (data ?? []) as any[]
}

export async function upsertReview(bookId: string, rating: number, content: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登录')
  const { data, error } = await supabase
    .from('reviews')
    .upsert({ user_id: user.id, book_id: bookId, rating, content }, { onConflict: 'user_id,book_id' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function toggleFavorite(bookId: string, isFavorite: boolean) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登录')
  if (isFavorite) {
    const { error } = await supabase.from('favorites').delete().eq('user_id', user.id).eq('book_id', bookId)
    if (error) throw error
  } else {
    const { error } = await supabase.from('favorites').insert({ user_id: user.id, book_id: bookId })
    if (error) throw error
  }
}

export async function listMyFavorites() {
  const { data } = await supabase
    .from('favorites')
    .select('book_id, books(*, profiles!books_user_id_profiles_fkey(username))')
    .order('created_at', { ascending: false })
  return (data ?? []) as any[]
}

export async function followUser(userId: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登录')
  if (user.id === userId) throw new Error('不能关注自己')
  await supabase.from('follows').insert({ follower_id: user.id, followee_id: userId })
}

export async function unfollowUser(userId: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登录')
  await supabase.from('follows').delete().eq('follower_id', user.id).eq('followee_id', userId)
}

export async function isFollowing(userId: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id === userId) return false
  const { data } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('follower_id', user.id)
    .eq('followee_id', userId)
    .maybeSingle()
  return !!data
}

export async function listFollowers(userId: string) {
  const { data } = await supabase
    .from('follows')
    .select('follower_id, created_at, profiles!follows_follower_id_profiles_fkey(username, avatar_url)')
    .eq('followee_id', userId)
  return (data ?? []) as any[]
}

export async function listFollowing(userId: string) {
  const { data } = await supabase
    .from('follows')
    .select('followee_id, created_at, profiles!follows_followee_id_profiles_fkey(username, avatar_url)')
    .eq('follower_id', userId)
  return (data ?? []) as any[]
}

export async function listActivityFeed(limit = 50) {
  const { data: { user } } = await supabase.auth.getUser()
  let query = supabase
    .from('activity')
    .select('*, profiles!activity_user_id_profiles_fkey(username, avatar_url)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (user) {
    const { data: following } = await supabase.from('follows').select('followee_id').eq('follower_id', user.id)
    const ids = (following ?? []).map((r: any) => r.followee_id)
    // Postgres 的 `IN ()` 是语法错误；没关注任何人时直接返回空数组
    if (ids.length > 0) query = query.in('user_id', ids)
    else return []
  }
  const { data } = await query
  return (data ?? []) as any[]
}

export async function getUserProfile(userId: string) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  const { data: stats } = await supabase.rpc('get_user_stats', { p_user: userId })
  const statsRow = Array.isArray(stats) && stats.length > 0 ? stats[0] : null
  const { data: achievements } = await supabase
    .from('user_achievements')
    .select('*, achievements(*)')
    .eq('user_id', userId)
  return { profile, stats: statsRow, achievements: achievements ?? [] }
}

export async function listUserPublicBooks(userId: string) {
  const { data } = await supabase
    .from('books')
    .select('*')
    .eq('user_id', userId)
    .eq('is_public', true)
    .order('updated_at', { ascending: false })
  return (data ?? []) as any[]
}

export async function searchPublicBooksFulltext(q: string, limit = 30) {
  const { data } = await supabase
    .from('books')
    .select('*, profiles!books_user_id_profiles_fkey(username)')
    .eq('is_public', true)
    .or(`title.ilike.%${q}%,author.ilike.%${q}%,description.ilike.%${q}%`)
    .order('download_count', { ascending: false })
    .limit(limit)
  return (data ?? []) as any[]
}

// =============== 社区帖子 / 点赞 ===============

export interface CommunityPost {
  id: string
  user_id: string
  content: string
  book_id: string | null
  image_url: string | null
  created_at: string
  updated_at: string
  profiles?: { username: string | null; avatar_url: string | null } | null
  books?: { title: string; cover_url: string | null } | null
  like_count?: number
  liked_by_me?: boolean
}

/** 发布社区帖子 */
export async function createPost(content: string, bookId?: string | null, imageUrl?: string | null, tags?: string[]): Promise<CommunityPost> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登录')
  const trimmed = content.trim()
  if (!trimmed && !imageUrl) throw new Error('内容不能为空')
  if (trimmed.length > 2000) throw new Error('内容不能超过 2000 字')
  const row: Record<string, any> = { user_id: user.id, content: trimmed || '', book_id: bookId || null }
  if (imageUrl) row.image_url = imageUrl
  const { data, error } = await supabase
    .from('community_posts')
    .insert(row)
    .select('*, profiles!community_posts_user_id_profiles_fkey(username, avatar_url)')
    .single()
  if (error) throw error

  // 写入话题标签
  if (tags && tags.length) {
    const uniqueTags = [...new Set(tags.filter(t => t.length > 0))]
    if (uniqueTags.length) {
      await supabase.from('post_tags').insert(
        uniqueTags.map(tag => ({ post_id: data.id, tag }))
      )
    }
  }

  return { ...data, like_count: 0, liked_by_me: false, tags: tags || [] } as any
}

/** 列出某话题下的帖子 */
export async function listPostsByTag(tag: string, limit = 30) {
  const { data, error } = await supabase
    .from('post_tags')
    .select(`
      post_id,
      community_posts!inner(
        *,
        profiles!community_posts_user_id_profiles_fkey(username, avatar_url)
      )
    `)
    .eq('tag', tag)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data || []).map((row: any) => row.community_posts)
}

/** 列出某帖子的所有标签 */
export async function listPostTags(postId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('post_tags')
    .select('tag')
    .eq('post_id', postId)
  if (error) return []
  return (data || []).map((r: any) => r.tag)
}

/** 模糊搜索 username（用于 @mention 自动补全） */
export async function searchUsernames(query: string, limit = 8): Promise<{ id: string; username: string; avatar_url: string | null }[]> {
  const q = query.replace(/^@/, '').trim()
  if (!q) return []
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .ilike('username', `%${q}%`)
    .limit(limit)
  if (error) return []
  return (data || []) as any
}

/** 删除自己的帖子 */
export async function deletePost(postId: string) {
  const { error } = await supabase.from('community_posts').delete().eq('id', postId)
  if (error) throw error
}

/** 拉取社区帖子（含 like_count 和 liked_by_me） */
export async function listCommunityPosts(opts: { limit?: number; before?: string } = {}): Promise<CommunityPost[]> {
  const { data: { user } } = await supabase.auth.getUser()
  let query = supabase
    .from('community_posts')
    .select(`
      *,
      profiles!community_posts_user_id_profiles_fkey(username, avatar_url),
      books:book_id (title, cover_url)
    `)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 30)
  if (opts.before) query = query.lt('created_at', opts.before)
  const { data, error } = await query
  if (error) throw error
  const posts = (data ?? []) as CommunityPost[]
  if (posts.length === 0) return []
  const ids = posts.map(p => p.id)
  const { data: likes } = await supabase
    .from('post_likes')
    .select('post_id, user_id')
    .in('post_id', ids)
  const countMap = new Map<string, number>()
  const mineSet = new Set<string>()
  for (const l of (likes ?? []) as any[]) {
    countMap.set(l.post_id, (countMap.get(l.post_id) ?? 0) + 1)
    if (user && l.user_id === user.id) mineSet.add(l.post_id)
  }
  return posts.map(p => ({
    ...p,
    like_count: countMap.get(p.id) ?? 0,
    liked_by_me: mineSet.has(p.id),
  }))
}

/** 点赞 / 取消点赞 */
export async function togglePostLike(postId: string, currentlyLiked: boolean): Promise<{ liked: boolean }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登录')
  if (currentlyLiked) {
    const { error } = await supabase
      .from('post_likes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', user.id)
    if (error) throw error
    return { liked: false }
  } else {
    const { error } = await supabase
      .from('post_likes')
      .insert({ post_id: postId, user_id: user.id })
    // 23505 = unique violation (already liked — treat as success)
    if (error && error.code !== '23505') throw error
    return { liked: true }
  }
}
