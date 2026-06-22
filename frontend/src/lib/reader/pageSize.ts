// src/lib/reader/pageSize.ts

/**
 * 根据视口高度动态计算每页字符数。
 *
 * 注意：当前实现基于硬编码值（lineHeight=32, charsPerLine=18），在窗口尺寸变化时
 * 返回值会跳变，导致 txtTotalPages 跳变。本 spec 阶段 2 不修复该问题（属独立 spec）。
 * 阶段 2 仅做抽取。
 */
export function calcTxtPageSize(containerEl: HTMLElement | null): number {
  const vh = containerEl?.clientHeight || window.innerHeight - 120
  const lineHeight = 32   // 18px * 1.8 行高
  const padding = 48
  const linesPerPage = Math.floor((vh - padding) / lineHeight)
  const charsPerLine = 18
  return Math.max(300, linesPerPage * charsPerLine)
}