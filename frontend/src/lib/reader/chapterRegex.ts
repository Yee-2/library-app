// src/lib/reader/chapterRegex.ts

/**
 * 识别 TXT 章节标题的正则。匹配：
 * - 第N章 / 第N节 / 第N回 / 第N卷 / 第N篇 / 第N集 / 第N部（N 为中文数字或阿拉伯数字）
 * - 序章 / 序言 / 前言 / 楔子 / 尾声 / 番外 / 后记
 * - Chapter 1 / CHAPTER 1 / CHAPTER IV（不区分大小写）
 */
export const CHAPTER_RE = /^(?:\s*)(第[\d一-龥一二三四五六七八九十百千零两]+[章节回卷篇集部]|序章|序言|前言|楔子|尾声|番外|后记|Chapter\s+\d+|CHAPTER\s+\d+|CHAPTER\s+[IVX]+)/i

export interface TxtChapter {
  id: string
  label: string
  index: number
}

/** 扫描纯文本，识别章节标题。返回章节列表（id 顺序递增）。 */
export function detectTxtChapters(text: string): TxtChapter[] {
  const lines = text.split(/\r?\n/)
  const found: TxtChapter[] = []
  let charPos = 0
  for (let i = 0; i < lines.length; i++) {
    if (CHAPTER_RE.test(lines[i])) {
      found.push({
        id: 'txt-ch-' + found.length,
        label: lines[i].trim().slice(0, 60),
        index: charPos,
      })
    }
    charPos += lines[i].length + 1
  }
  return found
}