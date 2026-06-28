// netlify/functions/get-ranks.mjs â€” feeds the Ranks tab.
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
export default async (req) => {
  const url = new URL(req.url);
  const pass = url.searchParams.get("pass") || req.headers.get("x-pass");
  if (pass !== process.env.DASHBOARD_PASSCODE) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  try {
    const { data: kws } = await supabase.from("tracked_keywords").select("*").order("added_at", { ascending: true });
    const { data: hist } = await supabase.from("rank_history").select("*").order("date", { ascending: true });
    const byKw = {};
    for (const h of (hist || [])) { (byKw[h.keyword] = byKw[h.keyword] || []).push({ date: h.date, position: h.position, url: h.url }); }
    const keywords = (kws || []).map((k) => {
      const h = byKw[k.keyword] || [];
      return { keyword: k.keyword, history: h.slice(-14), current: h.length ? h[h.length - 1] : null, previous: h.length > 1 ? h[h.length - 2] : null };
    });
    return new Response(JSON.stringify({ keywords }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "content-type": "application/json" } });
  }
};
