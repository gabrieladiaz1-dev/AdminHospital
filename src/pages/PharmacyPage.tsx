import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { panelError } from '../lib/panel'
import { prescriptionStatusLabel, readPatientPrescriptions, searchPharmacyPatients, setPrescriptionStatus, type PharmacyPatient, type PharmacyPrescription } from '../lib/pharmacy'

const when = (value: string) => new Date(value).toLocaleString('es-SV', { timeZone: 'America/El_Salvador', dateStyle: 'medium', timeStyle: 'short' })
const statusTone = { pendiente: 'bg-amber-50 text-amber-800 ring-amber-200', parcial: 'bg-sky-50 text-sky-800 ring-sky-200', entregada: 'bg-emerald-50 text-emerald-800 ring-emerald-200' }

export function PharmacyPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PharmacyPatient[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [patient, setPatient] = useState<PharmacyPatient | null>(null)
  const active = query.trim().length >= 2
  const shown = active ? results : []

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) return
    let active = true
    const timer = window.setTimeout(() => {
      setSearching(true); setSearchError('')
      searchPharmacyPatients(term).then(rows => { if (active) setResults(rows) })
        .catch(e => { if (active) setSearchError(panelError(e)) })
        .finally(() => { if (active) setSearching(false) })
    }, 300)
    return () => { active = false; window.clearTimeout(timer) }
  }, [query])

  return <div className="space-y-5">
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <label className="block text-xs font-semibold text-slate-700" htmlFor="pharmacy-search">Buscar paciente</label>
      <p className="mt-1 text-[11px] text-slate-500">Escribe el nombre, el DUI o el correo electrónico.</p>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-300 px-3 focus-within:border-[#800b2c] focus-within:ring-2 focus-within:ring-[#800b2c]/15">
        <Icon name="search" size={15} />
        <input id="pharmacy-search" className="w-full py-2.5 text-sm outline-none" type="search" autoComplete="off" value={query} onChange={e => { setQuery(e.target.value); setPatient(null) }} placeholder="Ej.: María López, 01234567-8 o maria@correo.com" />
      </div>
      {active && searching && <p className="mt-3 text-xs text-slate-500" role="status">Buscando pacientes…</p>}
      {active && searchError && <p className="mt-3 rounded-md bg-rose-50 p-2 text-xs text-rose-800" role="alert">{searchError}</p>}
      {!patient && !searching && !searchError && active && !shown.length && <p className="mt-3 text-xs text-slate-500" role="status">No se encontraron pacientes con «{query.trim()}».</p>}
      {!patient && shown.length > 0 && <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label="Resultados de la búsqueda">
        {shown.map(p => <li key={p.id}><button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-[#800b2c]/5" onClick={() => setPatient(p)}>
          <span className="text-sm font-semibold text-slate-800">{p.full_name}</span>
          <span className="text-[11px] text-slate-500">{[p.dui, p.email].filter(Boolean).join(' · ') || 'Sin DUI ni correo'}</span>
        </button></li>)}
      </ul>}
    </section>
    {patient && <PatientPrescriptions key={patient.id} patient={patient} onClose={() => setPatient(null)} />}
  </div>
}

function PatientPrescriptions({ patient, onClose }: { patient: PharmacyPatient; onClose: () => void }) {
  const [rows, setRows] = useState<PharmacyPrescription[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const lock = useRef(false)

  useEffect(() => {
    let active = true
    readPatientPrescriptions(patient.id).then(r => { if (active) setRows(r) }).catch(e => { if (active) setError(panelError(e)) })
    return () => { active = false }
  }, [patient.id])

  async function change(rx: PharmacyPrescription, status: 'pendiente' | 'entregada') {
    if (lock.current || rx.status === status) return
    lock.current = true; setBusy(rx.id); setError(''); setNotice('')
    try {
      const saved = await setPrescriptionStatus(rx.id, status)
      setRows(current => current?.map(r => r.id === rx.id ? { ...r, status: saved.status, status_updated_at: saved.status_updated_at } : r) ?? null)
      setNotice(`La receta ${rx.code} quedó como «${prescriptionStatusLabel[saved.status]}». El paciente ya puede verlo en su portal.`)
    } catch (e) { setError(panelError(e)) } finally { lock.current = false; setBusy(null) }
  }

  const field = (label: string, value: string | null) => <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt><dd className="mt-0.5 text-sm text-slate-800">{value || 'No registrado'}</dd></div>

  return <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="pharmacy-patient-name">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h3 id="pharmacy-patient-name" className="text-base font-semibold text-[#800b2c]">{patient.full_name}</h3>
      <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" onClick={onClose}>Cambiar paciente</button>
    </div>
    <dl className="mt-3 grid gap-3 sm:grid-cols-4">{field('Nombre', patient.full_name)}{field('Correo', patient.email)}{field('DUI', patient.dui)}{field('Teléfono', patient.phone)}</dl>

    <h4 className="mt-6 text-sm font-semibold text-slate-800">Recetas</h4>
    {error && <p className="mt-3 rounded-md bg-rose-50 p-2 text-xs text-rose-800" role="alert">{error}</p>}
    {notice && <p className="mt-3 rounded-md bg-emerald-50 p-2 text-xs text-emerald-800" role="status">{notice}</p>}
    {!rows && !error && <p className="mt-3 text-xs text-slate-500" role="status">Consultando recetas…</p>}
    {rows && !rows.length && <p className="mt-3 text-xs text-slate-500">Este paciente no tiene recetas registradas.</p>}
    {rows && rows.length > 0 && <ul className="mt-3 space-y-3">{rows.map(rx => <li key={rx.id} className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-sm font-semibold text-slate-800">{rx.code}</p><p className="text-[11px] text-slate-500">Emitida {when(rx.issued_at)}{rx.status_updated_at ? ` · Estado actualizado ${when(rx.status_updated_at)}` : ''}</p></div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${statusTone[rx.status]}`}>{prescriptionStatusLabel[rx.status]}</span>
      </div>
      <ul className="mt-3 space-y-1 text-xs text-slate-700">{rx.items.map((item, i) => <li key={i}>• <b>{item.medication}</b> — {item.dose} {item.dose_unit} cada {item.frequency_hours} h, vía {item.route}, cantidad {item.quantity}{item.observations ? `. ${item.observations}` : ''}</li>)}</ul>
      <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={`Estado de ${rx.code}`}>
        {(['pendiente', 'entregada'] as const).map(s => <button key={s} type="button" aria-pressed={rx.status === s} disabled={busy !== null || rx.status === s}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold ${rx.status === s ? 'bg-[#800b2c] text-white' : 'border border-[#800b2c] text-[#800b2c] hover:bg-[#800b2c]/5'} disabled:cursor-not-allowed disabled:opacity-70`}
          onClick={() => change(rx, s)}>{busy === rx.id && rx.status !== s ? 'Guardando…' : `Marcar ${prescriptionStatusLabel[s].toLowerCase()}`}</button>)}
      </div>
    </li>)}</ul>}
  </section>
}
