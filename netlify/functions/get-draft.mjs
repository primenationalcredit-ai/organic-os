// netlify/functions/get-draft.mjs  â€” polled by the app while the draft builds.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DASHBOARD_PASSCODE
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
export default async (req) => {
  const url=new URL(req.url); const pass=url.searchParams.get("pass")||req.headers.get("x-pass");
  if(pass!==process.env.DASHBOARD_PASSCODE) return new Response(JSON.stringify({error:"unauthorized"}),{status:401,headers:{"content-type":"application/json"}});
  try{
    const id=url.searchParams.get("id");
    const { data } = await supabase.from("content_briefs").select("draft,draft_status").eq("id",id).single();
    return new Response(JSON.stringify(data||{}),{headers:{"content-type":"application/json"}});
  }catch(e){ return new Response(JSON.stringify({error:e.message}),{status:500,headers:{"content-type":"application/json"}}); }
};
