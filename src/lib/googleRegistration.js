const draftKey = 'veterina-google-registration'

export function saveGoogleRegistrationDraft(draft) {
  try {
    if (draft) sessionStorage.setItem(draftKey, JSON.stringify(draft))
    else sessionStorage.removeItem(draftKey)
  } catch { /* Authentication can continue without restoring form preferences. */ }
}

export function readGoogleRegistrationDraft() {
  try {
    const draft = JSON.parse(sessionStorage.getItem(draftKey))
    return { accountType: draft?.accountType === 'owner' ? 'owner' : 'staff',
      clinicName: String(draft?.clinicName || '').slice(0, 160), veterinaCode: String(draft?.veterinaCode || '').slice(0, 60) }
  } catch { return { accountType: 'staff', clinicName: '', veterinaCode: '' } }
}
