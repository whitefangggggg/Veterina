/* oxlint-disable react/only-export-components */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { clinicErrorMessage, createMutationRunner, fetchClinicData, normalizeClinicData } from '../lib/clinicRepository'
import { useAuth } from './AuthContext'
import { ClinicDataContext } from './ClinicContext'

export function ClinicDataProvider({ children }) {
  const { user, refreshAccess, signOut } = useAuth()
  const [raw, setRaw] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [clock, setClock] = useState(() => new Date())
  const request = useRef(0)
  const mounted = useRef(false)
  const mutation = useMemo(() => createMutationRunner(supabase), [])

  const reload = useCallback(async () => {
    const current = ++request.current
    setRefreshing(true)
    try {
      const result = await fetchClinicData(supabase)
      if (!mounted.current || current !== request.current) return
      if (!result.profiles.some((profile) => profile.id === user.id && profile.is_active)) {
        await refreshAccess()
        throw new Error('FORBIDDEN')
      }
      setRaw(result)
      setError('')
    } catch (error) {
      if (mounted.current && current === request.current) setError(clinicErrorMessage(error))
    } finally {
      if (mounted.current && current === request.current) setRefreshing(false)
    }
  }, [user.id, refreshAccess])

  useEffect(() => {
    mounted.current = true
    const generation = request.current
    queueMicrotask(() => { if (mounted.current && generation === request.current) void reload() })
    const tick = setInterval(() => setClock(new Date()), 30000)
    const onFocus = () => { setClock(new Date()); void reload() }
    window.addEventListener('focus', onFocus)
    return () => { mounted.current = false; request.current += 1; clearInterval(tick); window.removeEventListener('focus', onFocus) }
  }, [reload])

  const execute = async (action, payload) => {
    try {
      const result = await mutation(action, payload)
      await reload()
      return result
    } catch (error) {
      // Refresh concurrent saves while the open editor retains its own inputs.
      // Closing and reopening then loads the draft or checkup that was saved.
      if (['DRAFT_CONFLICT', 'CHECKUP_ALREADY_QUEUED', 'VACCINATION_ALREADY_QUEUED'].some((code) => error.message?.includes(code))) await reload()
      throw new Error(clinicErrorMessage(error), { cause: error })
    }
  }
  const data = useMemo(() => normalizeClinicData(raw || {}, clock), [raw, clock])
  const value = { ...data, execute, reload, refreshing,
    manageKb: async (payload) => {
      const { data: result, error } = await supabase.rpc('manage_kb', { p_data: payload })
      if (error) throw new Error(clinicErrorMessage(error), { cause: error })
      await reload()
      return result
    },
    addOwner: (payload) => execute('create_owner', payload),
    addPet: (payload) => execute('create_pet', payload),
    addVisit: (payload) => execute('create_queued_encounter', payload),
    addVaccination: (payload) => execute('create_queued_vaccination', payload),
    addAppointment: (payload) => execute('book_appointment', payload),
    completeReminder: (id, outcome) => execute('complete_reminder', { id, outcome }),
    getOwner: (id) => data.owners.find((owner) => owner.id === id),
    getPet: (id) => data.pets.find((pet) => pet.id === id) }

  if (!raw) return <div className="page-loader" role="status">{error ? <><p role="alert">{error}</p><button className="button button-primary" disabled={refreshing} onClick={reload}>Retry loading records</button><button className="button button-secondary" onClick={() => void signOut().catch((error) => setError(error.message))}>Sign out</button></> : <><span aria-hidden="true" /><p>Loading clinic records...</p></>}</div>
  return <ClinicDataContext.Provider value={value}>
    {error && <div className="database-error" role="alert"><span>Saved records could not be refreshed. {error}</span><button className="button button-secondary small-button" disabled={refreshing} onClick={reload}>Retry refresh</button></div>}
    {children}
  </ClinicDataContext.Provider>
}

export function useClinicData() {
  const context = useContext(ClinicDataContext)
  if (!context) throw new Error('useClinicData must be used inside ClinicDataProvider')
  return context
}
