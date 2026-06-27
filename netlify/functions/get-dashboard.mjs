// ============================================================================
// netlify/functions/get-dashboard.mjs
// Feeds the cockpit Overview: top-line KPIs, what changed this week, and the
// pages that need work. Password-protected, service key stays server-side.
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
      status: 401, headers: { "content-type": "application/json" },
    });
  }

  try {
    const { data: totals } = await supabase
      .from("gsc_totals_compare").select("*").single();

    const { data: gainers } = await supabase
      .from("gsc_page_compare").select("*")
      .order("clicks_delta", { ascending: false }).limit(5);

    const { data: losers } = await supabase
      .from("gsc_page_compare").select("*")
      .gt("prev_clicks", 0)
      .order("clicks_delta", { ascending: true }).limit(5);

    const { data: opportunities } = await supabase
      .from("gsc_opportunities")
      .select("query,path,impressions,avg_position")
      .eq("opportunity_type", "striking_distance")
      .order("impressions", { ascending: false }).limit(8);

    // GA4 leads (last 28 days), if synced.
    let leads = null;
    const { data: leadAgg } = await supabase.from("ga4_leads").select("leads,sessions");
    if (leadAgg && leadAgg.length) {
      const total_leads = leadAgg.reduce((s, r) => s + (r.leads || 0), 0);
      const total_sessions = leadAgg.reduce((s, r) => s + (r.sessions || 0), 0);
      leads = { total_leads, total_sessions, lead_rate: total_sessions ? Math.round(1000 * total_leads / total_sessions) / 10 : 0 };
    }

    return new Response(
      JSON.stringify({ totals, gainers, losers, opportunities, leads }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
};
