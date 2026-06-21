// supabase/functions/wikisource-import/index.ts
// 导入维基文库图书：鉴权 → 验证页面是否存在 → 事务写 books + wikisource_books
//
// 请求：POST { page_title: string, language?: string }
// 成功响应：{ book_id, page_title, exists: false } (201)
// 已导入：{ book_id, exists: true } (200)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const WIKI_API = "https://zh.wikisource.org/w/api.php";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    // 入参校验
    const { page_title, language = "zh" } = await req.json();
    if (!page_title || typeof page_title !== "string") {
      return json({ error: "page_title (string) required" }, 400);
    }

    // 调用维基文库 API 验证页面存在 + 获取信息
    const wsUrl = `${WIKI_API}?action=query&titles=${encodeURIComponent(page_title)}&prop=info&format=json&origin=*`;
    const wsRes = await fetch(wsUrl, { signal: AbortSignal.timeout(10000) });
    const wsData = await wsRes.json();
    const pages = wsData?.query?.pages ?? {};
    const page = Object.values(pages)[0] as any;
    if (!page || page.missing !== undefined) {
      return json({ error: "page_not_found", message: `维基文库中没有找到"${page_title}"` }, 404);
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(SUPABASE_URL, serviceKey);

    // 查重：用户是否已导入这本书
    const { data: existing } = await admin
      .from("wikisource_books")
      .select("book_id, books!inner(user_id)")
      .eq("page_id", page.pageid);

    const ownedExisting = (existing ?? []).find(
      (row: any) => row.books?.user_id === user.id
    );
    if (ownedExisting) {
      return json({
        exists: true,
        book_id: ownedExisting.book_id,
        message: "已在你的书架",
      }, 200);
    }

    // 计算子页面数（多章节作品）
    const subRes = await fetch(
      `${WIKI_API}?action=query&list=categorymembers&cmtitle=Category:${encodeURIComponent(page_title)}&cmtype=page&format=json&origin=*&cmlimit=500`,
      { signal: AbortSignal.timeout(10000) }
    );
    const subData = await subRes.json();
    const chapters = subData?.query?.categorymembers ?? [];
    const chapterCount = Math.max(1, chapters.length);

    // 事务写两表
    const { data: newBook, error: booksErr } = await admin
      .from("books")
      .insert({
        user_id: user.id,
        title: page_title,
        author: null,
        cover_url: null,
        file_url: `wikisource://${page.pageid}`,
        file_format: "txt",
        file_size: null,
        language: "zh",
        is_public: false,
        description: `来自维基文库 (${chapterCount} 章)`,
      })
      .select("id")
      .single();

    if (booksErr || !newBook) {
      console.error("books insert failed:", booksErr);
      return json({ error: "books_insert_failed", detail: booksErr?.message }, 500);
    }

    const { error: wsErr } = await admin
      .from("wikisource_books")
      .insert({
        book_id: newBook.id,
        page_title,
        page_id: page.pageid,
        language,
        chapter_count: chapterCount,
      });

    if (wsErr) {
      await admin.from("books").delete().eq("id", newBook.id);
      console.error("wikisource_books insert failed, rolled back:", wsErr);
      return json({ error: "wikisource_books_insert_failed", detail: wsErr.message }, 500);
    }

    return json({
      exists: false,
      book_id: newBook.id,
      page_title,
      chapters: chapterCount,
      message: "导入成功",
    }, 201);
  } catch (e) {
    console.error("wikisource-import error:", e);
    return json({ error: "internal_error", message: String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
