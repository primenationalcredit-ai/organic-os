// netlify/functions/ahrefs-check.mjs
// Diagnostic (regular function, returns instantly). Shows exactly what Ahrefs
// returns for your Site Audit projects so we can see the real problem.
// Open: /.netlify/functions/ahrefs-check?pass=YOUR_PASSCODE
// Env: AHREFS_API_KEY, DASHBOARD_PASSCODE
const AH = process.env.AHREFS_API_KEY;
const DOMAIN = "asapcreditrepairusa.com";
export default async (req) => {
  const url = new URL(req.url);
  const pass = url.searchParams.get("pass");
  if (pass !== process.env.DASHBOARD_PASSCODE)
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });

  const out = { has_api_key: !!AH, key_length: AH ? AH.length : 0, domain: DOMAIN };
  try {
    const u = new URL("https://api.ahrefs.com/v3/site-audit/projects");
    const r = await fetch(u, { headers: { Authorization: "Bearer " + AH, Accept: "application/json" } });
    out.http_status = r.status;
    const text = await r.text();
    try {
      const j = JSON.parse(text);
      // Summarize what we got back without dumping everything.
      const list = j.healthscores || j.projects || [];
      out.projects_found = Array.isArray(list) ? list.length : 0;
      out.sample_keys = (Array.isArray(list) && list[0]) ? Object.keys(list[0]) : Object.keys(j);
      out.matches_domain = Array.isArray(list)
        ? list.filter(p => JSON.stringify(p).toLowerCase().includes(DOMAIN)).map(p => ({ project_id: p.project_id, target_url: p.target_url, health_score: p.health_score }))
        : [];
      out.raw_preview = text.slice(0, 1500);
    } catch {
      out.note = "Response was not JSON.";
      out.raw_preview = text.slice(0, 1500);
    }
    return new Response(JSON.stringify(out, null, 2), { headers: { "content-type": "application/json" } });
  } catch (e) {
    out.error = e.message;
    return new Response(JSON.stringify(out, null, 2), { status: 500, headers: { "content-type": "application/json" } });
  }
};
