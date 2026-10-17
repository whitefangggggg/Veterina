import { useState } from 'react'
import { useClinicData } from '../context/ClinicDataContext'
import { Field,Modal } from './ui'
import MutationForm from './MutationForm'
export default function StockCreateModal({kind,onClose}){
  const {suppliers,addSupplier,addInventoryItem}=useClinicData()
  const [form,setForm]=useState(kind==='supplier'?{name:'',contactPerson:'',phone:'',email:'',address:'',notes:''}:{sku:'',name:'',category:'Medicine',unit:'unit',minimumStock:0,supplierId:'',lotNumber:'',expirationDate:'',allowsFraction:false})
  const fields=kind==='supplier'?[['name','Supplier name',true],['contactPerson','Contact person'],['phone','Phone',true],['email','Email'],['address','Address'],['notes','Ordering notes']]:[['sku','SKU',true],['name','Item name',true],['category','Category',true],['unit','Unit',true],['minimumStock','Minimum stock',true],['lotNumber','Lot / batch'],['expirationDate','Expiry date']]
  return <Modal title={kind==='supplier'?'Add supplier':'New inventory item'} description={kind==='supplier'?'Save ordering contacts.':'Create an item and its first batch. Record stock-in after saving.'} onClose={onClose}><MutationForm onSubmit={async(e)=>{await (kind==='supplier'?addSupplier:addInventoryItem)(form,e.idempotencyKey);onClose()}}><div className="form-grid">
    {fields.map(([key,label,required])=><Field key={key} label={label} required={required}><input required={required} type={key==='email'?'email':key==='expirationDate'?'date':key==='minimumStock'?'number':'text'} min={0} value={form[key]} onChange={(e)=>setForm({...form,[key]:e.target.value})}/></Field>)}
    {kind!=='supplier'&&<><Field label="Supplier"><select value={form.supplierId} onChange={(e)=>setForm({...form,supplierId:e.target.value})}><option value="">None</option>{suppliers.map((s)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field><Field label="Allow fractional units"><input type="checkbox" checked={form.allowsFraction} onChange={(e)=>setForm({...form,allowsFraction:e.target.checked})}/></Field></>}
  </div><div className="form-actions"><button className="button button-primary">Save</button></div></MutationForm></Modal>
}
