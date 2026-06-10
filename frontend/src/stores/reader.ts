// src/stores/reader.ts
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { FONT_OPTIONS, THEME_OPTIONS } from '@/types'

const STORAGE_KEY = 'reader-preferences'

interface ReaderPreferences {
  fontId: string
  fontSize: number
  lineHeight: number
  themeId: string
  maxWidth: number
}

function load(): ReaderPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...defaults(), ...JSON.parse(raw) }
  } catch {}
  return defaults()
}

function defaults(): ReaderPreferences {
  return {
    fontId: 'system',
    fontSize: 18,
    lineHeight: 1.8,
    themeId: 'light',
    maxWidth: 720,
  }
}

export const useReaderStore = defineStore('reader', () => {
  const initial = load()
  const fontId = ref(initial.fontId)
  const fontSize = ref(initial.fontSize)
  const lineHeight = ref(initial.lineHeight)
  const themeId = ref(initial.themeId)
  const maxWidth = ref(initial.maxWidth)

  const font = () => FONT_OPTIONS.find(f => f.id === fontId.value) ?? FONT_OPTIONS[0]
  const theme = () => THEME_OPTIONS.find(t => t.id === themeId.value) ?? THEME_OPTIONS[0]

  function applyTo(el: HTMLElement | null) {
    if (!el) return
    el.style.setProperty('--reader-font-family', font().family)
    el.style.setProperty('--reader-font-size', `${fontSize.value}px`)
    el.style.setProperty('--reader-line-height', String(lineHeight.value))
    el.style.setProperty('--reader-bg', theme().bg)
    el.style.setProperty('--reader-color', theme().color)
    el.style.setProperty('--reader-max-width', `${maxWidth.value}px`)
    el.style.setProperty('--hl-color', theme().hlColor)
  }

  function setFont(id: string) { fontId.value = id }
  function setTheme(id: string) { themeId.value = id }
  function zoom(delta: number) {
    fontSize.value = Math.max(12, Math.min(32, fontSize.value + delta))
  }
  function setLineHeight(v: number) {
    lineHeight.value = Math.max(1.2, Math.min(2.4, v))
  }
  function setMaxWidth(v: number) {
    maxWidth.value = Math.max(480, Math.min(960, v))
  }

  // 持久化
  watch([fontId, fontSize, lineHeight, themeId, maxWidth], () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      fontId: fontId.value, fontSize: fontSize.value, lineHeight: lineHeight.value,
      themeId: themeId.value, maxWidth: maxWidth.value,
    }))
  })

  return {
    fontId, fontSize, lineHeight, themeId, maxWidth,
    font, theme, applyTo, setFont, setTheme, zoom, setLineHeight, setMaxWidth,
  }
})
