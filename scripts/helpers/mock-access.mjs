// Explicit subscription contract for intercepted clinic browser scenarios.
export function mockAccountAccess(profile, overrides = {}) {
  return {
    isPlatformAdmin: false, needsRegistration: false, serverNow: new Date().toISOString(),
    subscription: profile ? {
      clinicId: profile.clinic_id || 'clinic', clinicName: 'Browser test clinic', timezone: 'Asia/Manila',
      startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      status: profile.is_active ? 'active' : 'disabled', transition: false,
    } : null,
    ...overrides,
  }
}
