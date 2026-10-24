import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useClinicData } from '../context/ClinicDataContext'
import { supabase } from '../lib/supabaseClient'
import { Field,PageHeader,SectionCard } from '../components/ui'
import MutationForm from '../components/MutationForm'
import Assistant from '../components/Assistant'
import { useHashTarget } from '../lib/useHashTarget'
export default function Knowledge(){
  const targetId = useHashTarget()
  const {profile}=useAuth()
  const {kbDocuments=[],manageKb}=useClinicData()
  const [form,setForm]=useState({title:'',content:'',kind:'sop'}),[indexResult,setIndexResult]=useState('')
  const owner=profile?.role==='owner'
  return <div className="page"><PageHeader title="Clinic knowledge" description="Only published documents are available to record recall."/><Assistant/>
    {targetId && !kbDocuments.some((doc) => doc.id === targetId) && <p className="auth-message auth-error" role="alert">This source document is unavailable or you do not have access to it.</p>}
    {owner&&<SectionCard title="Add a document draft"><MutationForm onSubmit={async()=>{await manageKb({...form,action:'create'});setForm({title:'',content:'',kind:'sop'})}}>
      <Field label="Title"><input required value={form.title} onChange={(e)=>setForm({...form,title:e.target.value})}/></Field>
      <Field label="Approved document text"><textarea required rows={8} maxLength={100000} value={form.content} onChange={(e)=>setForm({...form,content:e.target.value})}/></Field>
      <button className="button button-primary">Save draft</button>
    </MutationForm><MutationForm onSubmit={async()=>{const{data,error}=await supabase.functions.invoke('embed-worker',{body:{}});if(error)throw error;setIndexResult(`${data.completed} sources indexed; ${data.failed} failed. Run again if jobs remain.`)}}><button className="button button-secondary">Index pending sources</button></MutationForm>{indexResult&&<p role="status">{indexResult}</p>}</SectionCard>}
    {kbDocuments.map((doc)=><SectionCard key={doc.id} id={doc.id} title={doc.title}><article><p>{doc.status} · version {doc.version}</p><p className="document-text">{doc.content}</p>{owner&&<MutationForm onSubmit={async()=>manageKb({action:doc.status==='draft'?'publish':'archive',id:doc.id})}><button disabled={doc.status==='archived'} className="button button-secondary">{doc.status==='draft'?'Publish':'Archive'}</button></MutationForm>}</article></SectionCard>)}
  </div>
}
