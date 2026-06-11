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
  if (meta.coverFile) {
    const coverId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const coverExt = (meta.coverFile.name.split('.').pop() || 'jpg').toLowerCase()
    const coverPath = `${user.id}/${coverId}.${coverExt}`
    const { error: coverErr } = await supabase.storage
      .from('book-covers')
      .upload(coverPath, meta.coverFile)
    if (!coverErr) {
      const { data: pub } = supabase.storage.from('book-covers').getPublicUrl(coverPath)
      coverUrl = pub.publicUrl
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
  const { data, error } = await supabase
    .from('books')
    .select('*, profiles!books_user_id_profiles_fkey(username)')
    .eq('id', id)
    .single()
  if (error) throw error
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

export async function getPublicBookUrl(bookId: string) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${FUNCTIONS_URL}/public-book-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({ book_id: bookId }),
  })
  if (!res.ok) throw new Error('获取下载链接失败')
  return (await res.json()).url as string
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
    .select('follower_id, profiles!follows_follower_id_fkey(username, avatar_url)')
    .eq('followee_id', userId)
  return (data ?? []) as any[]
}

export async function listFollowing(userId: string) {
  const { data } = await supabase
    .from('follows')
    .select('followee_id, profiles!follows_followee_id_fkey(username, avatar_url)')
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
