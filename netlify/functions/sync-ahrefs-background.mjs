// ============================================================================
// netlify/functions/sync-ahrefs-background.mjs
// Pulls your Ahrefs Site Audit: health score (free) + ranked issues (50 units),
// then turns the top issues into plain-language fix steps with Claude.
// Writes to site_meta + ahrefs_issues.
//
// Background function. Trigger by opening its URL, or wire a weekly cron later.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AHREFS_API_KEY, ANTHROPIC_API_KEY
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const AH = process.env.AHREFS_API_KEY;
const DOMAIN = "asapcreditrepairusa.com";
const IMP = { Error: 0, Warning: 1, Notice: 2 };

async function ahrefs(path, params) {
  const u = new URL("https://api.ahrefs.com/v3/" + path);
  Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { headers: { Authorization: "Bearer " + AH, Accept: "application/json" } });
  if (!r.ok) throw new Error(`Ahrefs ${path} ${r.status}: ${await r.text()}`);
  return r.json();
}

function parseJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  try { return JSON.parse(clean); }
  catch {
    const cut = clean.lastIndexOf("},");
    if (cut !== -1) { try { return JSON.parse(clean.slice(0, cut + 1) + "]"); } catch {} }
    return [];
  }
}

async function fixSteps(issues) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      system: "You explain website SEO fixes to a non-technical content team in plain 5th-grade language. No jargon. Each fix is 2 to 4 short, concrete do-this-now steps.",
      messages: [{ role: "user", content:
`Here are Site Audit issues found on a credit repair website (JSON):
${JSON.stringify(issues)}

Return ONLY a JSON array (no markdown), one object per issue, shaped exactly:
{"issue_id":"...","fix_steps":["step 1 in plain words","step 2"]}
Make the steps something a blog writer or VA could actually do.` }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  return parseJSON(text);
}

export default async () => {
  try {
    console.log("Ahrefs sync started...");

    // 1. Health score + project id (free endpoint)
    let proj = await ahrefs("site-audit/projects", { project_url: DOMAIN });
    let hs = (proj.healthscores || [])[0];
    if (!hs) {
      const all = await ahrefs("site-audit/projects", {});
      hs = (all.healthscores || []).find(p => (p.target_url || "").includes(DOMAIN));
    }
    if (!hs) { console.log("No Site Audit project found for " + DOMAIN + ". Has it been crawled?"); return; }

    await supabase.from("site_meta").upsert({
      key: "ahrefs_health",
      value: JSON.stringify({
        health_score: hs.health_score,
        errors: hs.urls_with_errors, warnings: hs.urls_with_warnings,
        notices: hs.urls_with_notices, total: hs.total, date: hs.date,
      }),
      updated_at: new Date().toISOString(),
    });

    // 2. Issues (50 units)
    const iss = await ahrefs("site-audit/issues", { project_id: hs.project_id });
    let issues = (iss.issues || []).filter(i => (i.crawled || 0) > 0);
    issues.sort((a, b) => (IMP[a.importance] ?? 3) - (IMP[b.importance] ?? 3) || (b.crawled || 0) - (a.crawled || 0));
    const top = issues.slice(0, 20);

    // 3. Plain-language fix steps for the top 12
    const steps = {};
    try {
      const arr = await fixSteps(top.slice(0, 12).map(i => ({
        issue_id: i.issue_id, name: i.name, category: i.category, importance: i.importance, affected: i.crawled,
      })));
      (arr || []).forEach(x => { if (x && x.issue_id) steps[x.issue_id] = x.fix_steps; });
    } catch (e) { console.log("Fix-steps pass skipped: " + e.message); }

    // 4. Store
    const rows = top.map(i => ({
      issue_id: i.issue_id, name: i.name, importance: i.importance,
      category: i.category, affected: i.crawled,
      fix_steps: steps[i.issue_id] || null, captured_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("ahrefs_issues").upsert(rows, { onConflict: "issue_id" });
    if (error) throw error;

    console.log(`Ahrefs sync ok: health ${hs.health_score}, ${rows.length} issues stored.`);
  } catch (err) {
    console.error("Ahrefs sync failed:", err.message);
  }
};
