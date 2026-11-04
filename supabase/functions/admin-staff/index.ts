import {body,checked,createClient,failure,headers,json,staff,url} from '../_shared/http.ts';
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response(null,{headers});
  try {
    const actor=await staff(req,true);
    const input=await body(req);
    if(['list','approve','reject','update'].includes(input.action)){
      return json(checked(await actor.client.rpc('staff_administration',{p_action:input.action,p_data:input})));
    }
    if(input.action==='invite'){
      if(typeof input.email!=='string'||input.role!=='clinical_staff'||!input.full_name?.trim())throw new Error('VALIDATION_FAILED');
      const redirectTo=Deno.env.get('AUTH_REDIRECT_URL');
      if(!redirectTo)throw new Error('PROVIDER_NOT_CONFIGURED');
      const invitation=checked(await actor.client.rpc('owner_veterina_code',{p_rotate:false}));
      const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
      const {data,error}=await admin.auth.admin.inviteUserByEmail(input.email,{redirectTo,data:{application:'veterina',full_name:input.full_name.trim(),veterina_code:invitation.code}});
      if(error)throw error;
      return json({id:data.user.id,pending:true});
    }
    throw new Error('VALIDATION_FAILED');
  }catch(error){return failure(error);}
});
