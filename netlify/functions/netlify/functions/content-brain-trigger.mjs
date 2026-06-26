// ============================================================================
// netlify/functions/content-brain-trigger.mjs
// The "alarm clock." Runs every Monday and wakes the content brain.
// This is the piece that makes everything automatic — you never trigger
// anything by hand again.
//
// It returns instantly (just pokes the worker), so it never hits a timeout.
// The actual brief-writing happens in content-brain-background.mjs.
// ============================================================================

export default async () => {
  const url =
    "https://asapwebsitetraffic.netlify.app/.netlify/functions/content-brain-background";
  try {
    await fetch(url, { method: "POST" });
    console.log("Content brain triggered.");
  } catch (err) {
    console.error("Trigger failed:", err.message);
  }
};

// Every Monday at 08:00 UTC. Change this line if you want a different time.
export const config = { schedule: "0 8 * * 1" };
