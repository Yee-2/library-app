// supabase/functions/gutenberg-fetch/cache.ts
// 内存缓存：Map<key, {bytes, format, ts}>
// 生命周期 = Edge Function 实例生命周期，重启即清空
// 容量 = Edge Function 内存限制（默认 256MB）

const cache = new Map<string, {
  bytes: Uint8Array;
  format: string;
  contentType: string;
  ts: number;
}>();

// LRU 阈值：100MB，超过时清理最早的 50% 条目
const MAX_BYTES = 100 * 1024 * 1024;
const CLEANUP_RATIO = 0.5;

function currentBytes(): number {
  let total = 0;
  for (const v of cache.values()) total += v.bytes.byteLength;
  return total;
}

function maybeEvict(): void {
  if (currentBytes() < MAX_BYTES) return;
  // Map 保留插入顺序，删除最早的一半
  const removeCount = Math.floor(cache.size * CLEANUP_RATIO);
  const keys = Array.from(cache.keys()).slice(0, removeCount);
  for (const k of keys) cache.delete(k);
  console.log(`[cache] evicted ${removeCount} entries, remaining: ${cache.size}`);
}

export function get(key: string) {
  const v = cache.get(key);
  if (v) {
    // LRU: 删除再插入，让它变最新
    cache.delete(key);
    cache.set(key, v);
  }
  return v ?? null;
}

export function set(
  key: string,
  bytes: Uint8Array,
  format: string,
  contentType: string
): void {
  cache.set(key, { bytes, format, contentType, ts: Date.now() });
  maybeEvict();
}

export function clear(): void {
  cache.clear();
}

export function stats() {
  return {
    entries: cache.size,
    bytes: currentBytes(),
  };
}