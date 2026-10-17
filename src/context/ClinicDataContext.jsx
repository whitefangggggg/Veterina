/* oxlint-disable react/only-export-components */
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { ClinicDataContext } from './ClinicContext'
import { DemoClinicDataProvider } from './DemoClinicDataProvider'
import { useAuth } from './AuthContext'
import { loadClinic,mutate,unwrap } from '../lib/clinicRepository'
import { supabase } from '../lib/supabaseClient'
const empty={owners:[],pets:[],visits:[],vaccinations:[],appointments:[],reminders:[],inventory:[],suppliers:[],staff:[],allStaff:[],services:[],prescriptions:[],corrections:[],kbDocuments:[]}
function LiveClinicDataProvider({children}) {
  const {session}=useAuth()
  const userId=session?.user.id
  const [state,setState]=useState(empty)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const generation=useRef(0)
  const requestId=useRef(0)
  const refresh=useCallback(async()=>{
    if(!userId)return
    const version=generation.current
    const request=++requestId.current
    const next=await loadClinic(userId)
    if(version===generation.current&&request===requestId.current){setState(next);setError('');setLoading(false)}
  },[userId])
  useEffect(()=>{
    generation.current+=1;setState(empty);setError('');setLoading(Boolean(userId))
    if(!userId)return
    const version=generation.current
    const reload=()=>refresh().catch((e)=>{if(version===generation.current){setError(e.message);setLoading(false)}})
    reload()
    const onFocus=()=>{if(document.visibilityState==='visible')reload()}
    window.addEventListener('focus',reload);document.addEventListener('visibilitychange',onFocus)
    return ()=>{generation.current+=1;window.removeEventListener('focus',reload);document.removeEventListener('visibilitychange',onFocus)}
  },[userId,refresh])
  const write=async(action,data,key)=>{
    const result=await mutate(action,data,key)
    try{await refresh()}catch{setError('Saved to Supabase, but records could not be refreshed. Reload to synchronize.')}
    return result
  }
  const value={...state,loading,error,refresh,isDemo:false,
    getOwner:(id)=>state.owners.find((o)=>o.id===id),getPet:(id)=>state.pets.find((p)=>p.id===id),
    addOwner:(d,k)=>write('create_owner',d,k),addPet:(d,k)=>write('create_pet',d,k),addVisit:(d,k)=>write('create_encounter',d,k),
    addVaccination:(d,k)=>write('create_vaccination',d,k),addAppointment:(d,k)=>write('book_appointment',d,k),completeReminder:(id,outcome,k)=>write('complete_reminder',{id,outcome},k),
    adjustStock:(id,delta,reason,batchId,k)=>write('record_inventory_movement',{id,delta,reason,batchId},k),
    addSupplier:(d,k)=>write('create_supplier',d,k),addInventoryItem:(d,k)=>write('create_inventory_item',d,k),addPrescription:(d,k)=>write('create_prescription',d,k),
    addReminder:(d,k)=>write('create_custom_reminder',d,k),saveSettings:(d,k)=>write('save_settings',d,k),finalizeEncounter:(id,k)=>write('finalize_encounter',{id},k),
    correctEncounter:(d,k)=>write('correct_encounter',d,k),transitionAppointment:(id,status,k)=>write('transition_appointment',{id,status},k),
    manageKb:async(d)=>{const r=unwrap(await supabase.rpc('manage_kb',{p_data:d}));await refresh();return r},
  }
  return <ClinicDataContext.Provider value={value}>{children}</ClinicDataContext.Provider>
}
export function ClinicDataProvider({children}) {
  const {isDemo}=useAuth()
  return isDemo?<DemoClinicDataProvider>{children}</DemoClinicDataProvider>:<LiveClinicDataProvider>{children}</LiveClinicDataProvider>
}
export function useClinicData(){const context=useContext(ClinicDataContext);if(!context)throw new Error('useClinicData must be used inside ClinicDataProvider');return context}
