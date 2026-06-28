// netlify/functions/build-links-background.mjs
// Finds topically related pages from GSC data and recommends internal links:
// which existing pages should link TO this one, and which it should link out to,
// with anchor text. Background function.
// Trigger: POST /.netlify/functions/build-links-background?id=BRIEF_ID&pass=PASS
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, DASHBOARD_PASSCODE
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const STOP = new Set("the,a,an,to,of,for,and,or,how,what,why,is,are,in,on,with,your,you,my,this,that,from,can,do,does,credit,report,reports,repair,score,scores,best,near,me,get,fix,bad".split(","));
const norm = (p) => ((p || "").replace(/^https?:\/\/[^/]+/, "").split("?")[0].toLowerCase().replace(/\/+$/, "") || "/");

const SYS = `You are an SEO internal-linking strategist. Given a target page's keyword and a list of other pages on the SAME site (each with a sample query it ranks for and its click volume), recommend internal links. Return ONLY JSON:
{"link_from":[{"path":"/...","anchor_text":"...","why":"short reason"}],"link_to":[{"path":"/...","anchor_text":"...","why":"short reason"}]}
link_from = up to 5 existing pages that should add a link pointing TO the target page; prefer higher click volume and close topical fit, since their link passes the most authority. link_to = up to 5 relevant pages the target should link out to. Anchor text must be natural and keyword-relevant, never spammy. Only use paths from the provided list.`;

export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const pass = url.searchParams.get("pass");
  if (pass !== process.env.DASHBOARD_PASSCODE) return new Response("unauthorized", { status: 401 });
  try {
    const { data: b } = await supabase.from("content_briefs").select("*").eq("id", id).single();
    const kw = b.target_keyword || "";
    const targetPath = norm(b.page_path);
    let tokens = (kw.toLowerCase().match(/[a-z]+/g) || []).filter((t) => t.length >= 3 && !STOP.has(t));
    if (!tokens.length) tokens = (kw.toLowerCase().match(/[a-z]+/g) || []).filter((t) => t.length >= 3);
    if (!tokens.length) { await supabase.from("content_briefs").update({ links_status: "error" }).eq("id", id); return new Response("no tokens", { status: 200 }); }

    const ors = tokens.slice(0, 6).map((t) => `query.ilike.%${t}%`).join(",");
    const { data: rows } = await supabase.from("gsc_performance").select("page,query,clicks,impressions").or(ors).limit(3000);

    const byPage = {};
    for (const r of (rows || [])) {
      const p = norm(r.page);
      if (p === targetPath) continue;
      if (!byPage[p]) byPage[p] = { path: p, clicks: 0, impressions: 0, topQuery: "", topImpr: 0 };
      byPage[p].clicks += r.clicks || 0;
      byPage[p].impressions += r.impressions || 0;
      if ((r.impressions || 0) > byPage[p].topImpr) { byPage[p].topImpr = r.impressions || 0; byPage[p].topQuery = r.query; }
    }
    const candidates = Object.values(byPage).sort((a, b2) => b2.impressions - a.impressions).slice(0, 14);
    if (!candidates.length) { await supabase.from("content_briefs").update({ links_plan: { link_from: [], link_to: [] }, links_status: "ready" }).eq("id", id); return new Response("none", { status: 200 }); }

    const list = candidates.map((c) => `${c.path} | ranks for "${c.topQuery}" | ${c.clicks} clicks`).join("\n");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6", max_tokens: 1500, system: SYS,
        messages: [{ role: "user", content: `TARGET KEYWORD: ${kw}\nTARGET PAGE: ${targetPath}\n\nOTHER PAGES ON THE SITE:\n${list}\n\nRecommend the internal links as JSON.` }],
      }),
    });
    if (!res.ok) throw new Error("Anthropic " + res.status);
    const data = await res.json();
    let text = (data.content || []).filter((x) => x.type === "text").map((x) => x.text).join("").trim();
    let plan; try { plan = JSON.parse(text); } catch { const m = text.match(/\{[\s\S]*\}/); plan = m ? JSON.parse(m[0]) : null; }
    if (!plan) throw new Error("Could not parse plan");

    await supabase.from("content_briefs").update({ links_plan: plan, links_status: "ready" }).eq("id", id);
    console.log("Links plan ready for " + id);
  } catch (e) {
    console.error("Links plan failed:", e.message);
    try { await supabase.from("content_briefs").update({ links_status: "error" }).eq("id", id); } catch {}
  }
};
