import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { unwrap } from '../lib/clinicRepository'
import { useClinicData } from '../context/ClinicDataContext'
import MutationForm from './MutationForm'
import { SectionCard } from './ui'
export default function Assistant({patientId}){
  const {settings}=useClinicData()
  const [question,setQuestion]=useState(''),[result,setResult]=useState(null)
  return <SectionCard title={patientId?'Patient record recall':'Clinic knowledge recall'} description="Read-only answers with sources. Clinical questions belong with the veterinarian.">
    {!settings?.ai_enabled?<p>Assistant is disabled. The owner can enable it in clinic settings.</p>:<MutationForm onSubmit={async()=>{
      const response=await supabase.functions.invoke('assistant-query',{body:{mode:patientId?'patient':'knowledge',patient_id:patientId,question}})
      if(response.error){let detail;try{detail=await response.error.context?.json?.()}catch{/* Offline response has no JSON body. */}throw new Error(detail?.error || response.error.message)}
      setResult(response.data)
    }}><label>Question<textarea required minLength={3} maxLength={2000} value={question} onChange={(e)=>setQuestion(e.target.value)} placeholder={patientId?'When was the last rabies vaccine?':'Find the discharge checklist'}/></label><button className="button button-secondary">Find evidence</button></MutationForm>}
    {result&&<div className="assistant-answer"><p>{result.answer}</p><ol>{result.citations.map((c,i)=><li key={`${c.source_type}-${c.source_id}-${i}`}>{c.source_type==='kb_document'?<Link to={`/knowledge#${c.source_id}`}>{c.label} · version {c.version}</Link>:<Link to={c.source_type==='reminder_note'?'/reminders':`/patients/${patientId}#${c.source_id}`}>{c.label} · {c.date?.slice(0,10)}</Link>}</li>)}</ol><MutationForm onSubmit={async()=>unwrap(await supabase.rpc('assistant_feedback',{p_id:result.interaction_id,p_feedback:1,p_reason:''}))}><button className="button button-secondary small-button">Helpful</button></MutationForm></div>}
  </SectionCard>
}
