// supabase/functions/wikisource-fetch/index.ts
// 从维基文库拉取页面内容，返回纯文本+TXT格式
//
// 请求：POST { book_id }
// 响应：{ content: string, contentType: string, chapters: {title, content}[] }
//
// 使用维基文库 API：action=parse&page=xxx&prop=text&format=json
// 取 section 0（主内容），清理 HTML 标签后得到纯文本

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const WIKI_API = "https://zh.wikisource.org/w/api.php";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 简易 HTML 标签清理 → 纯文本
function htmlToText(html: string): string {
  // 移除脚本和样式
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  // 移除 HTML 标签，保留换行
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<p[^>]*>/gi, "\n");
  text = text.replace(/<tr[^>]*>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  // 解码 HTML 实体
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  // 压缩多余空白
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();
  return text;
}

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

    const { book_id } = await req.json();
    if (!book_id) {
      return json({ error: "book_id required" }, 400);
    }

    // 查 wikisource_books + 验证所有者
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(SUPABASE_URL, serviceKey);

    const { data: wsBook, error: wsErr } = await admin
      .from("wikisource_books")
      .select("page_title, page_id, chapter_count, books!inner(user_id)")
      .eq("book_id", book_id)
      .single();

    if (wsErr || !wsBook) {
      return json({ error: "not_found" }, 404);
    }
    if (wsBook.books.user_id !== user.id) {
      return json({ error: "forbidden" }, 403);
    }

    const { page_title, page_id, chapter_count } = wsBook;

    // 获取主页面内容
    const mainUrl = `${WIKI_API}?action=parse&pageid=${page_id}&prop=text&format=json&origin=*`;
    const mainRes = await fetch(mainUrl, { signal: AbortSignal.timeout(15000) });
    const mainData = await mainRes.json();
    const mainHtml = mainData?.parse?.text?.["*"] ?? "";
    let mainText = htmlToText(mainHtml);

    // 如果有章节，拉取子页面
    const chapters: { title: string; content: string }[] = [];

    if (chapter_count > 1) {
      // 分类下的子页面
      const subRes = await fetch(
        `${WIKI_API}?action=query&list=categorymembers&cmtitle=Category:${encodeURIComponent(page_title)}&cmtype=page&format=json&origin=*&cmlimit=500`,
        { signal: AbortSignal.timeout(15000) }
      );
      const subData = await subRes.json();
      const members: { title: string; pageid: number }[] = subData?.query?.categorymembers ?? [];

      // 排除主页面本身
      const subPages = members.filter((m: any) => m.pageid !== page_id).slice(0, 200);

      for (const sp of subPages) {
        try {
          const chUrl = `${WIKI_API}?action=parse&pageid=${sp.pageid}&prop=text&format=json&origin=*`;
          const chRes = await fetch(chUrl, { signal: AbortSignal.timeout(10000) });
          const chData = await chRes.json();
          const chHtml = chData?.parse?.text?.["*"] ?? "";
          const chText = htmlToText(chHtml);
          if (chText.length > 50) {
            chapters.push({ title: sp.title, content: chText });
          }
        } catch {
          // 单个章节失败不阻断整体
          console.warn(`[wikisource-fetch] failed to fetch chapter: ${sp.title}`);
        }
      }
    }

    // 构建纯文本全文（章节合并）
    let fullText = mainText;
    if (chapters.length > 0) {
      fullText += "\n\n";
      for (const ch of chapters) {
        fullText += `\n\n【${ch.title}】\n\n${ch.content}`;
      }
    }

    if (fullText.length < 20) {
      return json({ error: "empty_content", message: "维基文库页面内容为空" }, 502);
    }

    return json({
      content: fullText,
      contentType: "text/plain; charset=utf-8",
      title: page_title,
      chapters: chapters.length,
      size: fullText.length,
    });
  } catch (e) {
    console.error("wikisource-fetch error:", e);
    return json({ error: "internal_error", message: String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
