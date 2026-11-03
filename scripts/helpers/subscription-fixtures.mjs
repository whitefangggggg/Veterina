import assert from 'node:assert/strict'

// Call only after validating a local, otherwise empty test database.
export function cleanupSubscriptionFixtures(sql, admin, owners) {
  for (const id of [admin, ...owners]) assert.match(id, /^[0-9a-f-]{36}$/)
  sql(`begin;
    delete from private.subscription_receipts where actor_id in ('${[admin, ...owners].join("','")}');
    delete from private.subscription_events where actor_id in ('${[admin, ...owners].join("','")}');
    delete from private.activation_redemptions where user_id in ('${owners.join("','")}');
    delete from private.activation_codes where created_by='${admin}';
    delete from private.clinic_subscriptions where clinic_id in(select clinic_id from public.profiles where id in ('${owners.join("','")}'));
    delete from private.staff_join_requests where id in ('${owners.join("','")}');
    delete from private.owner_registrations where id in ('${owners.join("','")}');
    delete from public.service_types where clinic_id in(select clinic_id from public.profiles where id in ('${owners.join("','")}'));
    delete from private.clinic_codes where clinic_id in(select clinic_id from public.profiles where id in ('${owners.join("','")}'));
    delete from public.clinic_settings where clinic_id in(select clinic_id from public.profiles where id in ('${owners.join("','")}'));
    create temporary table subscription_test_clinics as select clinic_id from public.profiles where id in ('${owners.join("','")}');
    delete from public.profiles where id in ('${owners.join("','")}');
    delete from public.audit_logs where clinic_id in(select clinic_id from subscription_test_clinics);
    delete from public.clinics where id in(select clinic_id from subscription_test_clinics);
    delete from auth.users where id in ('${[admin, ...owners].join("','")}');
    commit;`)
}
