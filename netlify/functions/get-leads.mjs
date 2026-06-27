// netlify/functions/get-leads.mjs â€” feeds the Leads tab.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DASHBOARD_PASSCODE
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
export default async (req) => {
  const url = new URL(req.url);
  const pass = url.searchParams.get("pass") || req.headers.get("x-pass");
  if (pass !== process.env.DASHBOARD_PASSCODE)
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  try {
    const { data: rows } = await supabase.from("ga4_leads").select("*").order("leads", { ascending: false }).limit(500);
    const { data: statusRow } = await supabase.from("site_meta").select("value").eq("key", "ga4_sync_status").maybeSingle();
    const sync_status = statusRow ? JSON.parse(statusRow.value) : null;
    const all = rows || [];
    const total_leads = all.reduce((s, r) => s + (r.leads || 0), 0);
    const total_sessions = all.reduce((s, r) => s + (r.sessions || 0), 0);
    const lead_rate = total_sessions ? Math.round(1000 * total_leads / total_sessions) / 10 : 0;
    return new Response(JSON.stringify({ leads: all, total_leads, total_sessions, lead_rate, sync_status }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "content-type": "application/json" } });
  }
};
