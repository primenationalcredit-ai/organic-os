// netlify/functions/generate-draft-background.mjs
// Reads the assignment + the expert's interview answers, writes a full blog draft.
// Saves draft + draft_status='ready'. Background function (15-min limit).
// Trigger: POST /.netlify/functions/generate-draft-background?id=BRIEF_ID&pass=PASS
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, DASHBOARD_PASSCODE
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SYS = `You write blog drafts for a US credit repair company. Rules:
- Write at a 5th to 6th grade reading level. Plain, warm, helpful. No fluff, no jargon.
- Build the ENTIRE draft around the expert's real answers below. Weave their stories,
  numbers, and exact phrasing throughout. This is what makes it rank and not read generic.
- SEO: put the target keyword in the title, the first sentence, and at least one H2.
  Use the suggested angle and sections. Add a clear call to action at the end.
- COMPLIANCE (critical, this is a regulated industry): never promise guaranteed results,
  never promise a specific score increase, never say you can remove accurate information.
  Use careful phrasing like "may", "can help", "in many cases".
- Output clean markdown: one H1, several H2s, short paragraphs.`;

export default async (req) => {
  const url=new URL(req.url); const id=url.searchParams.get("id"); const pass=url.searchParams.get("pass");
  if(pass!==process.env.DASHBOARD_PASSCODE) return new Response("unauthorized",{status:401});
  try{
    const { data:b } = await supabase.from("content_briefs").select("*").eq("id",id).single();
    const qa = Array.isArray(b.interview)? b.interview : [];
    const qaText = qa.map(x=>`Q: ${x.question}\nExpert's answer: ${x.answer||"(no answer given)"}`).join("\n\n");
    const res = await fetch("https://api.anthropic.com/v1/messages",{method:"POST",
      headers:{"content-type":"application/json","x-api-key":process.env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:8000,system:SYS,
        messages:[{role:"user",content:`TARGET KEYWORD: ${b.target_keyword}
PAGE: ${b.page_path}
WHY IT MATTERS: ${b.why}
SUGGESTED CALL TO ACTION: ${b.cta||""}

THE EXPERT'S INTERVIEW ANSWERS (build the draft from these):
${qaText}

Write the full blog draft now, in markdown.`}]})});
    if(!res.ok) throw new Error("Anthropic "+res.status);
    const data=await res.json();
    const draft=(data.content||[]).filter(x=>x.type==="text").map(x=>x.text).join("\n").trim();
    await supabase.from("content_briefs").update({ draft, draft_status:"ready" }).eq("id",id);
    console.log("Draft ready for "+id);
  }catch(e){
    console.error("Draft failed:", e.message);
    try{ await supabase.from("content_briefs").update({ draft_status:"error" }).eq("id",id); }catch{}
  }
};
