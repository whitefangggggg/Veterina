import { describe,it,expect,vi } from 'vitest'
vi.mock('./supabaseClient',()=>({supabase:{rpc:vi.fn()}}))
import { mapClinicData,mutate,unwrap } from './clinicRepository'
import { supabase } from './supabaseClient'
describe('Supabase repository boundary',()=>{
  it('passes the retry key and payload unchanged to an RPC and rejects a database error',async()=>{
    supabase.rpc.mockResolvedValueOnce({data:{id:'saved'},error:null})
    expect(await mutate('create_encounter',{petId:'a'},'retry-key')).toEqual({id:'saved'})
    expect(supabase.rpc).toHaveBeenCalledWith('create_encounter',{p_data:{petId:'a'},p_key:'retry-key'})
    supabase.rpc.mockResolvedValueOnce({error:new Error('APPOINTMENT_CONFLICT')})
    await expect(mutate('book_appointment',{},'k')).rejects.toThrow('APPOINTMENT_CONFLICT')
  })
  it('joins vitals to their encounter and maps clinic timezone and derived reminder dates',()=>{
    const raw=Array.from({length:18},()=>[])
    raw[0]=[{id:'staff',full_name:'Doctor',is_active:true}]
    raw[2]=[{id:'owner',full_name:'Household'}]
    raw[3]=[{id:'pet',name:'Milo',owner_id:'owner',record_number:'VET-1',baseline_weight:'4'}]
    raw[4]=[{id:'visit',pet_id:'pet',visited_at:'2026-10-07T17:00:00Z',attending_veterinarian_id:'staff'}]
    raw[5]=[{visit_id:'visit',weight_kg:'5.20'}]
    raw[7]=[{id:'a',pet_id:'pet',starts_at:'2026-10-07T17:00:00Z',status:'confirmed'}]
    raw[8]=[{id:'r',pet_id:'pet',due_at:'2026-10-07T16:00:00Z',status:'upcoming',reminder_type:'follow_up'}]
    const result=mapClinicData(raw,'staff','2026-10-08')
    expect(result.pets[0].latestWeight).toBe(5.2)
    expect(result.owners[0].pets).toEqual(['pet'])
    expect(result.appointments[0]).toMatchObject({date:'2026-10-08',time:'01:00',status:'Confirmed'})
    expect(result.reminders[0]).toMatchObject({dueDate:'2026-10-08',status:'Due',type:'Follow-up'})
    expect(result.visits[0].veterinarian).toBe('Doctor')
  })
  it('preserves null expiry and derives stock by batch',()=>{
    const raw=Array.from({length:18},()=>[])
    raw[9]=[{id:'item',quantity_on_hand:'2.5',minimum_stock:'1',nearest_expiration:null}]
    raw[10]=[{id:'b',item_id:'item'}]
    raw[17]=[{batch_id:'b',quantity_delta:'3'},{batch_id:'b',quantity_delta:'-0.5'}]
    const item=mapClinicData(raw,'x').inventory[0]
    expect(item).toMatchObject({quantity:2.5,nearestExpiry:null,batches:[{id:'b',quantity:2.5}]})
  })
  it('never treats a failed read as an empty successful response',()=>{
    expect(()=>unwrap({data:[],error:new Error('permission denied')})).toThrow('permission denied')
  })
})
