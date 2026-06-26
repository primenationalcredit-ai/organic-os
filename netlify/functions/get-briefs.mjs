// ============================================================================
// netlify/functions/get-briefs.mjs
// Feeds the dashboard. Returns the latest content briefs, password-protected.
// The Supabase service key stays here on the server — never in the browser.
//
// Env needed: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DASHBOARD_PASSCODE
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async (req) => {
  const url = new URL(req.url);
  const pass = url.searchParams.get("pass") || req.headers.get("x-pass");

  if (pass !== process.env.DASHBOARD_PASSCODE) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    // Most recent run.
    const { data: latest } = await supabase
      .from("content_briefs")
      .select("run_date")
      .order("run_date", { ascending: false })
      .limit(1)
      .single();

    const { data: briefs } = await supabase
      .from("content_briefs")
      .select("*")
      .eq("run_date", latest.run_date)
      .order("priority", { ascending: true });

    // De-duplicate by keyword (in case the brain was triggered more than once),
    // keeping the highest-priority version of each.
    const seen = new Set();
    const clean = [];
    for (const b of briefs) {
      const key = (b.target_keyword || "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      clean.push(b);
    }

    return new Response(
      JSON.stringify({ run_date: latest.run_date, count: clean.length, briefs: clean }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};
