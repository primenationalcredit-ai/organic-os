// netlify/functions/ga4-check.mjs
// Discovery (regular function, returns instantly). Uses your Google service
// account to find your GA4 property automatically and show what conversion
// events (leads) you track, plus a sample of landing-page traffic.
// Open: /.netlify/functions/ga4-check?pass=YOUR_PASSCODE
// Env: GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, DASHBOARD_PASSCODE
import { google } from "googleapis";

function gauth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SA_EMAIL,
      private_key: (process.env.GOOGLE_SA_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
}

export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("pass") !== process.env.DASHBOARD_PASSCODE)
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });

  const out = { sa_email: process.env.GOOGLE_SA_EMAIL || null };
  try {
    const auth = gauth();
    const admin = google.analyticsadmin({ version: "v1beta", auth });

    // 1. List GA4 properties this service account can see.
    let chosen = null;
    try {
      const sums = await admin.accountSummaries.list();
      out.accounts = (sums.data.accountSummaries || []).map((acc) => ({
        account: acc.displayName,
        properties: (acc.propertySummaries || []).map((p) => ({ property: p.property, name: p.displayName })),
      }));
      for (const acc of out.accounts)
        for (const p of acc.properties)
          if (!chosen && /asap|credit/i.test(p.name || "")) chosen = p.property;
      if (!chosen && out.accounts[0] && out.accounts[0].properties[0]) chosen = out.accounts[0].properties[0].property;
      out.chosen_property = chosen;
    } catch (e) { out.accounts_error = e.message; }

    // 2. Which events are marked as conversions (your "leads").
    if (chosen) {
      try {
        const ke = await admin.properties.keyEvents.list({ parent: chosen });
        out.key_events = (ke.data.keyEvents || []).map((k) => k.eventName);
      } catch (e) { out.key_events_error = e.message; }
    }

    // 3. Sample: top landing pages with sessions + conversions, last 28 days.
    if (chosen) {
      try {
        const data = google.analyticsdata({ version: "v1beta", auth });
        const rep = await data.properties.runReport({
          property: chosen,
          requestBody: {
            dateRanges: [{ startDate: "28daysAgo", endDate: "yesterday" }],
            dimensions: [{ name: "landingPagePlusQueryString" }],
            metrics: [{ name: "sessions" }, { name: "conversions" }],
            orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
            limit: 5,
          },
        });
        out.sample_rows = (rep.data.rows || []).map((r) => ({
          landing: r.dimensionValues[0].value,
          sessions: r.metricValues[0].value,
          conversions: r.metricValues[1].value,
        }));
      } catch (e) { out.sample_error = e.message; }
    }

    return new Response(JSON.stringify(out, null, 2), { headers: { "content-type": "application/json" } });
  } catch (e) {
    out.error = e.message;
    return new Response(JSON.stringify(out, null, 2), { status: 500, headers: { "content-type": "application/json" } });
  }
};
