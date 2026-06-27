// ============================================================================
// netlify/functions/get-problems.mjs
// Feeds the Problems tab: health score + ranked issues with fix steps.
// Password-protected; service key stays server-side.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DASHBOARD_PASSCODE
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const IMP = { Error: 0, Warning: 1, Notice: 2 };

export default async (req) => {
  const url = new URL(req.url);
  const pass = url.searchParams.get("pass") || req.headers.get("x-pass");
  if (pass !== process.env.DASHBOARD_PASSCODE) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  }
  try {
    const { data: meta } = await supabase.from("site_meta").select("value").eq("key", "ahrefs_health").maybeSingle();
    const health = meta ? JSON.parse(meta.value) : null;
    const { data: issues } = await supabase.from("ahrefs_issues").select("*");
    (issues || []).sort((a, b) => (IMP[a.importance] ?? 3) - (IMP[b.importance] ?? 3) || (b.affected || 0) - (a.affected || 0));
    return new Response(JSON.stringify({ health, issues: issues || [] }), { headers: { "content-type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "content-type": "application/json" } });
  }
};
