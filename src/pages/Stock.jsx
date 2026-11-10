import { SelectField } from '../components/VeterinaSelect'
import VeterinaCheckbox from '../components/VeterinaCheckbox'
import { useLayoutEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { Cube, EnvelopeSimple, MagnifyingGlass, MapPin, Notepad, Package, Phone, Pill, Plus, Syringe, Truck, Warning } from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import { useAuth } from '../context/AuthContext'
import { Badge, EmptyState, Modal, PageHeader, SectionCard, StatCard } from '../components/ui'
import { AsyncForm, DeleteRecordDialog, RecordEditor } from '../components/RecordForm'
import { useHashTarget } from '../lib/useHashTarget'
import { STOCK_EXPIRY_WARNING_DAYS, stockAttention, stockExpiryAlerts } from '../lib/dailyWorkflow'
import './Admissions.css'
import './Inventory.css'

const inventoryIcons = { Vaccines: Syringe, Medicine: Pill, Consumables: Package, Other: Cube }

const supplierFields = [
  { name: 'name', label: 'Supplier name', required: true }, { name: 'contactPerson', label: 'Contact person' },
  { name: 'phone', label: 'Phone', type: 'tel', required: true }, { name: 'email', label: 'Email', type: 'email' },
  { name: 'address', label: 'Address', type: 'textarea', span: true }, { name: 'notes', label: 'Ordering notes', type: 'textarea', span: true },
]
const activeField = { name: 'isActive', label: 'Status', type: 'select', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Archived' }] }

function ItemEditor({ record, onClose }) {
  const { suppliers, execute } = useClinicData()
  const [category, setCategory] = useState(record?.category || 'Medicine')
  const [allowsFraction, setAllowsFraction] = useState(record?.allowsFraction || false)
  return <RecordEditor title={record ? 'Edit inventory item' : 'New inventory item'} initial={record || { category: 'Medicine', minimumStock: 0, unit: 'unit', allowsFraction: 'false', initialQuantity: 0 }} onClose={onClose}
    onSave={(values) => execute(record ? 'update_inventory_item' : 'create_inventory_item', { ...values, ...(record ? { id: record.id } : {}) })}
    fields={[
      { name: 'name', label: 'Item name', required: true }, { name: 'sku', label: 'SKU', disabled: true, placeholder: 'Generated on save', hint: record ? 'Assigned automatically.' : 'Assigned automatically when you save the item.' },
      { name: 'category', label: 'Category', type: 'select', options: ['Vaccines', 'Medicine', 'Consumables', 'Other'], onChange: (event) => setCategory(event.target.value) },
      { name: 'brand', label: 'Brand', required: category === 'Vaccines', hint: 'Used as the brand when this vaccine is selected for a patient.' },
      { name: 'unit', label: 'Unit', required: true }, { name: 'minimumStock', label: 'Minimum stock', type: 'number', min: '0', step: '0.01', required: true },
      { name: 'supplierId', label: 'Preferred supplier', type: 'select', options: [{ value: '', label: 'No preferred supplier' }, ...suppliers.filter((supplier) => supplier.isActive || supplier.id === record?.supplierId).map((supplier) => ({ value: supplier.id, label: supplier.name }))] },
      { name: 'notes', label: 'Notes', type: 'textarea', span: true, placeholder: 'Storage instructions, handling reminders or other item details' },
      ...(record ? [activeField] : [
        { name: 'allowsFraction', label: 'Allow fractional quantities', type: 'select', options: [{ value: 'false', label: 'Whole units only' }, { value: 'true', label: 'Fractional units allowed' }], onChange: (event) => setAllowsFraction(event.target.value === 'true') },
        { name: 'initialQuantity', label: 'Initial stock quantity', type: 'number', min: '0', max: '9999999999.99', step: allowsFraction ? '0.01' : '1', required: true, hint: allowsFraction ? 'Enter the stock you already have, including decimals such as 2.5. Use 0 to add stock later.' : 'Enter the whole units you already have. Use 0 to add stock later.' },
        { name: 'lotNumber', label: 'Initial batch / lot number' }, { name: 'expirationDate', label: 'Initial batch expiry', type: 'date' },
      ]),
    ]} />
}

function BatchEditor({ item, record, onClose }) {
  const { suppliers, execute } = useClinicData()
  return <RecordEditor title={record ? 'Edit batch' : 'Add inventory batch'} onClose={onClose} initial={record ? { supplierId: record.supplier_id, lotNumber: record.lot_number, expirationDate: record.expiration_date, unitCost: record.unit_cost, isActive: record.is_active } : { supplierId: item.supplierId }}
    onSave={(values) => execute(record ? 'update_batch' : 'create_batch', { ...values, itemId: item.id, ...(record ? { id: record.id } : {}) })}
    fields={[
      { name: 'lotNumber', label: 'Batch / lot number' }, { name: 'expirationDate', label: 'Expiry date', type: 'date' },
      { name: 'supplierId', label: 'Supplier', type: 'select', options: [{ value: '', label: 'No supplier' }, ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))] },
      { name: 'unitCost', label: 'Unit cost', type: 'number', min: '0', step: '0.01' },
      ...(record ? [activeField] : []),
    ]} />
}

