// netlify/functions/serp-brief-background.mjs
// Pulls the live Google top-10 + People Also Ask (via Serper) for the target
// keyword, then has Claude turn it into a content blueprint a writer can follow
// to outrank them. Background function.
// Trigger: POST /.netlify/functions/serp-brief-background?id=BRIEF_ID&pass=PASS
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, SERPER_API_KEY, DASHBOARD_PASSCODE
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SYS = `You are an elite SEO content strategist for a US credit repair company. Given the live Google top-10 results (titles + snippets), the People Also Ask questions, and related searches for a target keyword, produce a content blueprint a writer can follow to create a page that outranks them.
Return ONLY a JSON object, nothing else:
{"recommended_title":"...","search_intent":"one sentence","word_count_target":1500,"must_cover_subtopics":["..."],"questions_to_answer":["..."],"entities_and_terms":["..."],"suggested_outline":["H2: ...","H2: ..."],"content_gaps":["angles competitors miss that we can win"],"internal_cta":"..."}
Make it specific to what the live results actually show. word_count_target is a number. Compliance (regulated industry): never suggest guaranteeing results, promising a specific score increase, or claiming to remove accurate information.`;

export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const pass = url.searchParams.get("pass");
  if (pass !== process.env.DASHBOARD_PASSCODE) return new Response("unauthorized", { status: 401 });
  try {
    if (!process.env.SERPER_API_KEY) {
      await supabase.from("content_briefs").update({ serp_status: "nokey" }).eq("id", id);
      console.error("SERPER_API_KEY not set"); return new Response("no key", { status: 200 });
    }
    const { data: b } = await supabase.from("content_briefs").select("*").eq("id", id).single();
    const keyword = b.target_keyword;

    // 1. Live SERP via Serper.
    const sr = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: keyword, gl: "us", hl: "en", num: 10 }),
    });
    if (!sr.ok) throw new Error("Serper " + sr.status);
    const s = await sr.json();
    const organic = (s.organic || []).slice(0, 10).map((o, i) => `${i + 1}. ${o.title} â€” ${o.snippet || ""}`).join("\n");
    const paa = (s.peopleAlsoAsk || []).map((p) => p.question).join("\n");
    const related = (s.relatedSearches || []).map((r) => r.query).join(", ");

    // 2. Claude blueprint.
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6", max_tokens: 2000, system: SYS,
        messages: [{ role: "user", content: `TARGET KEYWORD: ${keyword}\n\nLIVE TOP 10 (title â€” snippet):\n${organic || "(none)"}\n\nPEOPLE ALSO ASK:\n${paa || "(none)"}\n\nRELATED SEARCHES: ${related || "(none)"}\n\nBuild the content blueprint as JSON.` }],
      }),
    });
    if (!res.ok) throw new Error("Anthropic " + res.status);
    const data = await res.json();
    let text = (data.content || []).filter((x) => x.type === "text").map((x) => x.text).join("").trim();
    let bp; try { bp = JSON.parse(text); } catch { const m = text.match(/\{[\s\S]*\}/); bp = m ? JSON.parse(m[0]) : null; }
    if (!bp) throw new Error("Could not parse blueprint");
    bp._competitors = (s.organic || []).slice(0, 5).map((o) => ({ title: o.title, link: o.link }));

    await supabase.from("content_briefs").update({ serp_brief: bp, serp_status: "ready" }).eq("id", id);
    console.log("SERP brief ready for " + id);
  } catch (e) {
    console.error("SERP brief failed:", e.message);
    try { await supabase.from("content_briefs").update({ serp_status: "error" }).eq("id", id); } catch {}
  }
};
