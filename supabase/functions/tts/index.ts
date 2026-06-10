// supabase/functions/tts/index.ts
// AI 听书 Edge Function - 调用 MiniMax M3 TTS 接口
// 部署：supabase functions deploy tts --no-verify-jwt

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const MINIMAX_API_KEY = Deno.env.get("MINIMAX_API_KEY") ?? "";
const MINIMAX_TTS_URL = Deno.env.get("MINIMAX_TTS_URL") ?? "https://api.minimaxi.chat/v1/t2a_v2";
const MINIMAX_GROUP_ID = Deno.env.get("MINIMAX_GROUP_ID") ?? "";

// CORS 头
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

serve(async (req) => {
  // 处理预检
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    // 1. 鉴权：要求用户登录
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing authorization header" }, 401);
    }

    // 2. 解析请求体
    const { text, voice = "male-qn-jingying", speed = 1.0, format = "mp3" } = await req.json();

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return json({ error: "text is required" }, 400);
    }

    if (text.length > 5000) {
      return json({ error: "text too long, max 5000 chars per request" }, 400);
    }

    if (!MINIMAX_API_KEY) {
      return json({ error: "TTS service not configured" }, 500);
    }

    // 3. 调用 MiniMax TTS
    const ttsBody = {
      model: "speech-01-turbo",
      text: text.slice(0, 5000),
      stream: false,
      voice_setting: {
        voice_id: voice,
        speed: Number(speed) || 1.0,
        vol: 1.0,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: format === "wav" ? "wav" : "mp3",
        channel: 1,
      },
    };

    const url = MINIMAX_GROUP_ID
      ? `${MINIMAX_TTS_URL}?GroupId=${MINIMAX_GROUP_ID}`
      : MINIMAX_TTS_URL;

    const ttsRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MINIMAX_API_KEY}`,
      },
      body: JSON.stringify(ttsBody),
    });

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      console.error("TTS upstream error:", ttsRes.status, errText);
      return json(
        { error: "TTS upstream error", detail: errText.slice(0, 500) },
        502
      );
    }

    // 4. MiniMax 返回 JSON，audio 字段是 hex 编码的音频
    const data = await ttsRes.json();

    if (data.base_resp && data.base_resp.status_code !== 0) {
      return json(
        { error: "TTS failed", detail: data.base_resp.status_msg },
        502
      );
    }

    const audioHex = data.data?.audio;
    if (!audioHex) {
      return json({ error: "No audio returned" }, 502);
    }

    // hex -> bytes
    const bytes = new Uint8Array(
      audioHex.match(/.{1,2}/g).map((b: string) => parseInt(b, 16))
    );

    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": format === "wav" ? "audio/wav" : "audio/mpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    console.error("TTS function error:", e);
    return json({ error: "Internal error", message: String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