function StockMovementEditor({ item, onClose }) {
  const { execute } = useClinicData()
  const { profile } = useAuth()
  const [mode, setMode] = useState('Stock in')
  return <Modal title={'Update ' + item.name} description={'Current on-hand quantity: ' + item.quantity + ' ' + item.unit} onClose={onClose}>
    <div className="segmented-control">{['Stock in', 'Stock out', ...(profile.role === 'owner' ? ['Physical count'] : [])].map((value) => <button key={value} type="button" className={value === mode ? 'active' : ''} onClick={() => setMode(value)}>{value}</button>)}</div>
    <AsyncForm key={mode} onClose={onClose} submitLabel="Record movement" onSave={(values) => mode === 'Physical count'
      ? execute('record_count_adjustment', { id: item.id, batchId: values.batchId, observedQuantity: values.quantity, reason: values.reason })
      : execute('record_inventory_movement', { id: item.id, batchId: values.batchId, delta: (mode === 'Stock out' ? -1 : 1) * Number(values.quantity), reason: values.reason })}>
      <div className="form-grid">
        <label className="field"><span>Batch *</span><SelectField name="batchId" required defaultValue={item.batches.find((batch) => batch.is_active)?.id || ''}>{item.batches.filter((batch) => batch.is_active).map((batch) => <option key={batch.id} value={batch.id}>{batch.lot_number || 'Unnumbered batch'} · {batch.quantity} available · {batch.expiration_date || 'No expiry'}</option>)}</SelectField></label>
        <label className="field"><span>{mode === 'Physical count' ? 'Observed batch quantity' : 'Quantity'} *</span><input name="quantity" type="number" min={mode === 'Physical count' ? '0' : item.allowsFraction ? '0.01' : '1'} step={item.allowsFraction ? '0.01' : '1'} required /></label>
        <label className="field field-span"><span>Reason *</span>{mode === 'Physical count' ? <input name="reason" required placeholder="Why the counted quantity differs" /> : <SelectField name="reason" required defaultValue=""><option value="">Select reason</option>{(mode === 'Stock in' ? ['Supplier delivery', 'Returned to stock'] : ['Dispensed to patient', 'Clinic use', 'Expired / damaged']).map((reason) => <option key={reason}>{reason}</option>)}</SelectField>}</label>
      </div>
    </AsyncForm>
  </Modal>
}

