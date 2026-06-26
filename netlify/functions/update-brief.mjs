// ============================================================================
// netlify/functions/update-brief.mjs
// Lets the dashboard mark an assignment Open / Doing / Done so the team can
// track their work. Password-protected; service key stays server-side.
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
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "use POST" }), {
      status: 405, headers: { "content-type": "application/json" },
    });
  }

  try {
    const { id, status } = await req.json();
    if (!["open", "doing", "done"].includes(status)) {
      return new Response(JSON.stringify({ error: "bad status" }), {
        status: 400, headers: { "content-type": "application/json" },
      });
    }
    const { error } = await supabase
      .from("content_briefs").update({ status }).eq("id", id);
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
};
