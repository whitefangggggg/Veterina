import {body,checked,failure,headers,json,staff} from '../_shared/http.ts';
import {csvStream} from '../_shared/csv.js';
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{headers});
  try{
    const {client}=await staff(req,true);
    const input=await body(req);
    if(!['patients','vaccinations','inventory','reminders','history'].includes(input.report) ||
      (input.format!==undefined && !['csv','json'].includes(input.format)) ||
      (input.report==='history' && input.format==='csv'))throw new Error('VALIDATION_FAILED');
    const result=checked(await client.rpc('filtered_export_report',{
      p_report:input.report,p_patient_id:input.patient_id || null,p_filters:input.filters || {},
    }));
    if(input.format!=='csv')return json(result);
    return new Response(csvStream(result.rows),{headers:{...headers,
      'Content-Type':'text/csv; charset=utf-8',
      'Content-Disposition':`attachment; filename="veterina-${input.report}.csv"`,
      'X-Row-Count':String(result.row_count),
      'X-Export-Id':result.export_id,
      'Access-Control-Expose-Headers':'X-Row-Count, X-Export-Id, Content-Disposition',
      'Cache-Control':'no-store',
    }});
  }catch(error){return failure(error);}
});