export function Inventory() {
  const targetId = useHashTarget()
  const { key: locationKey } = useLocation()
  const { inventory, suppliers, today } = useClinicData()
  const [searchParams, setSearchParams] = useSearchParams()
  const attention = ['all', 'low', 'expiry', 'expired', 'expiring'].includes(searchParams.get('attention')) ? searchParams.get('attention') : ''
  const stockAlerts = stockAttention(inventory, today)
  const stockAlertsById = new Map(stockAlerts.map((entry) => [entry.item.id, entry]))
  const expiryAlerts = stockExpiryAlerts(inventory, today)
  const batchAlertsById = new Map(expiryAlerts.map((entry) => [entry.batch.id, entry]))
  const attentionIds = new Set(stockAlerts.filter((entry) => attention === 'low' ? entry.lowStock : attention === 'expiry' ? entry.expired.length || entry.expiring.length : attention === 'expired' ? entry.expired.length : attention === 'expiring' ? entry.expiring.length : true).map((entry) => entry.item.id))
  const supplierId = searchParams.get('supplierId')
  const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId)
  const invalidSupplier = supplierId !== null && !selectedSupplier
  const clearSupplier = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('supplierId')
    setSearchParams(next)
  }
  const { profile } = useAuth()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [showArchived, setShowArchived] = useState(false)
  useLayoutEffect(() => {
    if (!targetId.startsWith('inventory-batch-')) return
    setQuery(''); setCategory('All')
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(targetId)
      const details = target?.closest('details')
      if (details) details.open = true
      if (target) {
        target.setAttribute('tabindex', '-1')
        target.focus({ preventScroll: true })
        target.scrollIntoView({ block: 'start' })
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [targetId, locationKey])
  const hasFilters = Boolean(query || category !== 'All' || showArchived || attention || supplierId !== null)
  const resetFilters = () => {
    setQuery(''); setCategory('All'); setShowArchived(false)
    const next = new URLSearchParams(searchParams)
    next.delete('supplierId'); next.delete('attention')
    setSearchParams(next)
  }
  const [modal, setModal] = useState(null)
  const active = inventory.filter((item) => item.isActive)
  const lowStock = active.filter((item) => item.quantity <= item.minimumStock)
  const expiring = stockAlerts.filter((entry) => entry.expiring.length)
  const expired = stockAlerts.filter((entry) => entry.expired.length)
  const filtered = inventory.filter((item) => (!attention || attentionIds.has(item.id)) && (!supplierId || item.supplierIds.includes(supplierId)) && !invalidSupplier && (showArchived || item.isActive) && (category === 'All' || item.category === category) && [item.name, item.sku].some((value) => value.toLowerCase().includes(query.toLowerCase())))
  const selectedItem = modal?.itemId ? inventory.find((item) => item.id === modal.itemId) : null
  return <div className="page inventory-page">
    <PageHeader eyebrow="Stock control" title="Inventory" description="Live balances, batches and permanent movement history." actions={<button className="button button-primary" onClick={() => setModal({ type: 'item' })}><Package size={18} /> New item</button>} />
    {supplierId !== null && <p className={invalidSupplier ? 'auth-message auth-error' : 'auth-message'} role={invalidSupplier ? 'alert' : 'status'}>{invalidSupplier ? 'This supplier is unavailable.' : <>Items linked to <Link className="text-link" to={`/suppliers#${encodeURIComponent(supplierId)}`}>{selectedSupplier.name}</Link>.</>} <button className="text-link" onClick={clearSupplier}>Clear supplier filter</button></p>}
    <div className="stats-grid stock-stats"><StatCard icon={Cube} label="Active items" value={active.length} /><StatCard icon={Warning} label="At or below minimum" value={lowStock.length} tone="rose" /><StatCard icon={Warning} label={`Expiring in ${STOCK_EXPIRY_WARNING_DAYS} days`} value={expiring.length} detail={expired.length + ' items have expired stock'} tone="amber" /><StatCard icon={Truck} label="Active suppliers" value={suppliers.filter((supplier) => supplier.isActive).length} /></div>
    <div className="inventory-toolbar">
      <label className="field inventory-search-field"><span>Search inventory</span><span className="admission-search"><MagnifyingGlass size={18} aria-hidden="true" /><input aria-label="Search inventory" placeholder="Search item or SKU..." value={query} onChange={(event) => setQuery(event.target.value)} /></span></label>
      <label className="field"><span>Category</span><SelectField aria-label="Inventory category" value={category} onChange={(event) => setCategory(event.target.value)}>{['All', 'Vaccines', 'Medicine', 'Consumables', 'Other'].map((value) => <option key={value}>{value}</option>)}</SelectField></label>
      <label className="field"><span>Stock attention</span><SelectField aria-label="Stock attention" value={attention} onChange={(event) => { const next = new URLSearchParams(searchParams); if (event.target.value) next.set('attention', event.target.value); else next.delete('attention'); setSearchParams(next) }}><option value="">All items</option><option value="all">Needs attention</option><option value="low">At or below minimum</option><option value="expiry">Expiry warnings</option><option value="expired">Expired stock</option><option value="expiring">Expiring within {STOCK_EXPIRY_WARNING_DAYS} days</option></SelectField></label>
      <div className="inventory-filter-footer"><VeterinaCheckbox label="Include archived" checked={showArchived} onChange={setShowArchived} />
        {hasFilters && <button className="button button-secondary small-button" onClick={resetFilters}>Clear filters</button>}
        <span className="result-count" role="status">{filtered.length} item{filtered.length === 1 ? '' : 's'}</span>
      </div>
    </div>
    <div className="admission-grid inventory-card-grid">{filtered.map((item) => {
      const alert = stockAlertsById.get(item.id)
      const Icon = inventoryIcons[item.category] || Cube
      const stockLabel = item.quantity <= 0 ? 'Out of stock' : item.quantity <= item.minimumStock ? 'Low stock' : 'In stock'
      return <article key={item.id} id={`inventory-${item.id}`} className={`admission-card admission-patient-card inventory-record ${!item.isActive ? 'inventory-card-archived' : ''}`} aria-labelledby={`inventory-title-${item.id}`}>
      <div className="admission-badges"><Badge>{item.category}</Badge><Badge tone={item.quantity <= 0 ? 'danger' : item.quantity <= item.minimumStock ? 'warning' : 'success'}>{stockLabel}</Badge>{!item.isActive && <Badge>Archived</Badge>}</div>
      <div className="inventory-card-heading"><span className="inventory-item-icon"><Icon size={25} weight="duotone" aria-hidden="true" /></span><div><h2 id={`inventory-title-${item.id}`}>{item.name}</h2><code>{item.sku}</code></div></div>
      <div className="inventory-stock-level"><span>On hand</span><p><strong className={item.quantity <= item.minimumStock ? 'danger-text' : ''}>{item.quantity}</strong> {item.unit}</p><small>Minimum {item.minimumStock} {item.unit}</small></div>
      <dl className="inventory-card-meta">
        {item.brand && <><dt>Brand</dt><dd>{item.brand}</dd></>}
        <dt>Nearest expiry</dt><dd>{item.nearestExpiry ? format(parseISO(item.nearestExpiry), 'd MMM yyyy') : 'No stocked expiry-dated batches'}<div className="admission-badges inventory-expiry-badges">{alert?.expired.length > 0 && <Badge tone="danger">Expired stock</Badge>}{alert?.expiring.length > 0 && <Badge tone="warning">Expiring soon ({alert.expiring.length})</Badge>}</div></dd>
        <dt>Suppliers</dt><dd className="inventory-supplier-links">{item.supplierIds.length ? item.supplierIds.map((id) => {
          const supplier = suppliers.find((entry) => entry.id === id)
          return supplier ? <Link className="text-link" key={id} to={`/suppliers#${encodeURIComponent(id)}`}>{supplier.name}{id === item.supplierId ? ' (preferred)' : ''}</Link> : null
        }) : 'No preferred supplier'}</dd>
      </dl>
      {item.notes && <p className="inventory-item-notes"><strong>Notes:</strong> {item.notes}</p>}
      <div className="admission-card-footer inventory-card-actions">
        <button className="button button-primary small-button inventory-stock-action" disabled={!item.isActive || !item.batches.some((batch) => batch.is_active)} onClick={() => setModal({ type: 'movement', itemId: item.id })}>Update stock</button>
        <button className="button button-secondary small-button" onClick={() => setModal({ type: 'item', itemId: item.id })}>Edit item</button>
        <button className="button button-secondary small-button" onClick={() => setModal({ type: 'batch', itemId: item.id })}>Add batch</button>
        {profile.role === 'owner' && !item.movements.length && <button className="text-link danger-text inventory-delete-action" onClick={() => setModal({ type: 'delete-item', record: item })}>Delete item</button>}
      </div>
      <details className="ledger-details"><summary>Batches ({item.batches.length}) and movement history ({item.movements.length})</summary>
        {item.batches.map((batch) => <div className="ledger-row" key={batch.id} id={`inventory-batch-${batch.id}`}><span><strong>{batch.lot_number || 'Unnumbered batch'}</strong> · {batch.quantity} {item.unit} · Expires {batch.expiration_date || 'not set'} {batchAlertsById.has(batch.id) && <Badge tone={batchAlertsById.get(batch.id).status === 'expired' ? 'danger' : 'warning'}>{batchAlertsById.get(batch.id).label}</Badge>} {!batch.is_active && <Badge>Archived</Badge>}</span><button className="text-link" onClick={() => setModal({ type: 'batch', itemId: item.id, record: batch })}>Edit batch</button>{profile.role === 'owner' && !item.movements.some((movement) => movement.batch_id === batch.id) && <button className="text-link danger-text" onClick={() => setModal({ type: 'delete-batch', record: batch })}>Delete batch</button>}</div>)}
        {item.movements.map((movement) => <p className="ledger-row" key={movement.id}>{format(parseISO(movement.created_at), 'd MMM yyyy, h:mm a')} · {movement.movement_type.replaceAll('_', ' ')} · {movement.quantity_delta > 0 ? '+' : ''}{movement.quantity_delta} {item.unit} · {movement.reason}</p>)}
        {!item.movements.length && <p>No stock movements yet. Record stock in after creating the item.</p>}
      </details>
    </article>})}</div>
    {!filtered.length && <EmptyState icon={Package} title="No inventory items" description="Create an item with its initial stock, or add stock later." />}
    <p className="inventory-rule-note">Stock balances come from the movement ledger. Items with stock history can be archived; their ledger is retained.</p>
    {modal?.type === 'item' && <ItemEditor record={selectedItem} onClose={() => setModal(null)} />}
    {modal?.type === 'batch' && <BatchEditor item={selectedItem} record={modal.record} onClose={() => setModal(null)} />}
    {modal?.type === 'movement' && <StockMovementEditor item={selectedItem} onClose={() => setModal(null)} />}
    {modal?.type === 'delete-item' && <DeleteRecordDialog entity="inventory_item" record={modal.record} onClose={() => setModal(null)} />}
    {modal?.type === 'delete-batch' && <DeleteRecordDialog entity="batch" record={modal.record} onClose={() => setModal(null)} />}
  </div>
}

export function Suppliers() {
  useHashTarget()
  const { suppliers, inventory, execute } = useClinicData()
  const { profile } = useAuth()
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState(null)
  const filtered = suppliers.filter((supplier) => [supplier.name, supplier.contactPerson].some((value) => value.toLowerCase().includes(query.toLowerCase())))
  return <div className="page">
    <PageHeader eyebrow="Purchasing contacts" title="Suppliers" description="Ordering contacts and linked inventory items, saved to your clinic database."
      actions={<button className="button button-primary" onClick={() => setModal({ type: 'edit' })}><Plus size={18} /> Add supplier</button>} />
    <div className="list-toolbar"><label className="table-search"><MagnifyingGlass size={18} /><input aria-label="Search suppliers" placeholder="Search suppliers or contacts..." value={query} onChange={(event) => setQuery(event.target.value)} /></label><span>{filtered.length} suppliers</span></div>
    <div className="supplier-grid">{filtered.map((supplier) => {
      const linkedItems = inventory.filter((item) => item.supplierIds.includes(supplier.id))
      return <SectionCard key={supplier.id} id={supplier.id} className="supplier-executive-card">
        <div className="supplier-top"><div className="supplier-avatar"><Truck size={24} weight="duotone" /></div><div className="supplier-identity"><h2>{supplier.name}</h2><span>{supplier.contactPerson || 'General contact'}</span></div><Badge tone={supplier.isActive ? 'success' : 'neutral'}>{supplier.isActive ? 'Active' : 'Archived'}</Badge></div>
        <div className="supplier-quick-actions">
          {supplier.phone && <a className="action-pill" href={`tel:${supplier.phone.replace(/[^+\d]/g, '')}`}><Phone size={14} weight="bold" />{supplier.phone}</a>}
          {supplier.email && <a className="action-pill" href={`mailto:${supplier.email}`} aria-label={`Email ${supplier.name}`}><EnvelopeSimple size={14} />Email</a>}
          {supplier.address && <span className="supplier-address"><MapPin size={15} />{supplier.address}</span>}
        </div>
        {supplier.notes && <div className="supplier-notes-box"><Notepad size={17} /><p>{supplier.notes}</p></div>}
        <div className="supplier-inventory-preview"><div className="preview-label"><span>Linked supplies</span><Link className="text-link" to={`/inventory?supplierId=${encodeURIComponent(supplier.id)}`}>{linkedItems.length} linked items</Link></div><div className="preview-chips">
          {linkedItems.slice(0, 3).map((item) => <Link className="item-chip" key={item.id} to={`/inventory?supplierId=${encodeURIComponent(supplier.id)}#inventory-${encodeURIComponent(item.id)}`}>{item.name}<span className={item.isActive && item.quantity <= item.minimumStock ? 'danger-text' : ''}>{item.quantity} {item.unit}{!item.isActive && ' ? Archived'}</span></Link>)}
          {linkedItems.length > 3 && <Link className="item-chip more-chip" to={`/inventory?supplierId=${encodeURIComponent(supplier.id)}`}>+{linkedItems.length - 3} more</Link>}
          {!linkedItems.length && <span className="no-items">No items linked yet</span>}
        </div></div>
        <div className="supplier-card-footer"><Link className="button button-secondary small-button" to={`/inventory?supplierId=${encodeURIComponent(supplier.id)}`}>Manage inventory</Link><button className="button button-secondary small-button" onClick={() => setModal({ type: 'edit', record: supplier })}>Edit supplier</button>{profile.role === 'owner' && <button className="text-link danger-text" onClick={() => setModal({ type: 'delete', record: supplier })}>Delete supplier</button>}</div>
      </SectionCard>
    })}</div>
    {!filtered.length && <EmptyState icon={Truck} title="No matching suppliers" description="Add a supplier to keep ordering contacts on file." />}
    {modal?.type === 'edit' && <RecordEditor title={modal.record ? 'Edit supplier' : 'Add supplier'} fields={[...supplierFields, ...(modal.record ? [activeField] : [])]} initial={modal.record} onClose={() => setModal(null)}
      onSave={(values) => execute(modal.record ? 'update_supplier' : 'create_supplier', { ...values, ...(modal.record ? { id: modal.record.id } : {}) })} submitLabel="Save supplier" />}
    {modal?.type === 'delete' && <DeleteRecordDialog entity="supplier" record={modal.record} onClose={() => setModal(null)} />}
  </div>
}
