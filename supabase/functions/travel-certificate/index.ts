import { checked,createClient,headers,url } from '../_shared/http.ts';
import { boundedBytes } from '../_shared/petPhotos.ts';

// A random QR token grants access to one document only while the clinic has
// explicitly enabled public viewing. Never cache a successful or denied read.
Deno.serve(async(req:Request)=>{
  const responseHeaders={...headers,'Cache-Control':'no-store, max-age=0','Pragma':'no-cache','X-Robots-Tag':'noindex, nofollow, noarchive','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
  const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:responseHeaders});
  if(req.method==='OPTIONS')return new Response(null,{headers:responseHeaders});
  if(req.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
  let token:unknown;
  try { token=JSON.parse(new TextDecoder().decode(await boundedBytes(req.body,1024))).token; }
  catch { return reply({error:'NOT_AVAILABLE'},404); }
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return reply({error:'NOT_AVAILABLE'},404);
  try {
    const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const certificate=checked(await admin.rpc('read_public_travel_certificate',{p_token:token}));
    return certificate?reply(certificate):reply({error:'NOT_AVAILABLE'},404);
  } catch { return reply({error:'TEMPORARILY_UNAVAILABLE'},503); }
});
