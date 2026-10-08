import { useState } from 'react'
import { useClinicData } from '../context/ClinicDataContext'
import { Field,Modal } from './ui'
import MutationForm from './MutationForm'
export default function ClinicalActionModal({kind,petId,visitId,onClose}){
  const {visits,addPrescription,correctEncounter}=useClinicData()
  const candidates=visits.filter((v)=>v.petId===petId&&!v.finalized_at)
  const [form,setForm]=useState(kind==='prescription'?{visitId:candidates[0]?.id || '',medicationName:'',dose:'',frequency:'',instructions:''}:{id:visitId,reason:'',correction:''})
  return <Modal title={kind==='prescription'?'Record prescription':'Append clinical correction'} onClose={onClose}><MutationForm onSubmit={async(e)=>{await(kind==='prescription'?addPrescription:correctEncounter)(form,e.idempotencyKey);onClose()}}>
    {kind==='prescription'&&<Field label="Open encounter"><select required value={form.visitId} onChange={(e)=>setForm({...form,visitId:e.target.value})}>{candidates.map((v)=><option key={v.id} value={v.id}>{v.type} · {v.visitedAt.slice(0,10)}</option>)}</select></Field>}
    {(kind==='prescription'?[['medicationName','Medication'],['dose','Documented dose'],['frequency','Frequency'],['instructions','Instructions']]:[['reason','Reason for correction'],['correction','Correction']]).map(([key,label])=><Field key={key} label={label}><textarea required={key!=='instructions'} value={form[key]} onChange={(e)=>setForm({...form,[key]:e.target.value})}/></Field>)}
    <button disabled={kind==='prescription'&&!form.visitId} className="button button-primary">Save to record</button>
  </MutationForm></Modal>
}
