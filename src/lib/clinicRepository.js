import { supabase } from './supabaseClient'
import { classifyReminder } from '../utils/clinicRules'
export const clinicToday = () => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date())
export function unwrap({ data, error }) { if (error) throw error; return data }
export const mutate = async (action, data, key = crypto.randomUUID()) => unwrap(await supabase.rpc(action, { p_data:data,p_key:key }))
async function rows(table) {
  const result = []
  for (let offset=0; ; offset+=1000) {
    const batch=unwrap(await supabase.from(table).select('*').order('id').range(offset,offset+999))
    result.push(...batch)
    if(batch.length<1000) return result
  }
}
const title = (value='') => value.replaceAll('_',' ').replace(/\b\w/g,(s)=>s.toUpperCase())
const clinicDate = (value) => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value))
export function mapClinicData(raw,userId,today=clinicToday()) {
  const [profiles,settings,owners,pets,visits,vitals,vaccinations,appointments,reminders,inventory,batches,suppliers,services,alerts,prescriptions,corrections,kbDocuments,movements]=raw
  const staffName=(id)=>profiles.find((s)=>s.id===id)?.full_name || 'Clinical staff'
  return {
    profile:profiles.find((s)=>s.id===userId),staff:profiles.filter((s)=>s.is_active),allStaff:profiles,settings:settings[0],services,
    owners:owners.map((o)=>({...o,fullName:o.full_name,emergencyContact:o.emergency_contact,pets:pets.filter((p)=>p.owner_id===o.id).map((p)=>p.id)})),
    pets:pets.map((p)=>{
      const latest=visits.filter((v)=>v.pet_id===p.id && vitals.some((vt)=>vt.visit_id===v.id && vt.weight_kg!=null)).sort((a,b)=>b.visited_at.localeCompare(a.visited_at))[0]
      return {...p,ownerId:p.owner_id,recordNumber:p.record_number,reproductiveStatus:p.reproductive_status,birthDate:p.birth_date,color:p.color_markings,microchip:p.microchip_number,photoColor:'#7aa899',
        allergies:alerts.filter((a)=>a.pet_id===p.id && a.is_active && a.alert_type==='allergy').map((a)=>a.description),
        alerts:alerts.filter((a)=>a.pet_id===p.id && a.is_active && a.alert_type!=='allergy').map((a)=>a.description),
        latestWeight:Number(vitals.find((vt)=>vt.visit_id===latest?.id)?.weight_kg || p.baseline_weight) || null}
    }),
    visits:visits.map((v)=>{const vt=vitals.find((x)=>x.visit_id===v.id)||{};return {...v,petId:v.pet_id,type:v.visit_type,complaint:v.chief_complaint,diagnosis:v.diagnosis_summary,visitedAt:v.visited_at,
      followUpDate:v.follow_up_date,veterinarian:staffName(v.attending_veterinarian_id),weightKg:vt.weight_kg==null?null:Number(vt.weight_kg),temperatureC:vt.temperature_c,heartRate:vt.heart_rate_bpm,respiratoryRate:vt.respiratory_rate_rpm,bodyConditionScore:vt.body_condition_score}}),
    vaccinations:vaccinations.map((v)=>({...v,petId:v.pet_id,vaccine:v.vaccine_name,administeredAt:v.administered_at,nextDueAt:v.next_due_at,lotNumber:v.lot_number,veterinarian:staffName(v.administered_by)})),
    appointments:appointments.map((a)=>({...a,petId:a.pet_id,date:clinicDate(a.starts_at),time:new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(a.starts_at)),
      service:services.find((s)=>s.id===a.service_type_id)?.name || 'Visit',status:title(a.status),veterinarian:staffName(a.veterinarian_id)})),
    reminders:reminders.map((r)=>{const dueDate=clinicDate(r.due_at);return {...r,petId:r.pet_id,dueDate,type:r.reminder_type==='follow_up'?'Follow-up':title(r.reminder_type),priority:title(r.priority),
      status:['completed','cancelled','snoozed'].includes(r.status)?title(r.status):classifyReminder(dueDate,today),assignedTo:staffName(r.assigned_to)}}),
    inventory:inventory.map((i)=>({...i,quantity:Number(i.quantity_on_hand),minimumStock:Number(i.minimum_stock),nearestExpiry:i.nearest_expiration,supplierId:batches.find((b)=>b.item_id===i.id)?.supplier_id,
      batches:batches.filter((b)=>b.item_id===i.id).map((b)=>({...b,quantity:movements.filter((m)=>m.batch_id===b.id).reduce((sum,m)=>sum+Number(m.quantity_delta),0)}))})),
    suppliers:suppliers.map((s)=>({...s,contactPerson:s.contact_person||'',notes:s.ordering_notes})),prescriptions,corrections,kbDocuments,
  }
}
export async function loadClinic(userId) {
  const tables=['profiles','clinic_settings','owners','pets','visits','visit_vitals','vaccinations','appointments','reminders','inventory_on_hand','inventory_batches','suppliers','service_types','pet_alerts','prescriptions','visit_corrections','kb_documents','inventory_movements']
  return mapClinicData(await Promise.all(tables.map(rows)),userId)
}
export async function exportReport(report,patientId) {
  return unwrap(await supabase.rpc('export_report',{p_report:report,p_patient_id:patientId||null}))
}
