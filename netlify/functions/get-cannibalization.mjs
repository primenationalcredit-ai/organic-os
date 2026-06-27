// netlify/functions/get-cannibalization.mjs
// Feeds the Merge tab: queries where 2+ of your pages compete, strongest first.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DASHBOARD_PASSCODE
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
export default async (req) => {
  const url = new URL(req.url);
  const pass = url.searchParams.get("pass") || req.headers.get("x-pass");
  if (pass !== process.env.DASHBOARD_PASSCODE)
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  try {
    const { data, error } = await supabase
      .from("cannibalization").select("*")
      .order("total_impressions", { ascending: false }).limit(50);
    if (error) throw error;
    return new Response(JSON.stringify({ clusters: data || [] }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "content-type": "application/json" } });
  }
};
