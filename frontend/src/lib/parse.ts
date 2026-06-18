/**
 * 帖子文本解析
 * - extractMentions: 从文本中抽取 @username 列表
 * - extractTags: 从文本中抽取 #tag 列表
 * - splitContent: 把 content 切成片段（plain / mention / tag），便于渲染层高亮
 */

const MENTION_REGEX = /(?:^|\s)@([\w一-龥]{2,30})/g
const TAG_REGEX = /(?:^|\s)#([\w一-龥]{1,30})/g

export interface ParsedSegment {
  type: 'text' | 'mention' | 'tag'
  value: string
  // for mention: username; for tag: tag (without #)
}

export function extractMentions(text: string): string[] {
  if (!text) return []
  const out = new Set<string>()
  let m: RegExpExecArray | null
  MENTION_REGEX.lastIndex = 0
  while ((m = MENTION_REGEX.exec(text)) !== null) out.add(m[1])
  return [...out]
}

export function extractTags(text: string): string[] {
  if (!text) return []
  const out = new Set<string>()
  let m: RegExpExecArray | null
  TAG_REGEX.lastIndex = 0
  while ((m = TAG_REGEX.exec(text)) !== null) out.add(m[1])
  return [...out]
}

/**
 * 把文本切分为片段：依次扫描，遇到 @xxx / #xxx 切出来
 * - 保留原文中所有空白
 */
export function splitContent(text: string): ParsedSegment[] {
  if (!text) return []
  const segments: ParsedSegment[] = []
  const tokenRegex = /(@[\w一-龥]{2,30})|(#[\w一-龥]{1,30})/g
  let cursor = 0
  let m: RegExpExecArray | null
  while ((m = tokenRegex.exec(text)) !== null) {
    if (m.index > cursor) {
      segments.push({ type: 'text', value: text.slice(cursor, m.index) })
    }
    if (m[1]) segments.push({ type: 'mention', value: m[1].slice(1) })
    else if (m[2]) segments.push({ type: 'tag', value: m[2].slice(1) })
    cursor = m.index + m[0].length
  }
  if (cursor < text.length) {
    segments.push({ type: 'text', value: text.slice(cursor) })
  }
  return segments
}