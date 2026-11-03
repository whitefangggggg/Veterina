import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { remainingTime, subscriptionDate } from '../lib/subscriptions'

export default function SubscriptionTimer() {
  const { accountAccess, serverTimeOffset, profile } = useAuth()
  const [clock, setClock] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 30000); return () => clearInterval(timer) }, [])
  const subscription = accountAccess?.subscription
  if (profile?.role !== 'owner' || !subscription) return null
  const soon = Date.parse(subscription.expiresAt) - (clock + serverTimeOffset) <= 7 * 86400000
  return <div className={`subscription-strip ${soon ? 'subscription-soon' : ''}`}>
    <span>{subscription.transition ? 'Transition subscription' : 'Clinic subscription'} · <strong>{remainingTime(subscription.expiresAt, clock + serverTimeOffset)} remaining</strong></span>
    <Link to="/subscription" title={`Expires ${subscriptionDate(subscription.expiresAt, subscription.timezone)}`}>Manage subscription →</Link>
  </div>
}
