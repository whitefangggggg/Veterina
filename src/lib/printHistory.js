import { exportReport } from './clinicRepository'
const escape=(v)=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
export async function printHistory(patientId,staff){
  const [history]=await exportReport('history',patientId)
  const name=(id)=>staff.find((s)=>s.id===id)?.full_name || 'Clinic staff'
  const p=history.patient
  const content=`<h1>${escape(p.name)} · Clinical history</h1><p>${escape(p.record_number)} · ${escape(p.species)} · ${escape(p.breed)}</p>`+
    history.visits.sort((a,b)=>a.visited_at.localeCompare(b.visited_at)).map((v)=>{
      const vitals=history.vitals.find((vt)=>vt.visit_id===v.id)
      return `<section><h2>${escape(v.visit_type)} · ${escape(v.visited_at.slice(0,10))}</h2><p>Veterinarian: ${escape(name(v.attending_veterinarian_id))}</p><p>Complaint: ${escape(v.chief_complaint)}</p>`+
        (vitals?`<p>Weight: ${escape(vitals.weight_kg)} kg · Temperature: ${escape(vitals.temperature_c)} °C · Heart rate: ${escape(vitals.heart_rate_bpm)} · Respiratory rate: ${escape(vitals.respiratory_rate_rpm)} · Body condition: ${escape(vitals.body_condition_score)}</p>`:'')+
        ['subjective','objective','assessment','plan','diagnosis_summary'].map((k)=>`<h3>${escape(k.replaceAll('_',' '))}</h3><p>${escape(v[k])}</p>`).join('')+
        history.prescriptions.filter((pr)=>pr.visit_id===v.id).map((pr)=>`<p>Prescription: ${escape(pr.medication_name)} · ${escape(pr.dose)} · ${escape(pr.frequency)} · ${escape(pr.instructions)}</p>`).join('')+
        history.corrections.filter((c)=>c.visit_id===v.id).map((c)=>`<p>Correction (${escape(c.created_at)}): ${escape(c.reason)} — ${escape(c.correction)}</p>`).join('')+'</section>'
    }).join('')+'<h2>Vaccinations</h2>'+history.vaccinations.map((v)=>`<p>${escape(v.vaccine_name)} · Given ${escape(v.administered_at)} · Due ${escape(v.next_due_at)} · Lot ${escape(v.lot_number)} · ${escape(v.dose)}</p>`).join('')
  const frame=document.createElement('iframe');frame.style.position='fixed';frame.style.width='0';frame.style.height='0';frame.style.border='0';frame.title='Printable clinical history'
  frame.srcdoc=`<!doctype html><html><head><title>Veterina clinical history</title><style>body{font:14px Arial;margin:32px;color:#222}h1{font-size:24px}h2{font-size:18px}h3{font-size:14px}p{white-space:pre-wrap}section{border-top:1px solid #aaa;margin-top:24px}h2,h3{break-after:avoid}</style></head><body>${content}</body></html>`
  frame.onload=()=>{frame.contentWindow.addEventListener('afterprint',()=>frame.remove(),{once:true});frame.contentWindow.print()}
  document.body.append(frame)
}
