import { createClient } from 'npm:@supabase/supabase-js@2.111.0';
export const url = Deno.env.get('SUPABASE_URL')!;
export const publicKey = Deno.env.get('SUPABASE_ANON_KEY')!;
export const headers = {'Access-Control-Allow-Origin':Deno.env.get('APP_ORIGIN') || '*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
export const json = (body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
export function checked<T>(result:{data:T;error:unknown}):T {if(result.error)throw result.error;return result.data;}
export async function staff(req:Request,owner=false){
  const authorization=req.headers.get('Authorization') || '';
  if(!authorization.startsWith('Bearer '))throw new Error('UNAUTHENTICATED');
  const client=createClient(url,publicKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.auth.getUser(authorization.slice(7));
  if(error || !data.user)throw new Error('UNAUTHENTICATED');
  const profile=checked(await client.from('profiles').select('id,role,is_active').eq('id',data.user.id).maybeSingle());
  if(!profile?.is_active || (owner && profile.role!=='owner'))throw new Error('FORBIDDEN');
  return {client,user:data.user,profile,authorization};
}
export function failure(error:unknown){
  const message=error instanceof Error?error.message:typeof error==='object'&&error&&'message' in error?String(error.message):'REQUEST_FAILED';
  const code=['UNAUTHENTICATED','FORBIDDEN','AI_DISABLED','AI_RATE_LIMITED','NOT_FOUND','PROVIDER_NOT_CONFIGURED','VALIDATION_FAILED'].find((c)=>message.includes(c)) || 'REQUEST_FAILED';
  return json({error:code},code==='UNAUTHENTICATED'?401:code==='FORBIDDEN'?403:code==='AI_RATE_LIMITED'?429:code==='AI_DISABLED'||code==='PROVIDER_NOT_CONFIGURED'?503:code==='NOT_FOUND'?404:400);
}
export async function body(req:Request){
  if(req.method!=='POST')throw new Error('VALIDATION_FAILED');
  const text=await req.text();if(text.length>110000)throw new Error('VALIDATION_FAILED');
  return JSON.parse(text);
}
export {createClient};
