// netlify/functions/scheduled-sync.mjs
// Netlify runs this automatically once a day. It kicks off all four data
// syncs so the dashboard refreshes itself with no manual steps.
// Schedule: 11:00 UTC daily (early morning Mountain time).
export const config = { schedule: "0 11 * * *" };

const BASE = "https://asapwebsitetraffic.netlify.app/.netlify/functions";
const TARGETS = ["sync-gsc", "backfill-gsc-background", "sync-ga4-background", "sync-ahrefs-background", "track-ranks-background"];

export default async () => {
  const results = {};
  await Promise.allSettled(
    TARGETS.map(async (t) => {
      try { const r = await fetch(`${BASE}/${t}`); results[t] = r.status; }
      catch (e) { results[t] = "error: " + e.message; }
    })
  );
  console.log("Scheduled sync fired:", JSON.stringify(results));
  return new Response(JSON.stringify({ fired: results }), { headers: { "content-type": "application/json" } });
};
