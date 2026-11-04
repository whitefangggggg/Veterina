import { headers } from '../_shared/http.ts';
import { subscriptionFailure, subscriptionRequest, subscriptionResponse } from '../_shared/subscriptions.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  try {
    const { user, input, admin } = await subscriptionRequest(req);
    if (typeof input.code !== 'string' || input.code.length > 100 || typeof input.requestId !== 'string'
      || (input.renew !== undefined && typeof input.renew !== 'boolean')) throw new Error('VALIDATION_FAILED');
    const { data, error } = await admin.rpc('redeem_clinic_activation', {
      p_actor: user.id, p_code: input.code, p_request_id: input.requestId, p_renew: input.renew === true,
      p_details: { fullName: typeof input.fullName === 'string' ? input.fullName : '', clinicName: typeof input.clinicName === 'string' ? input.clinicName : '' },
    });
    if (error) throw error;
    return subscriptionResponse(data);
  } catch (error) { return subscriptionFailure(error); }
});
