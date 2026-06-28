// netlify/functions/manage-ranks.mjs â€” add/remove tracked keywords.
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
export default async (req) => {
  const url = new URL(req.url);
  const pass = url.searchParams.get("pass") || req.headers.get("x-pass");
  if (pass !== process.env.DASHBOARD_PASSCODE) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  try {
    const body = await req.json();
    const action = body.action, keyword = (body.keyword || "").trim();
    if (!keyword) throw new Error("missing keyword");
    if (action === "add") {
      await supabase.from("tracked_keywords").upsert({ keyword }, { onConflict: "keyword" });
    } else if (action === "remove") {
      await supabase.from("tracked_keywords").delete().eq("keyword", keyword);
      await supabase.from("rank_history").delete().eq("keyword", keyword);
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "content-type": "application/json" } });
  }
};
