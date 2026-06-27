// ============================================================================
// netlify/functions/get-briefs.mjs
// Feeds the dashboard. Returns the latest content briefs WITH live per-page
// Search Console metrics attached (clicks/impressions/position, now vs prior).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DASHBOARD_PASSCODE
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const norm = (p) => (p || "").toLowerCase().replace(/\/+$/, "");

export default async (req) => {
  const url = new URL(req.url);
  const pass = url.searchParams.get("pass") || req.headers.get("x-pass");
  if (pass !== process.env.DASHBOARD_PASSCODE) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  }
  try {
    const { data: latest } = await supabase
      .from("content_briefs").select("run_date").order("run_date", { ascending: false }).limit(1).single();

    const { data: briefs } = await supabase
      .from("content_briefs").select("*").eq("run_date", latest.run_date).order("priority", { ascending: true });

    // De-dupe by keyword, keep highest priority.
    const seen = new Set(); const clean = [];
    for (const b of briefs) {
      const key = (b.target_keyword || "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key); clean.push(b);
    }

    // Attach live per-page metrics from the page_trends view.
    const paths = [...new Set(clean.map((b) => norm(b.page_path)).filter(Boolean))];
    const byPath = {};
    if (paths.length) {
      const { data: trends } = await supabase.from("page_trends").select("*").in("path_lc", paths);
      (trends || []).forEach((t) => { byPath[t.path_lc] = t; });
    }
    for (const b of clean) b.metrics = byPath[norm(b.page_path)] || null;

    return new Response(
      JSON.stringify({ run_date: latest.run_date, count: clean.length, briefs: clean }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "content-type": "application/json" } });
  }
};
