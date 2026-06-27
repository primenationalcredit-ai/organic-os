// netlify/functions/ahrefs-check.mjs
// Diagnostic (regular function, returns instantly). Shows what Ahrefs returns
// for Site Audit projects AND issues, so we can confirm the full chain.
// Open: /.netlify/functions/ahrefs-check?pass=YOUR_PASSCODE
// Env: AHREFS_API_KEY, DASHBOARD_PASSCODE
const AH = process.env.AHREFS_API_KEY;
const DOMAIN = "asapcreditrepairusa.com";
async function ah(path, params) {
  const u = new URL("https://api.ahrefs.com/v3/" + path);
  Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { headers: { Authorization: "Bearer " + AH, Accept: "application/json" } });
  return { status: r.status, text: await r.text() };
}
export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("pass") !== process.env.DASHBOARD_PASSCODE)
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });

  const out = { has_api_key: !!AH, domain: DOMAIN };
  try {
    const p = await ah("site-audit/projects", {});
    out.projects_http_status = p.status;
    const pj = JSON.parse(p.text);
    const list = pj.healthscores || pj.projects || [];
    const match = (Array.isArray(list) ? list : []).find(x => (x.target_url || "").toLowerCase().includes(DOMAIN));
    out.matched_project = match ? { project_id: match.project_id, target_url: match.target_url, health_score: match.health_score, status: match.status } : null;

    if (match && match.project_id) {
      const iss = await ah("site-audit/issues", { project_id: match.project_id });
      out.issues_http_status = iss.status;
      try {
        const ij = JSON.parse(iss.text);
        const arr = ij.issues || [];
        out.issues_count = arr.length;
        out.issue_sample_keys = arr[0] ? Object.keys(arr[0]) : Object.keys(ij);
        out.issue_first = arr[0] || null;
      } catch { out.issues_raw_preview = iss.text.slice(0, 800); }
    }
    return new Response(JSON.stringify(out, null, 2), { headers: { "content-type": "application/json" } });
  } catch (e) {
    out.error = e.message;
    return new Response(JSON.stringify(out, null, 2), { status: 500, headers: { "content-type": "application/json" } });
  }
};
