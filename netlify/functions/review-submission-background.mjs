// netlify/functions/review-submission-background.mjs
// AI editor: checks a writer's submitted draft against the assignment + compliance
// rules. Passes it to the human queue, or bounces it back with fixes. Background.
// Trigger: POST /.netlify/functions/review-submission-background?id=BRIEF_ID&pass=PASS
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, DASHBOARD_PASSCODE
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SYS = `You are a strict but fair editor for a US credit repair company's blog. You review a writer's submitted draft against the assignment and decide if it can go live. You check: it covers the target keyword and the reader's real question; a clear SEO title and meta description; logical H2 structure; an FAQ section (helps AI engines cite us); a clear call to action; and plain 5th-to-6th grade writing.
COMPLIANCE IS NON-NEGOTIABLE (regulated industry). The draft must NOT: promise guaranteed results, promise a specific score increase or point amount, claim to remove accurate or verified information, or state timelines as guarantees. Any of these is an automatic fail.
Return ONLY a JSON object, nothing else:
{"passed": true|false, "score": 0-100, "compliance_issues": ["..."], "must_fix": ["..."], "nice_to_have": ["..."], "strengths": ["..."], "summary": "one sentence"}
Rules: if compliance_issues is non-empty, passed MUST be false. If must_fix is non-empty, passed MUST be false. Each item is one short, plain sentence a writer can act on.`;

export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const pass = url.searchParams.get("pass");
  if (pass !== process.env.DASHBOARD_PASSCODE) return new Response("unauthorized", { status: 401 });
  try {
    const { data: b } = await supabase.from("content_briefs").select("*").eq("id", id).single();
    const assignment = `TARGET KEYWORD: ${b.target_keyword}
PAGE: ${b.page_path}
WHAT THIS SHOULD ACCOMPLISH: ${b.why || ""}
SUGGESTED CALL TO ACTION: ${b.cta || ""}
STEPS THE WRITER WAS GIVEN: ${(Array.isArray(b.steps) ? b.steps.join(" | ") : "")}`;
    const submission = (b.submission || "").slice(0, 16000);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6", max_tokens: 1500, system: SYS,
        messages: [{ role: "user", content: `ASSIGNMENT:\n${assignment}\n\nWRITER'S SUBMITTED DRAFT:\n${submission}\n\nReview it and return the JSON verdict.` }],
      }),
    });
    if (!res.ok) throw new Error("Anthropic " + res.status);
    const data = await res.json();
    let text = (data.content || []).filter((x) => x.type === "text").map((x) => x.text).join("").trim();
    let v; try { v = JSON.parse(text); } catch { const m = text.match(/\{[\s\S]*\}/); v = m ? JSON.parse(m[0]) : null; }
    if (!v) throw new Error("Could not parse review");

    if ((v.compliance_issues && v.compliance_issues.length) || (v.must_fix && v.must_fix.length)) v.passed = false;
    const note = v.passed ? null : [...(v.compliance_issues || []).map((x) => "Compliance: " + x), ...(v.must_fix || [])].join(" â€¢ ");

    await supabase.from("content_briefs").update({
      ai_review: v,
      ai_status: v.passed ? "passed" : "failed",
      status: v.passed ? "submitted" : "changes",
      review_note: note,
    }).eq("id", id);
    console.log(`Review ${id}: ${v.passed ? "PASS" : "FAIL"}`);
  } catch (e) {
    console.error("Review failed:", e.message);
    try { await supabase.from("content_briefs").update({ ai_status: "error" }).eq("id", id); } catch {}
  }
};
