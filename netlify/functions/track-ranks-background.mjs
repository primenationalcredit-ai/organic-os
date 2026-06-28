// netlify/functions/track-ranks-background.mjs
// Checks the live Google position of every tracked keyword (via Serper) and
// logs it to rank_history. Background; runs daily via the scheduler.
// Trigger: open /.netlify/functions/track-ranks-background
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SERPER_API_KEY
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DOMAIN = "asapcreditrepairusa.com";

export default async () => {
  try {
    if (!process.env.SERPER_API_KEY) { console.error("SERPER_API_KEY not set"); return new Response("no key", { status: 200 }); }
    const { data: kws } = await supabase.from("tracked_keywords").select("keyword");
    const today = new Date().toISOString().slice(0, 10);
    for (const { keyword } of (kws || [])) {
      try {
        const r = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ q: keyword, gl: "us", hl: "en", num: 100 }),
        });
        const s = await r.json();
        const found = (s.organic || []).find((o) => (o.link || "").toLowerCase().includes(DOMAIN));
        await supabase.from("rank_history").upsert({
          keyword, date: today,
          position: found ? found.position : null,
          url: found ? found.link : null,
          checked_at: new Date().toISOString(),
        }, { onConflict: "keyword,date" });
      } catch (e) { console.error("rank check failed for", keyword, e.message); }
    }
    console.log(`Rank check done for ${(kws || []).length} keywords.`);
  } catch (e) { console.error("track-ranks failed:", e.message); }
};
