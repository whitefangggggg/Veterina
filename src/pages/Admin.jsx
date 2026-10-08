/* oxlint-disable react/only-export-components */
import { useState } from 'react'
import { DownloadSimple,ShieldCheck } from '@phosphor-icons/react'
import { PageHeader,SectionCard,Field } from '../components/ui'
import MutationForm from '../components/MutationForm'
import { useClinicData } from '../context/ClinicDataContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { unwrap } from '../lib/clinicRepository'
export async function invoke(name,body){
  const response=await supabase.functions.invoke(name,{body})
  if(response.error){let detail;try{detail=await response.error.context?.json?.()}catch{/* Network error has no body. */}throw new Error(detail?.error || response.error.message)}
  return response.data
}
const csvCell=(value)=>`"${String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')}"`
export function downloadReport(rows,name){
  const history=name==='history'
  const keys=Object.keys(rows[0]||{})
  const content=history?JSON.stringify(rows,null,2):[keys.map(csvCell).join(','),...rows.map((r)=>keys.map((k)=>csvCell(typeof r[k]==='object'?JSON.stringify(r[k]):r[k])).join(','))].join('\r\n')
  const url=URL.createObjectURL(new Blob([content],{type:history?'application/json':'text/csv;charset=utf-8'}))
  const link=document.createElement('a');link.href=url;link.download=`veterina-${name}.${history?'json':'csv'}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export function Reports(){
  const {profile,pets}=useClinicData(),{isDemo}=useAuth()
  const [patientId,setPatientId]=useState(pets[0]?.id||'')
  if(isDemo || profile?.role!=='owner')return <div className="page"><PageHeader title="Reports" description={isDemo?'Sign in to create audited clinic exports.':'Clinic owner access is required to export records.'}/></div>
  return <div className="page"><PageHeader title="Reports" description="Every export is authorized and recorded on the server."/>
    <Field label="Patient for complete clinical history"><select value={patientId} onChange={(e)=>setPatientId(e.target.value)}>{pets.map((p)=><option key={p.id} value={p.id}>{p.name} · {p.recordNumber}</option>)}</select></Field>
    <div className="report-grid">{[['patients','Patient register','CSV'],['vaccinations','Vaccinations due','CSV'],['history','Complete clinical history','JSON · print from patient record'],['inventory','Inventory status','CSV'],['reminders','Reminder outcomes','CSV']].map(([id,title,format])=><SectionCard key={id} title={title}><p>{format}</p><MutationForm onSubmit={async()=>{const{rows}=await invoke('export-report',{report:id,patient_id:id==='history'?patientId:null});downloadReport(rows,id)}}><button disabled={id==='history'&&!patientId} className="button button-secondary"><DownloadSimple size={17}/> Download report</button></MutationForm></SectionCard>)}</div>
    <p className="privacy-callout"><ShieldCheck size={20}/>Exports contain personal and clinical information.</p>
  </div>
}
function MfaSetup(){
  const [factor,setFactor]=useState(null),[code,setCode]=useState(''),[complete,setComplete]=useState(false)
  return <SectionCard title="Owner authenticator" description="Staff invitations and access changes require authenticator verification.">
    {complete?<p role="status">Authenticator verified. Staff administration is available.</p>:<>
      <MutationForm onSubmit={async()=>{
        const assurance=unwrap(await supabase.auth.mfa.getAuthenticatorAssuranceLevel())
        if(assurance.currentLevel==='aal2'){setComplete(true);return}
        const factors=unwrap(await supabase.auth.mfa.listFactors())
        const existing=factors.totp.find((f)=>f.status==='verified')
        if(existing){setFactor({id:existing.id});return}
        const enrolled=unwrap(await supabase.auth.mfa.enroll({factorType:'totp',friendlyName:`Veterina ${Date.now()}`}));setFactor(enrolled)
      }}><button className="button button-secondary">Set up or verify authenticator</button></MutationForm>
      {factor&&<MutationForm onSubmit={async()=>{unwrap(await supabase.auth.mfa.challengeAndVerify({factorId:factor.id,code}));setComplete(true)}}>
        {factor.totp&&<img alt="Authenticator QR code" src={factor.totp.qr_code}/>}
        <Field label="Six-digit code"><input required pattern="[0-9]{6}" inputMode="numeric" value={code} onChange={(e)=>setCode(e.target.value)}/></Field>
        <button className="button button-primary">Verify authenticator</button>
      </MutationForm>}
    </>}
  </SectionCard>
}
function StaffSettings(){
  const {allStaff,refresh}=useClinicData()
  const [form,setForm]=useState({email:'',full_name:'',role:'clinical_staff'})
  return <SectionCard title="Staff accounts" description="Only active staff can access clinic data; deactivation applies on the next request.">
    <MutationForm onSubmit={async()=>{await invoke('admin-staff',{action:'invite',...form});await refresh();setForm({email:'',full_name:'',role:'clinical_staff'})}}>
      <div className="form-grid"><Field label="Email"><input required type="email" value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})}/></Field><Field label="Full name"><input required value={form.full_name} onChange={(e)=>setForm({...form,full_name:e.target.value})}/></Field><Field label="Role"><select value={form.role} onChange={(e)=>setForm({...form,role:e.target.value})}><option value="clinical_staff">Clinical staff</option><option value="owner">Owner</option></select></Field></div><button className="button button-primary">Send staff invitation</button>
    </MutationForm>
    {allStaff.map((s)=><div key={s.id} className="staff-row"><strong>{s.full_name}</strong><span>{s.role} · {s.is_active?'Active':'Inactive'}</span><MutationForm onSubmit={async()=>{await invoke('admin-staff',{action:'update',id:s.id,role:s.role,is_active:!s.is_active});await refresh()}}><button className="button button-secondary small-button">{s.is_active?'Deactivate':'Reactivate'}</button></MutationForm></div>)}
  </SectionCard>
}
export function Settings(){
  const {profile,settings,saveSettings}=useClinicData(),{isDemo}=useAuth()
  const [saved,setSaved]=useState(false)
  const [form,setForm]=useState(()=>({clinicName:settings?.clinic_name||'',phone:settings?.phone||'',email:settings?.email||'',address:settings?.address||'',fullName:profile?.full_name||'',prcLicenseNumber:profile?.prc_license_number||'',ptrNumber:profile?.ptr_number||'',licenseExpiresOn:profile?.license_expires_on||'',retentionYears:settings?.record_retention_years||10,aiEnabled:settings?.ai_enabled||false}))
  if(isDemo || profile?.role!=='owner')return <div className="page"><PageHeader title="Clinic settings" description={isDemo?'Sign in as the owner to save clinic settings.':'Clinic owner access is required.'}/></div>
  return <div className="page"><PageHeader title="Clinic settings" description="Clinic identity, staff access, and assistant controls."/>
    <SectionCard title="Clinic profile"><MutationForm onSubmit={async(e)=>{await saveSettings(form,e.idempotencyKey);setSaved(true)}}><div className="form-grid">
      {[['clinicName','Clinic name'],['phone','Phone'],['email','Email'],['address','Address'],['fullName','Head veterinarian name'],['prcLicenseNumber','PRC license'],['ptrNumber','PTR number'],['licenseExpiresOn','License expiry'],['retentionYears','Retention years']].map(([key,label])=><Field key={key} label={label}><input required={['clinicName','fullName'].includes(key)} type={key==='email'?'email':key==='licenseExpiresOn'?'date':key==='retentionYears'?'number':'text'} min={1} max={50} value={form[key]} onChange={(e)=>{setSaved(false);setForm({...form,[key]:e.target.value})}}/></Field>)}
      <Field label="Enable record recall assistant"><input type="checkbox" checked={form.aiEnabled} onChange={(e)=>setForm({...form,aiEnabled:e.target.checked})}/></Field>
    </div><button className="button button-primary">Save settings</button>{saved&&<p role="status">Saved to Supabase.</p>}</MutationForm></SectionCard>
    <MfaSetup/><StaffSettings/>
  </div>
}
