// ============================================================================
// netlify/functions/sync-gsc.mjs
// Pulls Google Search Console (query + page + date) into Supabase daily.
// This is your REFERENCE sync — clone its shape for GA4, Ahrefs, Pipedrive, GBP.
//
// Deploy: drop in netlify/functions/. It runs on the cron schedule below.
// Env needed: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//             GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, GSC_SITE_URL
//
// GSC_SITE_URL is either 'https://asapcreditrepairusa.com/' (URL-prefix property)
// or 'sc-domain:asapcreditrepairusa.com' (domain property). Match what's in GSC.
// ============================================================================

import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function searchConsole() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SA_EMAIL,
      // Netlify stores the key with literal \n; turn them back into newlines.
      private_key: process.env.GOOGLE_SA_PRIVATE_KEY.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
  return google.searchconsole({ version: "v1", auth });
}

function isoDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export default async () => {
  const sc = searchConsole();
  const siteUrl = process.env.GSC_SITE_URL;

  // GSC finalizes data with a ~2-3 day lag, so re-pull a rolling 4-day window
  // and upsert. Old rows get corrected, nothing double-counts.
  const startDate = isoDaysAgo(4);
  const endDate = isoDaysAgo(1);

  const ROW_LIMIT = 25000;
  let startRow = 0;
  let pulled = 0;

  try {
    while (true) {
      const res = await sc.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate,
          endDate,
          dimensions: ["date", "page", "query"],
          rowLimit: ROW_LIMIT,
          startRow,
          dataState: "all",
        },
      });

      const rows = res.data.rows || [];
      if (rows.length === 0) break;

      const records = rows.map((r) => ({
        date: r.keys[0],
        page: r.keys[1],
        query: r.keys[2],
        clicks: r.clicks || 0,
        impressions: r.impressions || 0,
        ctr: r.ctr || 0,
        position: r.position || 0,
      }));

      // Upsert in batches of 500 on the composite key.
      for (let i = 0; i < records.length; i += 500) {
        const batch = records.slice(i, i + 500);
        const { error } = await supabase
          .from("gsc_performance")
          .upsert(batch, { onConflict: "date,page,query" });
        if (error) throw error;
      }

      pulled += rows.length;
      if (rows.length < ROW_LIMIT) break;
      startRow += ROW_LIMIT;
    }

    console.log(`GSC sync ok: ${pulled} rows for ${startDate}..${endDate}`);
    return new Response(JSON.stringify({ ok: true, rows: pulled }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("GSC sync failed:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};

// Runs every day at 09:00 UTC. Adjust the cron as you like.
export const config = { schedule: "0 9 * * *" };

