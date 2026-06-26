// ============================================================================
// netlify/functions/content-brain-background.mjs
// Turns Search Console data into exact blog assignments for the writers.
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
Your job is to turn raw search data into briefs so specific that a writer needs zero
follow-up questions. You never say "write about X" vaguely. Every brief names the exact
target keyword, the current rank, the monthly impression potential, the article angle,
the H2 sections to include, which internal pages to link to, and the call to action.

You lead with the cheapest wins: pages already ranking 4-15 ("striking distance") that
just need expansion beat writing brand-new articles from scratch. You are revenue-minded:
a keyword someone searches when they have a charge-off or collection is worth far more
than an informational term, and you say so. Be concrete and confident, but keep each
brief tight and scannable — a writer should read it in under a minute.`;

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

STRIKING DISTANCE — keywords already ranking 4-15. Expanding the existing page is the
cheapest path to page 1:
${JSON.stringify(snap.striking)}

CONTENT GAPS — keywords ranking 15-40. Seen but not winning; may need a stronger or
dedicated article:
${JSON.stringify(snap.gaps)}

Pick the 10 highest-value opportunities and write a brief for each. Return ONLY a JSON
array (no prose, no markdown fences), highest priority first, each shaped exactly like:
{
  "priority": 1,
  "action": "expand" | "write_new",
  "target_keyword": "remove late payments",
  "page_path": "/remove-late-payments",
  "current_position": 8.2,
  "monthly_impressions": 1900,
  "why": "1 sentence: the business reason this is worth doing now",
  "brief": "3-5 sentences max: the angle, the H2 sections to add, word-count target, what's missing today",
  "internal_links": ["/remove-charge-off", "/remove-collections"],
  "cta": "the specific call to action to place in the article"
}
Rules: prefer "expand" over "write_new" when a page already ranks. monthly_impressions
should be roughly 7x the windowed impressions you see (28-day window). Keep the "brief"
field to 3-5 sentences so the whole list stays scannable.`;
}

// Tough parser: handles clean JSON, and salvages complete briefs if the output
// was ever cut off mid-stream.
function parseBriefs(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    // Truncated mid-object: keep everything up to the last complete object.
    const cut = clean.lastIndexOf("},");
    if (cut !== -1) {
      try {
        return JSON.parse(clean.slice(0, cut + 1) + "]");
      } catch {}
    }
    const lastBrace = clean.lastIndexOf("}");
    if (lastBrace !== -1) {
      try {
        return JSON.parse(clean.slice(0, lastBrace + 1) + "]");
      } catch {}
    }
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
      model: "claude-sonnet-4-6", // bump to claude-opus-4-8 for sharper briefs
      max_tokens: 16000, // plenty of room so briefs never truncate
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt(snap) }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return parseBriefs(text);
}

export default async () => {
  try {
    console.log("Content brain started...");
    const snap = await buildSnapshot();

    if (snap.striking.length === 0 && snap.gaps.length === 0) {
      console.log("No opportunities found — is GSC data in the table?");
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
      brief: b.brief,
      internal_links: b.internal_links || [],
      cta: b.cta,
      status: "open",
    }));

    const { error } = await supabase.from("content_briefs").insert(rows);
    if (error) throw error;

    console.log(`Content brain wrote ${rows.length} briefs.`);
  } catch (err) {
    console.error("Content brain failed:", err.message);
  }
};
