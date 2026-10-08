// Generate an unapplied migration only after the clinic chooses an embedding
// model. Usage: node scripts/prepare-hybrid.mjs 1536 chosen-model-name
import {readFileSync,writeFileSync} from 'node:fs'
const dimension=Number(process.argv[2]),model=process.argv[3]
if(!Number.isInteger(dimension)||dimension<1||dimension>2000||!model||!/^[a-zA-Z0-9._:/-]+$/.test(model))throw new Error('Supply the approved dimension (1–2000) and embedding model identifier.')
const modelLiteral=`'${model}'`
const finish=readFileSync('supabase/migrations/004_rag_readiness.sql','utf8').match(/create function public\.finish_rag_job[\s\S]*?end \$\$;/)[0]
  .replace('create function','create or replace function')
  .replace('chunk_index,content,content_hash,metadata)','chunk_index,content,content_hash,metadata,embedding,embedding_model,embedding_version)')
  .replace("source->'metadata'\n",`source->'metadata',(c->>'embedding')::extensions.vector(${dimension}),${modelLiteral},1\n`)
let sql=`-- Generated for the approved embedding model ${model}; review and apply through Supabase MCP.\n
alter table public.rag_chunks add column embedding extensions.vector(${dimension});
create index rag_chunks_embedding_hnsw on public.rag_chunks using hnsw(embedding extensions.vector_cosine_ops);
create table public.rag_model_config(id boolean primary key default true check(id),model text not null,dimension integer not null);
alter table public.rag_model_config enable row level security;
revoke all on public.rag_model_config from anon,authenticated;
grant select on public.rag_model_config to authenticated;
grant all on public.rag_model_config to service_role;
create policy staff_model_read on public.rag_model_config for select to authenticated using((select private.staff_role()) is not null);
insert into public.rag_model_config(model,dimension) values(${modelLiteral},${dimension});
${finish}
insert into public.rag_jobs(source_type,source_id)
select 'visit',id from public.visits union all select 'vaccination',id from public.vaccinations
union all select 'alert',id from public.pet_alerts where is_active
union all select 'kb_document',id from public.kb_documents where status='published';
create function public.store_rag_embeddings(p_chunks jsonb,p_model text) returns void
language plpgsql security invoker set search_path='' as $body$ begin
  if p_model<>${modelLiteral} then raise exception 'Embedding model mismatch';end if;
  update public.rag_chunks c set embedding=(e->>'embedding')::extensions.vector(${dimension}),embedding_model=p_model,embedding_version=1
  from jsonb_array_elements(p_chunks) e where c.id=(e->>'id')::uuid and c.content_hash=e->>'hash';
end $body$;
revoke all on function public.store_rag_embeddings(jsonb,text) from public,anon,authenticated;
grant execute on function public.store_rag_embeddings(jsonb,text) to service_role;
`
for(const mode of ['patient','kb']){
  const patient=mode==='patient'
  const args=patient?`p_patient_id uuid,p_query_text text,p_query_embedding extensions.vector(${dimension}),p_model text,p_match_count integer default 8`:`p_query_text text,p_query_embedding extensions.vector(${dimension}),p_model text,p_match_count integer default 8`
  const returns=patient?'chunk_id uuid,source_type text,source_id uuid,content text,metadata jsonb,score double precision':'chunk_id uuid,document_id uuid,title text,version integer,content text,metadata jsonb,score double precision'
  const filter=patient?'c.patient_id=p_patient_id and c.document_id is null':"c.patient_id is null and exists(select 1 from public.kb_documents d where d.id=c.document_id and d.status='published')"
  const fields=patient?'c.id,c.source_type,c.source_id,c.content,c.metadata':'c.id,c.document_id,d.title,d.version,c.content,c.metadata'
  sql+=`\ncreate function public.retrieve_${mode}_context_hybrid(${args}) returns table(${returns})
language sql stable security invoker set search_path='' as $body$
  with eligible as materialized (select c.* from public.rag_chunks c where ${filter}),
  lexical as (select c.id,row_number() over(order by ts_rank_cd(c.fts,websearch_to_tsquery('simple',p_query_text)) desc,c.id) as rank
    from eligible c where c.fts @@ websearch_to_tsquery('simple',p_query_text)
    order by ts_rank_cd(c.fts,websearch_to_tsquery('simple',p_query_text)) desc,c.id limit 30),
  semantic as (select c.id,row_number() over(order by c.embedding operator(extensions.<=>) p_query_embedding,c.id) as rank
    from eligible c where p_model=${modelLiteral} and extensions.vector_dims(p_query_embedding)=${dimension} and c.embedding_model=p_model and c.embedding is not null
    order by c.embedding operator(extensions.<=>) p_query_embedding,c.id limit 30),
  fused as (select coalesce(l.id,s.id) as id,coalesce(1.0/(60+l.rank),0)+coalesce(1.0/(60+s.rank),0) as score
    from lexical l full outer join semantic s on s.id=l.id)
  select ${fields},f.score::double precision from fused f join eligible c on c.id=f.id ${patient?'':'join public.kb_documents d on d.id=c.document_id'}
  order by f.score desc,c.id limit least(greatest(p_match_count,1),20);
$body$;
revoke all on function public.retrieve_${mode}_context_hybrid(${patient?'uuid,':''}text,extensions.vector,text,integer) from public,anon;
grant execute on function public.retrieve_${mode}_context_hybrid(${patient?'uuid,':''}text,extensions.vector,text,integer) to authenticated;
`
}
const path='supabase/hybrid-model.migration.sql'
writeFileSync(path,sql)
console.log(`Prepared ${path}; it has NOT been applied.`)
