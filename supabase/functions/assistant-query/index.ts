import {body,checked,failure,headers,json,staff} from '../_shared/http.ts';
import {GatewayEmbedder} from '../_shared/pipeline.ts';
// Retrieval always uses the user's client. There is no privileged client here.
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{headers});
  const started=Date.now();let interaction:string|undefined;let client:any;
  try{
    ({client}=await staff(req));
    const input=await body(req);
    if(!['patient','knowledge'].includes(input.mode)||typeof input.question!=='string'||input.question.trim().length<3||input.question.length>2000||
      (input.mode==='patient'&&!/^[0-9a-f-]{36}$/i.test(input.patient_id)))throw new Error('VALIDATION_FAILED');
    const patient=input.mode==='patient'?input.patient_id:null;
    interaction=checked(await client.rpc('start_assistant',{p_mode:input.mode,p_patient_id:patient}));
    const question=input.question.trim();
    // Conservative refusal while treatment/dose recall remains an open PRD decision.
    if(/\b(dose|dosage|prescrib\w*|recommend\w*|diagnos\w*|treat\w*|how much|what should|ignore\s+(previous|all)|system prompt)\b/i.test(question)){
      checked(await client.rpc('finish_assistant',{p_id:interaction,p_outcome:'declined',p_chunks:[],p_model:'record-recall',p_latency:Date.now()-started}));
      return json({answer:'I can recall documented visits, vaccines, measurements, and approved procedures. Clinical recommendations and dosing questions require the veterinarian.',citations:[],insufficient_evidence:true,interaction_id:interaction});
    }
    const configuration=await client.from('rag_model_config').select('model,dimension').maybeSingle();
    if(configuration.error && !['42P01','PGRST205'].includes(configuration.error.code))throw configuration.error;
    const config=configuration.data,endpoint=Deno.env.get('EMBEDDING_GATEWAY_URL'),providerKey=Deno.env.get('EMBEDDING_GATEWAY_KEY');
    let queryEmbedding:number[]|null=null;
    if(config && endpoint && providerKey){try{[queryEmbedding]=await new GatewayEmbedder(endpoint,providerKey,config.model,config.dimension).embed([question]);}catch{/* Full-text recall stays available during provider outages. */}}
    const params:any={p_query_text:question,p_match_count:8};if(patient)params.p_patient_id=patient;
    if(queryEmbedding){params.p_query_embedding=JSON.stringify(queryEmbedding);params.p_model=config.model;}
    const chunks=checked<any[]>(await client.rpc(`${input.mode==='patient'?'retrieve_patient':'retrieve_kb'}_context${queryEmbedding?'_hybrid':''}`,params));
    const facts=input.mode==='patient'?checked<any>(await client.rpc('patient_facts',{p_patient_id:patient})):null;
    const evidence:any[]=[];
    // Fixed structured reads handle exact facts; the model never selects SQL or a patient.
    if(facts && /vaccin|rabies|immun/i.test(question)){
      const match=question.match(/rabies|distemper|parvo|bordetella|lepto/i)?.[0];
      const vaccines=facts.vaccinations.filter((v:any)=>!match||v.vaccine_name.toLowerCase().includes(match.toLowerCase()));
      for(const v of (/last|latest/i.test(question)?vaccines.slice(0,1):vaccines))evidence.push({source_type:'vaccination',source_id:v.id,label:v.vaccine_name,date:v.administered_at,content:`${v.vaccine_name}: administered ${v.administered_at}; next due ${v.next_due_at || 'not recorded'}.`});
    }
    if(facts?.latest_weight && /weight|weigh|measurement/i.test(question)){const w=facts.latest_weight;evidence.push({source_type:'visit',source_id:w.source_id,label:'Latest recorded weight',date:w.date,content:`Latest weight: ${w.weight_kg} kg, recorded ${w.date}. This measurement is not necessarily from the vaccination visit.`});}
    if(facts && /reminder|follow.?up|due/i.test(question))for(const r of facts.open_reminders)evidence.push({source_type:'reminder_note',source_id:r.id,label:r.title,date:r.due_at,content:`${r.title}: due ${r.due_at}.`});
    for(const c of chunks)evidence.push({source_type:input.mode==='patient'?c.source_type:'kb_document',source_id:c.source_id || c.document_id,label:c.metadata?.label || c.title,date:c.metadata?.date,content:c.content,version:c.version || c.metadata?.version,chunk_id:c.chunk_id});
    const unique=evidence.filter((e,i,a)=>a.findIndex((x)=>x.source_type===e.source_type && x.source_id===e.source_id && x.content===e.content)===i).slice(0,12);
    // Extractive fallback guarantees cited record recall before a generator is configured.
    // A future Generator adapter must return evidence IDs, never arbitrary citation URLs.
    const answer=unique.length?unique.map((e,i)=>`[${i+1}] ${e.content}`).join('\n\n'):'There is insufficient evidence in this patient record or the published clinic documents to answer that question.';
    checked(await client.rpc('finish_assistant',{p_id:interaction,p_outcome:unique.length?'answered':'insufficient_evidence',p_chunks:chunks.map((c)=>c.chunk_id),p_model:'extractive-recall-v1',p_latency:Date.now()-started}));
    return json({answer,insufficient_evidence:!unique.length,citations:unique.map(({content:_content,chunk_id:_chunkId,...citation})=>citation),interaction_id:interaction,mode:'extractive'});
  }catch(error){
    if(interaction&&client)await client.rpc('finish_assistant',{p_id:interaction,p_outcome:'error',p_chunks:[],p_model:'extractive-recall-v1',p_latency:Date.now()-started});
    return failure(error);
  }
});
