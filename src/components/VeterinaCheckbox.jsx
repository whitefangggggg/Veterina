import { Check } from '@phosphor-icons/react'
import './VeterinaCheckbox.css'

export default function VeterinaCheckbox({ label, className = '', onChange, ...props }) {
  return <label className={`vt-checkbox-label ${className}`}>
    <span className="vt-checkbox-control"><input {...props} type="checkbox" onChange={onChange ? (event) => onChange(event.target.checked, event) : undefined} className="vt-checkbox-native" />
    <span className="vt-checkbox-box" aria-hidden="true"><Check size={14} weight="bold" /></span></span>
    <span>{label}</span>
  </label>
}
