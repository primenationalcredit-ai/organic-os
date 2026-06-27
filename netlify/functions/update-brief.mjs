// ============================================================================
// netlify/functions/update-brief.mjs
// Moves an assignment through the workflow:
//   open -> doing -> submitted -> approved   (or submitted -> changes -> submitted)
// Also stores the draft link (submitted_url) and the reviewer's note (review_note).
// Password-protected; service key stays server-side.
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
    const { id, status, submitted_url, review_note } = await req.json();
    const allowed = ["open", "doing", "submitted", "approved", "changes"];
    if (!allowed.includes(status)) {
      return new Response(JSON.stringify({ error: "bad status" }), {
        status: 400, headers: { "content-type": "application/json" },
      });
    }

    const patch = { status };
    if (submitted_url !== undefined) patch.submitted_url = submitted_url;
    if (review_note !== undefined) patch.review_note = review_note;

    const { error } = await supabase
      .from("content_briefs").update(patch).eq("id", id);
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
