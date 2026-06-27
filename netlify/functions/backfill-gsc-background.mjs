// netlify/functions/backfill-gsc.mjs
// One-time (re-runnable) backfill of 16 months of MONTHLY site totals from GSC.
// Writes to gsc_monthly so the Trends tab can show today vs 3/6/12 months ago.
// Trigger: open /.netlify/functions/backfill-gsc once. Background function.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, GSC_SITE_URL
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function searchConsole() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SA_EMAIL,
      private_key: process.env.GOOGLE_SA_PRIVATE_KEY.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
  return google.searchconsole({ version: "v1", auth });
}

function monthRange(offset) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0));
  const endCapped = end > now ? now : end;
  const iso = (x) => x.toISOString().slice(0, 10);
  return { label: `${y}-${String(m + 1).padStart(2, "0")}`, startDate: iso(start), endDate: iso(endCapped) };
}

export default async () => {
  const sc = searchConsole();
  const siteUrl = process.env.GSC_SITE_URL;
  try {
    let done = 0;
    for (let i = 0; i < 16; i++) {
      const { label, startDate, endDate } = monthRange(i);
      const res = await sc.searchanalytics.query({
        siteUrl,
        requestBody: { startDate, endDate, dataState: "all" }, // no dimensions = one total row
      });
      const r = (res.data.rows && res.data.rows[0]) || { clicks: 0, impressions: 0, position: 0 };
      await supabase.from("gsc_monthly").upsert({
        month: label,
        clicks: Math.round(r.clicks || 0),
        impressions: Math.round(r.impressions || 0),
        position: r.position ? Math.round(r.position * 10) / 10 : 0,
      }, { onConflict: "month" });
      done++;
    }
    console.log(`Backfill ok: ${done} months written.`);
  } catch (err) {
    console.error("Backfill failed:", err.message);
  }
};
