// src/types/index.ts

export type BookFormat = 'epub' | 'pdf' | 'txt' | 'mobi'

export interface Book {
  id: string
  user_id: string
  title: string
  author: string | null
  description: string | null
  cover_url: string | null
  file_url: string
  file_format: BookFormat
  file_size: number | null
  language: string | null
  is_public: boolean
  download_count: number
  created_at: string
  updated_at: string
}

export interface ReadingProgress {
  id: string
  user_id: string
  book_id: string
  cfi: string | null
  page: number
  percentage: number
  last_read_at: string
}

export interface Bookmark {
  id: string
  user_id: string
  book_id: string
  cfi: string | null
  page: number | null
  note: string | null
  color: string
  created_at: string
}

export interface Note {
  id: string
  user_id: string
  book_id: string
  cfi: string | null
  page: number | null
  content: string
  comment: string | null
  color: string
  created_at: string
}

export interface Profile {
  id: string
  username: string | null
  avatar_url: string | null
  bio: string | null
  created_at: string
}

// 字体配置
export interface FontOption {
  id: string
  name: string
  family: string
  preview: string
}

export const FONT_OPTIONS: FontOption[] = [
  { id: 'system',   name: '系统默认', family: 'system-ui, -apple-system, sans-serif', preview: 'Aa 默认' },
  { id: 'song',     name: '宋体',     family: '"Songti SC", "STSong", serif',           preview: '宋 体' },
  { id: 'kai',      name: '楷体',     family: '"Kaiti SC", "STKaiti", serif',           preview: '楷 体' },
  { id: 'hei',      name: '黑体',     family: '"Heiti SC", "STHeiti", sans-serif',       preview: '黑 体' },
  { id: 'serif',    name: '衬线英文', family: 'Georgia, "Times New Roman", serif',      preview: 'Serif' },
  { id: 'sans',     name: '无衬线',   family: 'Helvetica, Arial, sans-serif',           preview: 'Sans' },
  { id: 'mono',     name: '等宽',     family: '"JetBrains Mono", Menlo, monospace',     preview: 'Mono' },
]

// 主题（白天/夜间/护眼/羊皮）
export interface ThemeOption {
  id: string
  name: string
  bg: string
  color: string
  hlColor: string
}
export const THEME_OPTIONS: ThemeOption[] = [
  { id: 'light',  name: '日间', bg: '#ffffff', color: '#1f2937', hlColor: '#fef3c7' },
  { id: 'eye',    name: '护眼', bg: '#c7e1c0', color: '#1f2937', hlColor: '#fde68a' },
  { id: 'paper',  name: '羊皮', bg: '#f5e9d0', color: '#3b2f1e', hlColor: '#fbbf24' },
  { id: 'dark',   name: '夜间', bg: '#1a1a1a', color: '#d4d4d4', hlColor: '#854d0e' },
]

// TTS 音色（MiniMax 内置）
export const TTS_VOICES = [
  { id: 'male-qn-jingying',   name: '青涩青年·男' },
  { id: 'male-qn-qianse',     name: '磁性男声' },
  { id: 'female-shaonv',      name: '少女音' },
  { id: 'female-yujie',       name: '成熟女声' },
  { id: 'presenter_male',     name: '主持人·男' },
  { id: 'presenter_female',   name: '主持人·女' },
  { id: 'audiobook_male_1',   name: '有声书·男' },
  { id: 'audiobook_female_1', name: '有声书·女' },
]

// =============================================================
// 第二阶段：阅读统计
// =============================================================
export interface ReadingSession {
  id: number
  user_id: string
  book_id: string
  started_at: string
  duration_sec: number
  words_read: number
  created_at: string
}

export interface ReadingStat {
  id: number
  user_id: string
  book_id: string
  stat_date: string        // 'YYYY-MM-DD'
  total_seconds: number
  total_words: number
  sessions_count: number
}

// =============================================================
// 第三阶段：社区 / 关注 / 成就
// =============================================================
export interface Review {
  id: string
  user_id: string
  book_id: string
  rating: number           // 1~5
  content: string | null
  created_at: string
  profiles?: { username: string | null; avatar_url: string | null } | null
  books?: { title: string; cover_url: string | null } | null
}

export interface Follow {
  follower_id: string
  followee_id: string
  created_at: string
}

export interface Activity {
  id: string
  user_id: string
  type: 'book_shared' | 'review_added' | 'achievement'
  ref_id: string | null
  metadata: Record<string, any>
  created_at: string
  profiles?: { username: string | null; avatar_url: string | null } | null
}

export interface Achievement {
  id: string
  name: string
  description: string
  icon: string | null
  threshold: number
}

export interface UserAchievement {
  user_id: string
  achievement_id: string
  unlocked_at: string
}

export interface UserProfilePublic {
  id: string
  username: string | null
  avatar_url: string | null
  bio: string | null
  created_at: string
  stats?: {
    books_count: number
    total_seconds: number
    followers_count: number
    following_count: number
    achievements_count: number
  }
}
