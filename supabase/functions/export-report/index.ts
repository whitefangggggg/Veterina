import {body,checked,failure,headers,json,staff} from '../_shared/http.ts';
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{headers});
  try{const {client}=await staff(req,true);const input=await body(req);const rows=checked(await client.rpc('export_report',{p_report:input.report,p_patient_id:input.patient_id || null}));return json({rows});}catch(error){return failure(error);}
});
