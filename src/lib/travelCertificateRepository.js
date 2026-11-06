import { supabase } from './supabaseClient'
import { clinicErrorMessage, unwrap } from './clinicRepository'
import { withTravelCertificateQr } from './travelCertificateSharing'

export const CERTIFICATE_PAGE_SIZE = 25
export async function fetchTravelCertificates({ query = '', page = 0, signal } = {}) {
  let request = supabase.from('travel_certificates').select('id,reference_number,pet_name,owner_name,issuer_name,issued_on,issued_at,travel_date,destination,status,void_reason,is_public', { count: 'exact' })
    .order('issued_at', { ascending: false }).order('id', { ascending: false }).range(page * CERTIFICATE_PAGE_SIZE, (page + 1) * CERTIFICATE_PAGE_SIZE - 1)
  if (query.trim()) request = request.ilike('search_text', `%${query.trim().replace(/[\\%_]/g, '\\$&')}%`)
  if (signal) request = request.abortSignal(signal)
  const result = await request
  if (result.error) throw new Error(clinicErrorMessage(result.error))
  return { records: result.data || [], count: result.count || 0 }
}

export async function fetchTravelCertificate(id) {
  const result = await supabase.from('travel_certificates').select('*').eq('id', id).single()
  if (result.error) throw new Error(clinicErrorMessage(result.error))
  return withTravelCertificateQr(unwrap(result))
}

export async function fetchPublicTravelCertificate(token, signal) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) return null
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/travel-certificate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), cache: 'no-store', signal,
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error('The certificate could not be loaded. Please retry.')
  return withTravelCertificateQr({ ...await response.json(), public_token: token })
}
