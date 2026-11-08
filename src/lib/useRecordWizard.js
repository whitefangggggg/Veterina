import { useContext, useEffect, useRef, useState } from 'react'
import { RecordFlowContext } from '../context/RecordFlowContext'

export function useRecordWizard(steps, formRef, setError) {
  const flow = useContext(RecordFlowContext)
  const [selected, setSelected] = useState(steps?.[0]?.id)
  const [visited, setVisited] = useState(() => steps?.length ? [steps[0].id] : [])
  const [review, setReview] = useState([])
  const previousIds = useRef(steps?.map((step) => step.id) || [])
  const pendingInvalid = useRef(null)
  const signature = (steps || []).map((step) => step.id).join('|')
  const index = selected === 'review' ? steps?.length : Math.max(0, steps?.findIndex((step) => step.id === selected) ?? 0)
  const active = flow?.active !== false
  const enabled = Boolean(steps)
  const currentStepId = steps?.[index]?.id || 'review'
  const choose = (id) => { setSelected(id); setVisited((current) => current.includes(id) ? current : [...current, id]); setError('') }
  useEffect(() => {
    const ids = signature ? signature.split('|') : []
    const oldIds = previousIds.current
    const added = ids.length > oldIds.length ? ids.find((id) => !oldIds.includes(id)) : null
    previousIds.current = ids
    if (added) { setSelected(added); setVisited((current) => [...current, added]) }
    else if (selected !== 'review' && !ids.includes(selected)) setSelected(ids[Math.max(0, Math.min(oldIds.indexOf(selected) - 1, ids.length - 1))])
  }, [signature, selected])
  useEffect(() => {
    if (!enabled || !active) return
    const panel = formRef.current?.querySelector('[data-record-step]:not([hidden])')
    formRef.current?.closest('.modal-body')?.scrollTo({ top: 0 })
    if (pendingInvalid.current) { pendingInvalid.current.focus(); pendingInvalid.current.reportValidity(); pendingInvalid.current = null }
    else panel?.querySelector('[data-step-heading]')?.focus({ preventScroll: true })
  }, [currentStepId, active, formRef, enabled])

  const validate = (stepIndex) => {
    const panel = formRef.current?.querySelectorAll('[data-record-step]')[stepIndex]
    const locked = [...(panel?.querySelectorAll('fieldset[data-readonly-section]:disabled') || [])]
    locked.forEach((section) => { section.disabled = false })
    const invalid = [...(panel?.querySelectorAll('input,select,textarea') || [])].find((control) => !control.checkValidity())
    const lockedSection = invalid?.closest('[data-readonly-section]')
    locked.forEach((section) => { section.disabled = true })
    if (!invalid) return true
    choose(steps[stepIndex].id)
    if (lockedSection && locked.includes(lockedSection)) setError(`Check the required fields in ${lockedSection.dataset.readonlySection}. Click Edit to update this section.`)
    else {
      setError('Complete the required fields in this step before continuing.')
      if (index === stepIndex) { invalid.focus(); invalid.reportValidity() }
      else pendingInvalid.current = invalid
    }
    return false
  }
  const collect = () => setReview(steps.map((step, stepIndex) => {
    const panel = formRef.current?.querySelectorAll('[data-record-step]')[stepIndex]
    const fields = [...(panel?.querySelectorAll('input,select,textarea') || [])].filter((control) => {
      if (control.type === 'hidden' || !control.value || ['radio', 'checkbox'].includes(control.type) && !control.checked) return false
      let parent = control.parentElement
      while (parent && parent !== panel) { if (parent.hidden) return false; parent = parent.parentElement }
      return true
    }).map((control) => ({ label: control.getAttribute('aria-label') || control.labels?.[0]?.querySelector('span')?.textContent || control.labels?.[0]?.textContent || control.name || 'Detail',
      value: control.tagName === 'SELECT' ? control.selectedOptions[0]?.textContent : control.type === 'checkbox' ? 'Yes' : control.value }))
    return { id: step.id, label: step.label, fields }
  }))
  const go = (target) => {
    if (target > index) for (let step = 0; step < target; step++) if (!validate(step)) return false
    if (target === steps.length) collect()
    choose(target === steps.length ? 'review' : steps[target].id)
    return true
  }
  const prefix = flow?.prefixSteps || []
  return { index, review, validateAll: () => steps.every((_, stepIndex) => validate(stepIndex)), next: () => go(index + 1),
    back: () => index ? go(index - 1) : flow?.onNavigatePrefix(1), canGoBack: index > 0 || Boolean(flow),
    navigate: go, navigationProps: { steps: [...prefix, ...(steps || []).map((step) => ({ ...step, label: step.shortLabel || step.label })), { id: 'review', label: 'Review' }], current: prefix.length + index,
      available: prefix.length + Math.max(index, ...(steps || []).map((step, i) => visited.includes(step.id) ? i : 0), visited.includes('review') ? steps.length : 0),
      onNavigate: (target) => target < prefix.length ? flow.onNavigatePrefix(target) : go(target - prefix.length) } }
}

