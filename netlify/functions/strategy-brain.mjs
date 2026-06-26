// ============================================================================
// netlify/functions/strategy-brain.mjs
// The "think for us" piece. Reads the warehouse, asks Claude what to do next,
// writes a prioritized action list into ai_recommendations.
// Run it weekly (Monday morning) or daily.
//
// Env needed: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
//
// This is judgment over YOUR numbers, not magic. It is only as good as the
// data flowing in — get GSC + GA4 + Pipedrive landing him first.
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SYSTEM_PROMPT = `You are the head of organic growth for a US credit repair company.
You are pragmatic, revenue-focused, and allergic to vanity metrics. You read this
week's data and decide the highest-leverage moves. You never recommend "write more
blogs" in the abstract — every writing recommendation names a specific target keyword,
its search volume, and the business reason it will convert. You flag funnel leaks
(traffic that never becomes a lead) before anything else, because a leak wastes every
visit. Be specific and brief.`;

async function buildSnapshot() {
  // Top pages by opportunity + revenue (from the scorecard view).
  const { data: pages } = await supabase
    .from("page_scorecard")
    .select("*")
    .order("impressions", { ascending: false })
    .limit(40);

  // Striking-distance queries: rank 4-15, decent impressions, low clicks.
  // These are the cheapest wins — a page that's almost there.
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 28);
  const { data: striking } = await supabase
    .from("gsc_performance")
    .select("query,page,impressions,clicks,position")
    .gte("date", since.toISOString().slice(0, 10))
    .gte("position", 4)
    .lte("position", 15)
    .gte("impressions", 100)
    .order("impressions", { ascending: false })
    .limit(50);

  // Site-wide funnel for leak detection.
  const { data: funnel } = await supabase.from("funnel_28d").select("*").single();

  // Competitor snapshot (latest date present).
  const { data: competitors } = await supabase
    .from("ahrefs_competitors")
    .select("domain,org_traffic,org_keywords,ref_domains,dr")
    .order("snapshot_date", { ascending: false })
    .limit(8);

  return { pages, striking, funnel, competitors };
}

function userPrompt(snapshot) {
  return `Here is this week's data for the site. All windows are the last 28 days.

PAGE SCORECARD (top 40 by impressions):
${JSON.stringify(snapshot.pages, null, 0)}

STRIKING-DISTANCE QUERIES (rank 4-15, real impressions — almost ranking):
${JSON.stringify(snapshot.striking, null, 0)}

FUNNEL (site-wide): ${JSON.stringify(snapshot.funnel)}

COMPETITORS: ${JSON.stringify(snapshot.competitors)}

Return ONLY a JSON array (no prose, no markdown fences) of 6-12 recommendations,
highest priority first, each shaped exactly like:
{
  "priority": 1,
  "category": "leak" | "protect" | "expand" | "delete" | "write" | "tracking",
  "title": "short imperative, e.g. 'Fix the Phone Lookup leak'",
  "body": "2-3 sentences: what to do and why, in plain language",
  "evidence": { "metric": value, ... the numbers that justify this }
}
Rules: lead with the single biggest funnel leak if one exists. For every "write"
item, put target_keyword and search_volume in evidence. Be concrete.`;
}

async function askClaude(snapshot) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6", // swap to claude-opus-4-8 for sharper analysis
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt(snapshot) }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .replace(/```json|```/g, "")
    .trim();

  return JSON.parse(text);
}

export default async () => {
  try {
    const snapshot = await buildSnapshot();
    const recs = await askClaude(snapshot);

    const runDate = new Date().toISOString().slice(0, 10);
    const rows = recs.map((r) => ({
      run_date: runDate,
      priority: r.priority,
      category: r.category,
      title: r.title,
      body: r.body,
      evidence: r.evidence || {},
      status: "open",
    }));

    const { error } = await supabase.from("ai_recommendations").insert(rows);
    if (error) throw error;

    console.log(`Strategy brain wrote ${rows.length} recommendations.`);
    return new Response(JSON.stringify({ ok: true, count: rows.length }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("Strategy brain failed:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};

// Monday 07:30 UTC. The week starts with your marching orders already written.
export const config = { schedule: "30 7 * * 1" };
