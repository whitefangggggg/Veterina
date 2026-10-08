import { useEffect,useState } from 'react'
import { Link,Navigate,useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase,requiresPasswordSetup } from '../lib/supabaseClient'
import MutationForm from '../components/MutationForm'
export function DemoEntry(){const{isDemo,setDemo}=useAuth();useEffect(()=>{setDemo(true)},[setDemo]);return isDemo?<Navigate to="/dashboard" replace/>:<p>Loading demo…</p>}
export default function Login(){
  const{session,isDemo,setDemo}=useAuth()
  const[email,setEmail]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState(''),[factor,setFactor]=useState(null),[checked,setChecked]=useState(null),[recovery,setRecovery]=useState(requiresPasswordSetup)
  const navigate=useNavigate()
  useEffect(()=>{if(isDemo)setDemo(false)},[isDemo,setDemo])
  useEffect(()=>{
    if(!session||!supabase){setChecked(null);return}
    let alive=true
    setChecked(null)
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(async({data})=>{
      if(!alive)return
      if(data?.nextLevel==='aal2'&&data.currentLevel!=='aal2'){const{data:f}=await supabase.auth.mfa.listFactors();if(alive)setFactor(f.totp[0]?.id)}
      if(alive)setChecked(session.user.id)
    })
    return ()=>{alive=false}
  },[session])
  const submit=async()=>{
    if(factor){const{error}=await supabase.auth.mfa.challengeAndVerify({factorId:factor,code});if(error)throw error;setFactor(null);navigate('/dashboard');return}
    const{error}=recovery?await supabase.auth.updateUser({password}):await supabase.auth.signInWithPassword({email,password})
    if(error)throw error
    if(recovery){setRecovery(false);navigate('/dashboard')}
  }
  useEffect(()=>{if(!supabase)return;const{data:{subscription}}=supabase.auth.onAuthStateChange((event)=>{if(event==='PASSWORD_RECOVERY')setRecovery(true)});return()=>subscription.unsubscribe()},[])
  if(session&&checked===session.user.id&&!factor&&!recovery)return <Navigate to="/dashboard" replace/>
  return <div className="auth-page"><section className="section-card auth-card"><Link to="/" className="back-link">Veterina</Link><h1>{recovery?'Set your password':'Staff sign in'}</h1><p>Clinic access is granted by the owner. Contact the clinic owner for an invitation.</p>
    {!supabase?<p role="alert">Supabase is not configured. Add the project URL and publishable key to .env.local.</p>:<MutationForm onSubmit={submit}>
      {factor?<label>Authenticator code<input required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e)=>setCode(e.target.value)}/></label>:<>
        {!recovery&&<label>Email<input required type="email" autoComplete="username" value={email} onChange={(e)=>setEmail(e.target.value)}/></label>}
        <label>Password<input required minLength={8} type="password" autoComplete={recovery?'new-password':'current-password'} value={password} onChange={(e)=>setPassword(e.target.value)}/></label>
      </>}
      <button className="button button-primary">{factor?'Verify':recovery?'Save password':'Sign in'}</button>
    </MutationForm>}
    <Link to="/demo" className="button button-secondary">Explore fictional demo</Link>
  </section></div>
}
