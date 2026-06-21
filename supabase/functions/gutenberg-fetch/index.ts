// supabase/functions/gutenberg-fetch/index.ts
// 古登堡图书阅读代理：查 catalog 拿 URL → 缓存命中 or 代理下载 → 返回 base64
// Deploy: supabase functions deploy gutenberg-fetch --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { get, set } from "./cache.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DOWNLOAD_TIMEOUT_MS = 15000;

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
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // 入参
    const { book_id } = await req.json();
    if (!book_id) {
      return json({ error: "book_id required" }, 400);
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(SUPABASE_URL, serviceKey);

    // 1. 查 gutenberg_books 拿到 gutenberg_id + language + format
    const { data: gb, error: gbErr } = await admin
      .from("gutenberg_books")
      .select(`
        gutenberg_id,
        language,
        format,
        books!inner(user_id)
      `)
      .eq("book_id", book_id)
      .single();

    if (gbErr || !gb) {
      return json({ error: "not_a_gutenberg_book" }, 404);
    }

    // 验证归属
    const ownerId = (gb as any).books?.user_id;
    if (ownerId !== user.id) {
      return json({ error: "forbidden" }, 403);
    }

    // 2. 决定 format（首次阅读默认 epub）
    let format: "epub" | "txt" = (gb.format as any) ?? "epub";
    if (!gb.format) {
      // 首次阅读，UPDATE format
      await admin
        .from("gutenberg_books")
        .update({ format })
        .eq("book_id", book_id);
    }

    // 3. 查缓存
    const cacheKey = `${gb.gutenberg_id}:${format}`;
    const cached = get(cacheKey);
    if (cached) {
      return json({
        from_cache: true,
        format: cached.format,
        content_type: cached.contentType,
        size: cached.bytes.byteLength,
        data_base64: encodeBase64(cached.bytes),
      });
    }

    // 4. 从 gutenberg_catalog 拿下载 URL
    const { data: cat } = await admin
      .from("gutenberg_catalog")
      .select("epub_url, txt_url")
      .eq("gutenberg_id", gb.gutenberg_id)
      .eq("language", gb.language)
      .single();

    const downloadUrl = format === "epub"
      ? (cat?.epub_url ?? `https://www.gutenberg.org/ebooks/${gb.gutenberg_id}.epub3.images`)
      : (cat?.txt_url ?? `https://www.gutenberg.org/ebooks/${gb.gutenberg_id}.txt.utf-8`);

    const contentType = format === "epub" ? "application/epub+zip" : "text/plain; charset=utf-8";

    // 5. 代理下载（带超时）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    let downloadRes: Response;
    try {
      downloadRes = await fetch(downloadUrl, {
        signal: controller.signal,
        redirect: "follow",
      });
    } catch (e) {
      clearTimeout(timeoutId);
      return json({ error: "fetch_failed", detail: String(e) }, 502);
    }
    clearTimeout(timeoutId);

    if (!downloadRes.ok) {
      return json({
        error: "fetch_failed",
        status: downloadRes.status,
        detail: `upstream returned ${downloadRes.status}`,
      }, 502);
    }

    const bytes = new Uint8Array(await downloadRes.arrayBuffer());

    // 6. 写缓存
    set(cacheKey, bytes, format, contentType);

    return json({
      from_cache: false,
      format,
      content_type: contentType,
      size: bytes.byteLength,
      data_base64: encodeBase64(bytes),
    });
  } catch (e) {
    console.error("gutenberg-fetch error:", e);
    return json({ error: "internal_error", message: String(e) }, 500);
  }
});

function encodeBase64(bytes: Uint8Array): string {
  // 用 btoa 处理大文件需要分块
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}