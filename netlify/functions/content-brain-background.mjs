// ============================================================================
// netlify/functions/content-brain-background.mjs
// Turns Search Console data into exact, STEP-BY-STEP blog assignments.
// Reads gsc_opportunities, asks Claude what to do, writes to content_briefs.
//
// Background function (15-min limit). Triggered weekly by content-brain-trigger.
// Env needed: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SYSTEM_PROMPT = `You assign blog work for a US credit repair company's content team.
The writers are not SEO experts, so you write like a checklist a 5th grader could follow.
Every assignment becomes a numbered list of plain, do-this-now steps. No theory, no jargon.
You lead with the cheapest wins: pages already ranking 4-15 that just need a push.
You are revenue-minded: a person searching with a real money problem (a charge-off, a
collection, a strange entry on their report) is worth far more than a casual reader, and
your steps reflect that with strong, specific calls to action.`;

async function buildSnapshot() {
  const { data: striking } = await supabase
    .from("gsc_opportunities")
    .select("query,path,impressions,clicks,avg_position,ctr_pct")
    .eq("opportunity_type", "striking_distance")
    .order("impressions", { ascending: false })
    .limit(50);

  const { data: gaps } = await supabase
    .from("gsc_opportunities")
    .select("query,path,impressions,clicks,avg_position,ctr_pct")
    .eq("opportunity_type", "content_gap")
    .order("impressions", { ascending: false })
    .limit(30);

  return { striking: striking || [], gaps: gaps || [] };
}

function userPrompt(snap) {
  return `Here is live Search Console data for the site (last 28 days).

STRIKING DISTANCE â€” keywords already ranking 4-15. Expanding the existing page is the
cheapest path to page 1:
${JSON.stringify(snap.striking)}

CONTENT GAPS â€” keywords ranking 15-40. Seen but not winning:
${JSON.stringify(snap.gaps)}

Pick the 10 highest-value opportunities and write an assignment for each. Return ONLY a
JSON array (no prose, no markdown fences), highest priority first, each shaped exactly:
{
  "priority": 1,
  "action": "expand" | "write_new",
  "target_keyword": "what is jpmcb on my credit report",
  "page_path": "/blog/jpmcb-card-on-credit-report",
  "current_position": 10.7,
  "monthly_impressions": 10171,
  "why": "1 short sentence: the problem and why it matters in plain words",
  "steps": [
    "Step 1 in plain language, e.g. 'Rewrite the page title to: ...'",
    "Step 2, e.g. 'Add an H2 section called ... that answers ...'",
    "more steps... each a single concrete action a writer does",
    "Add internal links to the most relevant pages.",
    "Add this exact call to action: ...",
    "Publish, then hit Submit for review in the app."
  ],
  "internal_links": ["/remove-charge-off"],
  "cta": "the specific call to action to place in the post"
}
Rules:
- 6 to 9 steps, each one a single plain action. A 5th grader should be able to follow it.
- Prefer "expand" when a page already ranks.
- monthly_impressions is roughly 7x the windowed impressions you see.
- The LAST step is always: "Publish, then hit Submit for review in the app."`;
}

function parseBriefs(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  try { return JSON.parse(clean); }
  catch {
    const cut = clean.lastIndexOf("},");
    if (cut !== -1) { try { return JSON.parse(clean.slice(0, cut + 1) + "]"); } catch {} }
    const lastBrace = clean.lastIndexOf("}");
    if (lastBrace !== -1) { try { return JSON.parse(clean.slice(0, lastBrace + 1) + "]"); } catch {} }
    throw new Error("Could not parse briefs JSON even after salvage.");
  }
}

async function askClaude(snap) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt(snap) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  return parseBriefs(text);
}

export default async () => {
  try {
    console.log("Content brain started...");
    const snap = await buildSnapshot();
    if (snap.striking.length === 0 && snap.gaps.length === 0) {
      console.log("No opportunities found â€” is GSC data in the table?");
      return;
    }
    const briefs = await askClaude(snap);
    const runDate = new Date().toISOString().slice(0, 10);
    const rows = briefs.map((b) => ({
      run_date: runDate,
      priority: b.priority,
      action: b.action,
      target_keyword: b.target_keyword,
      page_path: b.page_path,
      current_position: b.current_position,
      monthly_impressions: b.monthly_impressions,
      why: b.why,
      steps: b.steps || [],
      brief: Array.isArray(b.steps) ? b.steps.join("\n") : (b.brief || ""),
      internal_links: b.internal_links || [],
      cta: b.cta,
      status: "open",
    }));
    const { error } = await supabase.from("content_briefs").insert(rows);
    if (error) throw error;
    console.log(`Content brain wrote ${rows.length} stepped assignments.`);
  } catch (err) {
    console.error("Content brain failed:", err.message);
  }
};
