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

  // 文件路径：{user_id}/{timestamp}-{filename}
  const safeName = file.name.replace(/[^\w.一-龥-]/g, '_')
  const filePath = `${user.id}/${Date.now()}-${safeName}`

  // 1. 上传图书文件
  const { error: upErr } = await supabase.storage
    .from('book-files')
    .upload(filePath, file, { contentType: file.type || 'application/octet-stream' })
  if (upErr) throw upErr

  // 2. 上传封面（可选）
  let coverUrl: string | null = null
  if (meta.coverFile) {
    const coverPath = `${user.id}/${Date.now()}-cover-${meta.coverFile.name}`
    const { error: coverErr } = await supabase.storage
      .from('book-covers')
      .upload(coverPath, meta.coverFile)
    if (!coverErr) {
      const { data: pub } = supabase.storage.from('book-covers').getPublicUrl(coverPath)
      coverUrl = pub.publicUrl
    }
  }

  // 3. 写数据库
  const { data, error } = await supabase
    .from('books')
    .insert({
      user_id: user.id,
      title: meta.title.trim() || file.name.replace(/\.[^.]+$/, ''),
      author: meta.author?.trim() || null,
      description: meta.description?.trim() || null,
      cover_url: coverUrl,
      file_url: filePath,
      file_format: format,
      file_size: file.size,
      is_public: !!meta.isPublic,
    })
    .select()
    .single()
  if (error) throw error
  return data as Book
}

/** 获取当前用户的所有书（书架） */
export async function listMyBooks() {
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data as Book[]
}

/** 公开书库（分页 + 搜索） */
export async function listPublicBooks(opts: { q?: string; page?: number; pageSize?: number } = {}) {
  const page = opts.page ?? 0
  const pageSize = opts.pageSize ?? 20
  let query = supabase
    .from('books')
    .select('*, profiles(username)')
    .eq('is_public', true)
    .order('download_count', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1)
  if (opts.q) {
    // 全文检索
    query = query.or(`title.ilike.%${opts.q}%,author.ilike.%${opts.q}%`)
  }
  const { data, error } = await query
  if (error) throw error
  return data as (Book & { profiles: { username: string | null } | null })[]
}

/** 获取单本书 */
export async function getBook(id: string) {
  const { data, error } = await supabase
    .from('books')
    .select('*, profiles(username)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

/** 删除一本书 */
export async function deleteBook(book: Book) {
  // 1. 删 storage
  await supabase.storage.from('book-files').remove([book.file_url])
  if (book.cover_url) {
    const coverPath = book.cover_url.split('/book-covers/')[1]
    if (coverPath) await supabase.storage.from('book-covers').remove([coverPath])
  }
  // 2. 删数据库
  const { error } = await supabase.from('books').delete().eq('id', book.id)
  if (error) throw error
}

/** 切换公开状态 */
export async function togglePublic(book: Book) {
  const { error } = await supabase
    .from('books')
    .update({ is_public: !book.is_public })
    .eq('id', book.id)
  if (error) throw error
}

/** 获取当前用户对某书的文件签名 URL（用于阅读） */
export async function getMyBookFileUrl(book: Book) {
  const { data, error } = await supabase.storage
    .from('book-files')
    .createSignedUrl(book.file_url, 3600)
  if (error) throw error
  return data.signedUrl
}

/** 获取公开书下载链接（通过 Edge Function） */
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

// =============== 阅读进度 / 书签 / 笔记 ===============

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
