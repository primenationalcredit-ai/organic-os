// netlify/functions/sync-ga4-background.mjs
// Pulls leads + sessions per landing page from GA4 (last 28 days) into ga4_leads.
// Trigger: open /.netlify/functions/sync-ga4-background once (or via cron). Background.
// Env: GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   Optional: GA4_PROPERTY_ID (default properties/353223980),
//             GA4_LEAD_EVENTS (default "lead_submission,form_submit,TypeformSubmit")
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PROPERTY = process.env.GA4_PROPERTY_ID || "properties/353223980";
const LEAD_EVENTS = (process.env.GA4_LEAD_EVENTS || "lead_submission,form_submit,TypeformSubmit").split(",").map(s => s.trim()).filter(Boolean);
const norm = (p) => ((p || "").split("?")[0].toLowerCase().replace(/\/+$/, "") || "/");

function gauth() {
  return new google.auth.GoogleAuth({
    credentials: { client_email: process.env.GOOGLE_SA_EMAIL, private_key: (process.env.GOOGLE_SA_PRIVATE_KEY || "").replace(/\\n/g, "\n") },
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
}

export default async () => {
  try {
    const data = google.analyticsdata({ version: "v1beta", auth: gauth() });

    // Leads per landing page (only the real lead-completion events).
    const leadRep = await data.properties.runReport({
      property: PROPERTY,
      requestBody: {
        dateRanges: [{ startDate: "28daysAgo", endDate: "yesterday" }],
        dimensions: [{ name: "landingPagePlusQueryString" }, { name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: LEAD_EVENTS } } },
        limit: 100000,
      },
    });
    const leadsByPath = {};
    for (const r of (leadRep.data.rows || [])) {
      const p = norm(r.dimensionValues[0].value);
      leadsByPath[p] = (leadsByPath[p] || 0) + Number(r.metricValues[0].value || 0);
    }

    // Sessions per landing page (for context + lead rate).
    const sessRep = await data.properties.runReport({
      property: PROPERTY,
      requestBody: {
        dateRanges: [{ startDate: "28daysAgo", endDate: "yesterday" }],
        dimensions: [{ name: "landingPagePlusQueryString" }],
        metrics: [{ name: "sessions" }],
        limit: 100000,
      },
    });
    const sessByPath = {};
    for (const r of (sessRep.data.rows || [])) {
      const p = norm(r.dimensionValues[0].value);
      sessByPath[p] = (sessByPath[p] || 0) + Number(r.metricValues[0].value || 0);
    }

    const paths = new Set([...Object.keys(leadsByPath), ...Object.keys(sessByPath)]);
    const now = new Date().toISOString();
    const rows = [...paths]
      .filter(p => (sessByPath[p] || 0) > 0 || (leadsByPath[p] || 0) > 0)
      .map(p => ({ path: p, leads: leadsByPath[p] || 0, sessions: sessByPath[p] || 0, updated_at: now }));

    let writeError = null;
    try {
      await supabase.from("ga4_leads").delete().neq("path", "___never___");
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from("ga4_leads").insert(rows.slice(i, i + 500));
        if (error) throw error;
      }
    } catch (e) { writeError = e.message; }

    await supabase.from("site_meta").upsert({
      key: "ga4_sync_status",
      value: JSON.stringify({ ok: !writeError, pages: rows.length, total_leads: Object.values(leadsByPath).reduce((a, b) => a + b, 0), error: writeError, at: now }),
      updated_at: now,
    });
    if (writeError) console.error("GA4 write failed:", writeError);
    else console.log(`GA4 sync ok: ${rows.length} pages.`);
  } catch (e) {
    console.error("GA4 sync failed:", e.message);
    try { await supabase.from("site_meta").upsert({ key: "ga4_sync_status", value: JSON.stringify({ ok: false, error: e.message, at: new Date().toISOString() }) }); } catch {}
  }
};
