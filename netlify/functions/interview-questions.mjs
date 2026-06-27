// netlify/functions/interview-questions.mjs
// Asks Claude to generate sharp interview questions for one assignment, so the
// blog gets built from the expert's real knowledge, not generic AI filler.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, DASHBOARD_PASSCODE
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SYS = `You are a sharp editorial interviewer for a US credit repair company's blog.
Your job is to pull the founder's real, hard-won expertise out of his head so the blog
is not generic. Ask specific, probing questions a generic AI could never answer on its
own: real client outcomes, the mistakes people make, the exact way he explains things to
clients, what competitors get wrong, real numbers and timelines. Plain language.`;

function parse(text){ const c=text.replace(/```json|```/g,"").trim(); try{return JSON.parse(c);}catch{ const i=c.indexOf("["),j=c.lastIndexOf("]"); if(i>=0&&j>i){try{return JSON.parse(c.slice(i,j+1));}catch{}} return []; } }

export default async (req) => {
  const url=new URL(req.url); const pass=url.searchParams.get("pass")||req.headers.get("x-pass");
  if(pass!==process.env.DASHBOARD_PASSCODE) return new Response(JSON.stringify({error:"unauthorized"}),{status:401,headers:{"content-type":"application/json"}});
  try{
    const { brief_id } = await req.json();
    const { data:b } = await supabase.from("content_briefs").select("target_keyword,page_path,why").eq("id",brief_id).single();
    const res = await fetch("https://api.anthropic.com/v1/messages",{method:"POST",
      headers:{"content-type":"application/json","x-api-key":process.env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1200,system:SYS,
        messages:[{role:"user",content:`Blog topic keyword: "${b.target_keyword}"
Page: ${b.page_path}
Why it matters: ${b.why}

Generate exactly 5 sharp interview questions to ask the expert before writing this blog.
Return ONLY a JSON array of 5 strings, nothing else.`}]})});
    if(!res.ok) throw new Error("Anthropic "+res.status);
    const data=await res.json();
    const text=(data.content||[]).filter(x=>x.type==="text").map(x=>x.text).join("\n");
    return new Response(JSON.stringify({questions:parse(text)}),{headers:{"content-type":"application/json"}});
  }catch(e){ return new Response(JSON.stringify({error:e.message}),{status:500,headers:{"content-type":"application/json"}}); }
};
