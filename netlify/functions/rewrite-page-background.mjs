// netlify/functions/rewrite-page-background.mjs
// Reads the live page, rewrites it stronger (SEO + AEO + CTA + compliance-safe),
// saves rewrite + rewrite_status='ready'. Background function (15-min limit).
// Trigger: POST /.netlify/functions/rewrite-page-background?id=BRIEF_ID&pass=PASS
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, DASHBOARD_PASSCODE
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DOMAIN_FALLBACK = "https://www.asapcreditrepairusa.com";
const norm = (p) => (p || "").toLowerCase().replace(/\/+$/, "");

const SYS = `You rewrite blog pages for a US credit repair company so they rank higher and get cited by AI engines, while staying legally compliant. Produce a COMPLETE improved page in clean markdown.
Include, in this order:
- An SEO title line and a one-line meta description at the very top, each clearly labeled.
- An H1, then well-structured H2 sections that fully answer the topic, including the common sub-questions a searcher has.
- Any important sections the current page is missing.
- A short FAQ section near the end (great for AI Overviews and getting cited by AI).
- A strong, specific call to action at the end.
Style: 5th to 6th grade reading level, warm, plain, specific. Keep and strengthen any real expertise, numbers, or stories already in the page. Never invent fake statistics.
COMPLIANCE (regulated industry): never promise guaranteed results, never promise a specific score increase, never claim you can remove accurate information. Use careful wording like "may", "can help", "in many cases".`;

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, " ").trim();
}

export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const pass = url.searchParams.get("pass");
  if (pass !== process.env.DASHBOARD_PASSCODE) return new Response("unauthorized", { status: 401 });
  try {
    const { data: b } = await supabase.from("content_briefs").select("*").eq("id", id).single();

    // Find the real live URL for this page.
    const { data: trend } = await supabase.from("page_trends").select("page").eq("path_lc", norm(b.page_path)).maybeSingle();
    const pageUrl = (trend && trend.page) ? trend.page : (DOMAIN_FALLBACK + (b.page_path || ""));

    // Read the live page (best effort).
    let pageText = "";
    try {
      const resp = await fetch(pageUrl, { headers: { "user-agent": "Mozilla/5.0 (compatible; ASAPBot/1.0)" } });
      const html = await resp.text();
      pageText = htmlToText(html).slice(0, 12000);
    } catch (e) { pageText = ""; }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6", max_tokens: 8000, system: SYS,
        messages: [{ role: "user", content:
`TARGET KEYWORD: ${b.target_keyword}
PAGE URL: ${pageUrl}
SUGGESTED CALL TO ACTION: ${b.cta || ""}

CURRENT PAGE CONTENT:
${pageText || "(could not read the live page automatically; rewrite a strong, complete page from the target keyword and best practices for this topic)"}

Rewrite the full page now, in markdown.` }],
      }),
    });
    if (!res.ok) throw new Error("Anthropic " + res.status);
    const data = await res.json();
    const rewrite = (data.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n").trim();

    await supabase.from("content_briefs").update({ rewrite, rewrite_status: "ready" }).eq("id", id);
    console.log("Rewrite ready for " + id);
  } catch (e) {
    console.error("Rewrite failed:", e.message);
    try { await supabase.from("content_briefs").update({ rewrite_status: "error" }).eq("id", id); } catch {}
  }
};
