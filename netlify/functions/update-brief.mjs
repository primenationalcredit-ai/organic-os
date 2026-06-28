// netlify/functions/update-brief.mjs  â€” partial update of one assignment.
// Accepts any of: status, submitted_url, review_note, interview, draft_status.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DASHBOARD_PASSCODE
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
export default async (req) => {
  const url=new URL(req.url); const pass=url.searchParams.get("pass")||req.headers.get("x-pass");
  if(pass!==process.env.DASHBOARD_PASSCODE) return new Response(JSON.stringify({error:"unauthorized"}),{status:401,headers:{"content-type":"application/json"}});
  if(req.method!=="POST") return new Response(JSON.stringify({error:"use POST"}),{status:405,headers:{"content-type":"application/json"}});
  try{
    const body=await req.json(); const { id }=body;
    const patch={};
    if(body.status!==undefined){ if(!["open","doing","submitted","approved","changes"].includes(body.status)) return new Response(JSON.stringify({error:"bad status"}),{status:400,headers:{"content-type":"application/json"}}); patch.status=body.status; }
    if(body.submitted_url!==undefined) patch.submitted_url=body.submitted_url;
    if(body.review_note!==undefined) patch.review_note=body.review_note;
    if(body.interview!==undefined) patch.interview=body.interview;
    if(body.draft_status!==undefined) patch.draft_status=body.draft_status;
    if(body.rewrite_status!==undefined) patch.rewrite_status=body.rewrite_status;
    if(body.submission!==undefined) patch.submission=body.submission;
    if(body.ai_status!==undefined) patch.ai_status=body.ai_status;
    if(body.serp_status!==undefined) patch.serp_status=body.serp_status;
    const { error }=await supabase.from("content_briefs").update(patch).eq("id",id);
    if(error) throw error;
    return new Response(JSON.stringify({ok:true}),{headers:{"content-type":"application/json"}});
  }catch(e){ return new Response(JSON.stringify({error:e.message}),{status:500,headers:{"content-type":"application/json"}}); }
};
