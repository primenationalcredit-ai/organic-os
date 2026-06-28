// netlify/functions/build-schema-background.mjs
// Generates ready-to-paste JSON-LD (FAQPage + BlogPosting) for an assignment,
// to win rich results and AI citations. Background function.
// Trigger: POST /.netlify/functions/build-schema-background?id=BRIEF_ID&pass=PASS
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, DASHBOARD_PASSCODE
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DOMAIN = "https://www.asapcreditrepairusa.com";

const SYS = `You generate valid JSON-LD structured data for a US credit repair company's blog pages, to win Google rich results and AI citations. Produce exactly TWO script blocks:
1) A FAQPage with 4 to 6 question/answer pairs. Answers are concise, accurate, and compliance-safe: never promise guaranteed results, a specific score increase, or claim to remove accurate information; use careful wording like "may" and "can help".
2) A BlogPosting with headline, description, author and publisher both set to the Organization "ASAP Credit Repair", a publisher logo URL, mainEntityOfPage set to the given page URL, and datePublished set to the provided date.
Output ONLY the two <script type="application/ld+json"> ... </script> blocks, nothing before or after. The JSON inside each must be valid.`;

export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const pass = url.searchParams.get("pass");
  if (pass !== process.env.DASHBOARD_PASSCODE) return new Response("unauthorized", { status: 401 });
  try {
    const { data: b } = await supabase.from("content_briefs").select("*").eq("id", id).single();
    const pageUrl = DOMAIN + (b.page_path || "");
    const today = new Date().toISOString().slice(0, 10);
    const questions = (b.serp_brief && Array.isArray(b.serp_brief.questions_to_answer)) ? b.serp_brief.questions_to_answer.join("\n") : "";
    const context = (b.rewrite || b.submission || b.draft || "").slice(0, 6000);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6", max_tokens: 2000, system: SYS,
        messages: [{ role: "user", content: `TARGET KEYWORD: ${b.target_keyword}\nPAGE URL: ${pageUrl}\nTODAY: ${today}\nLOGO: ${DOMAIN}/logo.png\n\nFAQ QUESTIONS TO USE (if helpful):\n${questions || "(generate sensible ones for the topic)"}\n\nPAGE CONTENT FOR CONTEXT (optional):\n${context || "(none, base answers on the keyword)"}\n\nGenerate the two JSON-LD script blocks now.` }],
      }),
    });
    if (!res.ok) throw new Error("Anthropic " + res.status);
    const data = await res.json();
    const out = (data.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n").trim();
    if (!out) throw new Error("Empty schema");

    await supabase.from("content_briefs").update({ schema_jsonld: out, schema_status: "ready" }).eq("id", id);
    console.log("Schema ready for " + id);
  } catch (e) {
    console.error("Schema failed:", e.message);
    try { await supabase.from("content_briefs").update({ schema_status: "error" }).eq("id", id); } catch {}
  }
};
