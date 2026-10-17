import {body,checked,createClient,failure,headers,json,staff,url} from '../_shared/http.ts';
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response(null,{headers});
  try {
    const actor=await staff(req,true);
    const claims=JSON.parse(atob(actor.authorization.split('.')[1].replaceAll('-','+').replaceAll('_','/')));
    if(claims.aal!=='aal2') return json({error:'MFA_REQUIRED'},403);
    const input=await body(req);
    const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    if(input.action==='list'){
      const profiles=checked(await admin.from('profiles').select('id,full_name,role,is_active'));
      const accounts=[];
      for(let page=1;;page++){
        const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000});
        if(error)throw error;
        for(const user of data.users){
          const profile=profiles.find((entry)=>entry.id===user.id);
          // This marker filters the pending list only. It never grants access.
          if(!profile && user.user_metadata?.application!=='veterina')continue;
          accounts.push({id:user.id,email:user.email,full_name:profile?.full_name||user.user_metadata?.full_name||'',role:profile?.role||null,is_active:profile?.is_active||false});
        }
        if(data.users.length<1000)break;
      }
      return json({accounts});
    }
    if(input.action==='approve'){
      if(typeof input.id!=='string'||!['owner','clinical_staff'].includes(input.role)||!input.full_name?.trim())throw new Error('VALIDATION_FAILED');
      const {data,error}=await admin.auth.admin.getUserById(input.id);
      if(error)throw error;
      if(!data.user.email_confirmed_at)throw new Error('VALIDATION_FAILED: verified email required');
      checked(await admin.from('profiles').insert({id:input.id,full_name:input.full_name.trim(),role:input.role,is_active:true}));
      checked(await admin.from('audit_logs').insert({actor_id:actor.user.id,action:'STAFF_APPROVED',table_name:'profiles',record_id:input.id}));
      return json({success:true});
    }
    if(input.action==='invite'){
      if(typeof input.email!=='string'||!['owner','clinical_staff'].includes(input.role)||!input.full_name?.trim())throw new Error('VALIDATION_FAILED');
      const redirectTo=Deno.env.get('AUTH_REDIRECT_URL');
      if(!redirectTo)throw new Error('PROVIDER_NOT_CONFIGURED');
      const {data,error}=await admin.auth.admin.inviteUserByEmail(input.email,{redirectTo});
      if(error)throw error;
      const {error:profileError}=await admin.from('profiles').insert({id:data.user.id,full_name:input.full_name.trim(),role:input.role,is_active:true});
      if(profileError){await admin.auth.admin.deleteUser(data.user.id);throw profileError;}
      checked(await admin.from('audit_logs').insert({actor_id:actor.user.id,action:'STAFF_INVITED',table_name:'profiles',record_id:data.user.id}));
      return json({id:data.user.id});
    }
    if(input.action==='update'&&['owner','clinical_staff'].includes(input.role)&&typeof input.is_active==='boolean'){
      checked(await admin.rpc('admin_update_staff',{p_actor:actor.user.id,p_id:input.id,p_role:input.role,p_active:input.is_active}));
      return json({success:true});
    }
    throw new Error('VALIDATION_FAILED');
  }catch(error){return failure(error);}
});
