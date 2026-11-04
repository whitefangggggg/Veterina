import { headers } from '../_shared/http.ts';
import { subscriptionFailure, subscriptionRequest, subscriptionResponse } from '../_shared/subscriptions.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  try {
    const { user, input, admin } = await subscriptionRequest(req);
    if (!['list', 'history', 'generate', 'extend', 'revoke'].includes(input.action)) throw new Error('VALIDATION_FAILED');
    const { data, error } = await admin.rpc('platform_subscription_admin', {
      p_actor: user.id, p_action: input.action, p_data: input.data || {}, p_request_id: input.requestId || null,
    });
    if (error) throw error;
    return subscriptionResponse(data);
  } catch (error) { return subscriptionFailure(error); }
});
