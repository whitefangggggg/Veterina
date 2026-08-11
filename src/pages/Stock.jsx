import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ArrowLineDown,
  ArrowLineUp,
  Cube,
  EnvelopeSimple,
  MapPin,
  Package,
  Phone,
  Plus,
  MagnifyingGlass,
  Truck,
  Warning,
} from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import { Badge, Field, Modal, PageHeader, SectionCard, StatCard } from '../components/ui'

function AdjustmentModal({ item, onClose }) {
  const { adjustStock } = useClinicData()
  const [mode, setMode] = useState('Stock in')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const submit = (event) => {
    event.preventDefault()
    const delta = mode === 'Stock out' ? -Number(quantity) : Number(quantity)
    adjustStock(item.id, delta, reason || mode)
    onClose()
  }
  return (
    <Modal title={`Update ${item.name}`} description={`Current on-hand quantity: ${item.quantity} ${item.unit}s`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="segmented-control"><button type="button" className={mode === 'Stock in' ? 'active' : ''} onClick={() => setMode('Stock in')}><ArrowLineDown size={17} weight="bold" /> Stock in</button><button type="button" className={mode === 'Stock out' ? 'active' : ''} onClick={() => setMode('Stock out')}><ArrowLineUp size={17} weight="bold" /> Stock out</button></div>
        <div className="form-grid">
          <Field label={`Quantity (${item.unit}s)`} required><input autoFocus required type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field>
          <Field label="Reason" required><select required value={reason} onChange={(event) => setReason(event.target.value)}><option value="">Select reason</option><option>Supplier delivery</option><option>Dispensed to patient</option><option>Clinic use</option><option>Expired / damaged</option><option>Physical count correction</option></select></Field>
        </div>
        <div className="form-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary">Record movement</button></div>
      </form>
    </Modal>
  )
}

export function Inventory() {
  const { inventory, suppliers } = useClinicData()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [adjustItem, setAdjustItem] = useState(null)
  const lowStock = inventory.filter((item) => item.quantity <= item.minimumStock)
  const expiring = inventory.filter((item) => item.nearestExpiry <= '2026-10-29')
  const filtered = useMemo(() => inventory.filter((item) => {
    const normalized = query.toLowerCase()
    return (!normalized || item.name.toLowerCase().includes(normalized) || item.sku.toLowerCase().includes(normalized))
      && (category === 'All' || item.category === category)
  }), [inventory, query, category])

  return (
    <div className="page">
      <PageHeader eyebrow="Stock control" title="Inventory" description="Know what is available, expiring, or ready to reorder." actions={<button className="button button-primary"><Package size={18} weight="duotone" /> New item</button>} />
      <div className="stats-grid stock-stats">
        <StatCard icon={Cube} label="Inventory items" value={inventory.length} detail="Across all categories" />
        <StatCard icon={Warning} label="Below minimum" value={lowStock.length} detail="Reorder recommended" tone="rose" />
        <StatCard icon={Warning} label="Expiring in 90 days" value={expiring.length} detail="Review batches" tone="amber" />
        <StatCard icon={Truck} label="Active suppliers" value={suppliers.length} detail="Contacts on file" tone="blue" />
      </div>
      <div className="list-toolbar">
        <label className="table-search"><MagnifyingGlass size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search item name or SKU..." /></label>
        <div className="filter-pills">{['All', 'Vaccines', 'Medicine', 'Consumables'].map((value) => <button key={value} onClick={() => setCategory(value)} className={category === value ? 'active' : ''}>{value}</button>)}</div>
      </div>
      <div className="inventory-table section-card">
        <div className="table-head inventory-grid"><span>Item</span><span>Category</span><span>On hand</span><span>Nearest expiry</span><span>Supplier</span><span /></div>
        {filtered.map((item) => {
          const supplier = suppliers.find((entry) => entry.id === item.supplierId)
          const isLow = item.quantity <= item.minimumStock
          const isExpiring = item.nearestExpiry <= '2026-10-29'
          return (
            <div className="table-row inventory-grid" key={item.id}>
              <div className="cell-item"><strong>{item.name}</strong><code>{item.sku}</code></div>
              <div className="cell-category"><Badge>{item.category}</Badge></div>
              <div className="cell-qty"><span className="card-meta-label">On hand</span><strong className={isLow ? 'danger-text' : ''}>{item.quantity} {item.unit}{item.quantity !== 1 ? 's' : ''}</strong><small>Minimum {item.minimumStock}</small></div>
              <div className="cell-expiry"><span className="card-meta-label">Nearest expiry</span><strong>{format(parseISO(item.nearestExpiry), 'd MMM yyyy')}</strong>{isExpiring && <small className="warning-text">Expiring soon</small>}</div>
              <div className="cell-supplier"><span className="card-meta-label">Supplier</span><strong>{supplier?.name}</strong><small>{supplier?.phone}</small></div>
              <div className="cell-action"><button className="button button-secondary small-button" onClick={() => setAdjustItem(item)}>Update stock</button></div>
            </div>
          )
        })}
      </div>
      <div className="inventory-rule-note"><Warning size={18} weight="fill" /><span><strong>Movement-based stock:</strong> quantities change only through stock-in, stock-out, or adjustment records so discrepancies can be traced.</span></div>
      {adjustItem && <AdjustmentModal item={adjustItem} onClose={() => setAdjustItem(null)} />}
    </div>
  )
}

export function Suppliers() {
  const { suppliers, inventory } = useClinicData()
  const [query, setQuery] = useState('')
  const filtered = suppliers.filter((supplier) => supplier.name.toLowerCase().includes(query.toLowerCase()) || supplier.contactPerson.toLowerCase().includes(query.toLowerCase()))
  return (
    <div className="page">
      <PageHeader eyebrow="Purchasing contacts" title="Suppliers" description="Keep ordering details available when the clinic needs them." actions={<button className="button button-primary"><Plus size={18} weight="bold" /> Add supplier</button>} />
      <div className="list-toolbar"><label className="table-search"><MagnifyingGlass size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search suppliers or contacts..." /></label><span className="result-count">{filtered.length} suppliers</span></div>
      <div className="supplier-grid">
        {filtered.map((supplier) => {
          const suppliedItems = inventory.filter((item) => item.supplierId === supplier.id)
          return (
            <SectionCard key={supplier.id} className="supplier-card">
              <div className="supplier-heading"><div className="supplier-mark"><Truck size={22} weight="duotone" /></div><div><h2>{supplier.name}</h2><span>{supplier.contactPerson}</span></div><Badge tone="success">Active</Badge></div>
              <div className="supplier-contact">
                <a href={`tel:${supplier.phone.replace(/\s/g, '')}`}><Phone size={17} weight="duotone" /> {supplier.phone}</a>
                <a href={`mailto:${supplier.email}`}><EnvelopeSimple size={17} weight="duotone" /> {supplier.email}</a>
                <span><MapPin size={17} weight="duotone" /> {supplier.address}</span>
              </div>
              <p className="supplier-note">{supplier.notes}</p>
              <div className="supplier-footer"><span><strong>{suppliedItems.length}</strong> linked items</span><a className="button button-secondary small-button" href={`tel:${supplier.phone.replace(/\s/g, '')}`}><Phone size={16} weight="duotone" /> Call supplier</a></div>
            </SectionCard>
          )
        })}
      </div>
    </div>
  )
}
