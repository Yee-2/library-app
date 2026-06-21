// supabase/functions/gutenberg-sync/index.ts
// 手动同步古登堡目录：下载 pg_catalog.csv → 流式解析 → UPSERT 到 gutenberg_catalog
//
// 鉴权：管理员（用 ADMIN_USER_IDS 环境变量白名单，逗号分隔）
//
// 流式设计说明：
//   pg_catalog.csv 约 21MB / 7 万行。如果用 csvRes.text() 一次性加载 + parseCsv 转 2D 数组，
//   内存占用会超过 Edge Function 的 256MB 限制导致 WORKER_RESOURCE_LIMIT。
//   改用逐行流式解析，每 500 行 flush 一次 UPSERT，减少内存峰值。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ADMIN_USER_IDS = (Deno.env.get("ADMIN_USER_IDS") ?? "").split(",").map(s => s.trim()).filter(Boolean);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CATALOG_URL = "https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv";
const DOWNLOAD_TIMEOUT_MS = 120000;  // 120s: 21MB CSV 下载 + 流式处理
const BATCH_SIZE = 500;
const ALLOWED_LANGS = new Set(["zh", "en"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // 鉴权
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing authorization" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    // 管理员校验
    if (ADMIN_USER_IDS.length === 0 || !ADMIN_USER_IDS.includes(user.id)) {
      return json({ error: "Forbidden: admin only" }, 403);
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(SUPABASE_URL, serviceKey);

    // ============================================
    // 流式下载 + 逐行解析
    // ============================================
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    let csvRes: Response;
    try {
      csvRes = await fetch(CATALOG_URL, { signal: controller.signal });
    } catch (e) {
      clearTimeout(timeoutId);
      return json({ error: "csv_download_failed", detail: String(e) }, 502);
    }
    clearTimeout(timeoutId);

    if (!csvRes.ok) {
      return json({ error: "csv_download_failed", status: csvRes.status }, 502);
    }

    // 流式逐行解析
    const reader = csvRes.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // header 索引
    let idx: { id: number; title: number; author: number; language: number } | null = null;

    // 批处理
    const langCounts: Record<string, number> = { zh: 0, en: 0 };
    let batch: any[] = [];
    let totalSynced = 0;
    let totalSkipped = 0;
    let headerDone = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // 处理最后一行
        if (buffer.trim().length > 0) {
          processLine(buffer, idx!, langCounts, batch);
        }
        // 处理剩余批次
        if (batch.length > 0) {
          await upsertBatch(admin, batch);
          totalSynced += batch.length;
          batch = [];
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // 按行切分
      // 换行符可能是 \n 或 \r\n
      let newlineIdx: number;
      let prevIdx = 0;

      while ((newlineIdx = buffer.indexOf("\n", prevIdx)) !== -1) {
        let line: string;

        // 处理 \r\n
        if (newlineIdx > 0 && buffer[newlineIdx - 1] === "\r") {
          line = buffer.slice(prevIdx, newlineIdx - 1);
        } else {
          line = buffer.slice(prevIdx, newlineIdx);
        }

        prevIdx = newlineIdx + 1;

        // 跳过空行
        if (line.length === 0) continue;

        // 检查行是否完整（引号闭合）
        const quoteCount = (line.match(/"/g) || []).length;
        if (quoteCount % 2 !== 0) {
          // 引号未闭合 -> 跨行了，说明这一行不完整，继续积累 buffer
          // 但跨行字段在 pg_catalog.csv 里极少见，我们保留该行在 buffer 里由下一轮处理
          // 实际上我们不截断 buffer，而是在下一轮继续积累
          // 但为了不无限循环，如果 prevIdx 没有推进，需要跳出
          break;
        }

        // 更新 header 或处理数据行
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;

        if (!headerDone) {
          // 第一行是 header
          const parts = parseCsvLine(trimmed);
          const hId = parts.indexOf("Text#");
          const hTitle = parts.indexOf("Title");
          const hAuthor = parts.indexOf("Authors");
          const hLang = parts.indexOf("Language");
          if (hId < 0 || hTitle < 0 || hLang < 0) {
            return json({ error: "csv_missing_columns", got_header: parts }, 400);
          }
          idx = { id: hId, title: hTitle, author: hAuthor, language: hLang };
          headerDone = true;
        } else {
          const fields = parseCsvLine(trimmed);
          if (fields.length <= Math.max(idx!.id, idx!.title, idx!.language)) continue;

          const lang = (fields[idx!.language] ?? "").trim().toLowerCase();
          if (!ALLOWED_LANGS.has(lang)) {
            totalSkipped++;
            continue;
          }

          const gId = parseInt(fields[idx!.id], 10);
          if (!gId) { totalSkipped++; continue; }

          const title = (fields[idx!.title] ?? "").trim();
          if (!title) { totalSkipped++; continue; }

          const author = (fields[idx!.author] ?? "").trim();

          langCounts[lang] = (langCounts[lang] ?? 0) + 1;

          batch.push({
            gutenberg_id: gId,
            title: title.slice(0, 500),
            author: author.slice(0, 500) || null,
            language: lang,
            epub_url: `https://www.gutenberg.org/ebooks/${gId}.epub3.images`,
            txt_url: `https://www.gutenberg.org/ebooks/${gId}.txt.utf-8`,
            cover_url: null,
            updated_at: new Date().toISOString(),
          });

          if (batch.length >= BATCH_SIZE) {
            await upsertBatch(admin, batch);
            totalSynced += batch.length;
            batch = [];
            if (totalSynced % 5000 === 0) {
              console.log(`[sync] progress: ${totalSynced} synced, ${totalSkipped} skipped`);
            }
          }
        }
      }

      // 截断已处理部分
      buffer = buffer.slice(prevIdx);

      // 限制 buffer 大小防止跨行泄漏（跨行字段安全兜底）
      if (buffer.length > 1024 * 1024) {
        console.warn("[sync] buffer exceeded 1MB, resetting (possible corrupt line)");
        buffer = "";
      }
    }

    return json({
      ok: true,
      synced: totalSynced,
      skipped: totalSkipped,
      languages: langCounts,
    });
  } catch (e) {
    console.error("gutenberg-sync error:", e);
    return json({ error: "internal_error", message: String(e) }, 500);
  }
});

/**
 * 解析单行 CSV（处理引号内的逗号/换行）
 * 注：这里假设单行内引号已闭合（上层已做完整性检查）
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const c = line[i];

    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (c === ",") {
      fields.push(field);
      field = "";
      i++;
      continue;
    }

    field += c;
    i++;
  }

  fields.push(field);
  return fields;
}

async function upsertBatch(admin: any, batch: any[]) {
  const { error } = await admin
    .from("gutenberg_catalog")
    .upsert(batch, { onConflict: "gutenberg_id" });

  if (error) {
    console.error("[sync] batch upsert error:", error.message);
    throw error;
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
