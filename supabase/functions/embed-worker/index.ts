import {body,checked,createClient,failure,headers,json,staff,url} from '../_shared/http.ts';
import {GatewayEmbedder,TextChunker} from '../_shared/pipeline.ts';
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{headers});
  try{
    const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const worker=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const schedulerSecret=req.headers.get('x-worker-secret');
    const internal=req.headers.get('Authorization')===`Bearer ${key}` || (schedulerSecret && checked(await worker.rpc('verify_worker_secret',{p_secret:schedulerSecret})));
    // An owner may explicitly run indexing from the knowledge workspace.
    if(!internal)await staff(req,true);
    await body(req);
    const configuration=await worker.from('rag_model_config').select('model,dimension').maybeSingle();
    if(configuration.error && !['42P01','PGRST205'].includes(configuration.error.code))throw configuration.error;
    const config=configuration.data;
    const endpoint=Deno.env.get('EMBEDDING_GATEWAY_URL'),providerKey=Deno.env.get('EMBEDDING_GATEWAY_KEY');
    if(config && (!endpoint || !providerKey))throw new Error('PROVIDER_NOT_CONFIGURED');
    const embedder=config?new GatewayEmbedder(endpoint!,providerKey!,config.model,config.dimension):null;
    const jobs=checked<any[]>(await worker.rpc('claim_rag_jobs',{p_limit:20}));
    let completed=0,failed=0;
    for(const job of jobs){
      try{
        const source=checked<any>(await worker.rpc('rag_source_with_hash',{p_type:job.source_type,p_id:job.source_id}));
        const texts=source?new TextChunker().split(source.content):[];
        const embeddings=embedder && texts.length?await embedder.embed(texts):null;
        const chunks=texts.map((content,index)=>({content,index,source_hash:source.source_hash,embedding:embeddings?JSON.stringify(embeddings[index]):null}));
        const ok=checked(await worker.rpc('finish_rag_job',{p_id:job.id,p_lease:job.lease_token,p_chunks:chunks}));
        if(ok)completed++;
      }catch{
        failed++;await worker.rpc('finish_rag_job',{p_id:job.id,p_lease:job.lease_token,p_chunks:[],p_error:'Indexing failed; see worker diagnostics'});
      }
    }
    return json({claimed:jobs.length,completed,failed,index:config?'hybrid':'full_text',embeddings_configured:Boolean(config)});
  }catch(error){return failure(error);}
});
