import { Link } from 'react-router-dom'
import { Scales } from '@phosphor-icons/react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { SectionCard } from './ui'
import { patientVitals, recordedVital, visitDateTime } from '../lib/patientVitals'
import { patientSource } from '../lib/dailyWorkflow'
import './PatientVitals.css'

export default function PatientVitals({ pet, visits, timezone }) {
  const { rows, weights, domain } = patientVitals(visits, timezone)
  const byId = new Map(weights.map((point) => [point.visitId, point]))
  const years = new Set(weights.map((point) => point.date.slice(0, 4)))
  const dateCounts = new Map()
  weights.forEach((point) => dateCounts.set(point.date, (dateCounts.get(point.date) || 0) + 1))
  const tick = ({ x, y, payload }) => {
    const point = byId.get(payload.value)
    if (!point) return null
    const label = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${point.date}T00:00:00Z`))
    const detail = [years.size > 1 ? point.date.slice(0, 4) : '', dateCounts.get(point.date) > 1 && point.at.includes('T') ? visitDateTime(point.at, timezone).split(', ').at(-1) : ''].filter(Boolean).join(' · ')
    return <g transform={`translate(${x},${y})`}><text className="recharts-cartesian-axis-tick-value" textAnchor="middle" fill="var(--muted)" fontSize={11}><tspan x={0} dy={12}>{label}</tspan>{detail && <tspan x={0} dy={14}>{detail}</tspan>}</text></g>
  }
  const value = (number, unit = '') => recordedVital(number) ? `${number}${unit}` : 'Not recorded'
  return <div className="patient-vitals">
    <SectionCard title="Weight trend" description="Recorded visit weights, oldest to newest. Hover over a point for its full date and time.">
      {weights.length ? <div className="patient-weight-chart" role="img" aria-label={`Weight trend with ${weights.length} recorded measurements. Full values are in the visit vitals table below.`}>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={weights} margin={{ top: 16, right: 24, left: 8, bottom: 14 }}>
            <defs><linearGradient id="patientWeightFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--brand)" stopOpacity={0.24} /><stop offset="95%" stopColor="var(--brand)" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
            <XAxis dataKey="visitId" tick={tick} height={44} interval="preserveStartEnd" tickLine={false} axisLine={false} minTickGap={30} padding={{ left: 22, right: 22 }} />
            <YAxis width={72} tickLine={false} axisLine={false} tickFormatter={(weight) => `${Number(weight.toFixed(2))} kg`} domain={domain} tick={{ fontSize: 11 }} />
            <Tooltip labelFormatter={(id) => visitDateTime(byId.get(id)?.at, timezone)} formatter={(weight) => [`${weight} kg`, 'Weight']} />
            <Area type="linear" dataKey="weight" stroke="var(--brand)" strokeWidth={2.5} fill="url(#patientWeightFill)" dot={{ r: 4, strokeWidth: 2, fill: 'var(--surface)' }} activeDot={{ r: 6 }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div> : <div className="empty-inline"><Scales size={28} /><h3>No visit weights recorded</h3><p>Recorded weights will appear here when added to a checkup.</p></div>}
      {recordedVital(pet.baseline_weight) && <p className="patient-baseline-weight">Baseline weight: <strong>{pet.baseline_weight} kg</strong><span>Undated · not plotted as a visit measurement</span></p>}
    </SectionCard>
    <SectionCard title="Visit vitals" description={`Measurements remain linked to their original checkup. Dates use ${timezone}.`}>
      {rows.length ? <div className="patient-vitals-scroll" role="region" aria-label="Visit vitals table" tabIndex={0}><table>
        <caption className="sr-only">Recorded visit measurements, newest first</caption>
        <thead><tr>{['Visit date/time', 'Weight', 'Temperature', 'Heart rate', 'Respiratory rate', 'Body condition score'].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{rows.map((visit) => <tr key={visit.id}><th scope="row"><Link to={patientSource(pet.id, 'history', visit.id)}>{visitDateTime(visit.visitedAt, timezone)}</Link></th>
          <td>{value(visit.weightKg, ' kg')}</td><td>{value(visit.temperatureC, ' °C')}</td><td>{value(visit.heartRate, ' bpm')}</td><td>{value(visit.respiratoryRate, ' rpm')}</td><td>{recordedVital(visit.bodyConditionScore) ? `${visit.bodyConditionScore}/${visit.bodyConditionScale || 9}` : 'Not recorded'}</td></tr>)}</tbody>
      </table></div> : <div className="empty-inline"><h3>No visit vitals recorded</h3><p>Weight and other measurements will appear here after they are recorded.</p></div>}
    </SectionCard>
  </div>
}
