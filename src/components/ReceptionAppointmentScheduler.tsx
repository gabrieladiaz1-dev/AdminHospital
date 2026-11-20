import { userMessage } from '../lib/userError'
import { usePlanningRealtime } from '../lib/usePlanningRealtime'
import { useEffect, useRef, useState } from 'react'
import { availableSlots, displayTime, localDate, nextAvailableDate, receptionDoctors, receptionRpc, requestAppointment, type ReceptionAppointment, type ReceptionDoctor, type ReceptionPatient, type Slot } from '../lib/reception'
import { appointmentMatches, bookingCall, definitiveBookingFailure, isSlotConflict, sameSlot, type BookingIntent } from '../lib/receptionBooking'
import { Icon } from './Icon'
import './ReceptionAgenda.css'

export function ReceptionAppointmentScheduler({ patient, code, specialties, requestId, specialtyId, onSaved }: { patient: ReceptionPatient; code: string; specialties: { id: number; name: string }[]; requestId?: string; specialtyId?: number; onSaved: (appointment: ReceptionAppointment) => void }) {
  const { revision: planningRevision } = usePlanningRealtime()
  const [specialty, setSpecialty] = useState(specialtyId ?? 0)
  const [date, setDate] = useState(localDate())
  const [doctors, setDoctors] = useState<ReceptionDoctor[]>([])
  const [complete, setComplete] = useState(true)
  const [doctor, setDoctor] = useState('')
  const [slots, setSlots] = useState<Slot[]>([])
  const [slot, setSlot] = useState<Slot | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  const [symptoms, setSymptoms] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState<BookingIntent | null>(null)
  const [recovering, setRecovering] = useState(!requestId && Boolean(sessionStorage.getItem(`reception-booking:${patient.id}`)))
  const [recoveryError, setRecoveryError] = useState(false)
  const [slotsRevision, setSlotsRevision] = useState(0)
  const [nextDate, setNextDate] = useState<string | null>(null)
  const lock = useRef(false)
  const keepError = useRef(false)
  const key = useRef(sessionStorage.getItem(`reception-booking:${patient.id}`) || crypto.randomUUID())
  const onSavedRef = useRef(onSaved)
  useEffect(() => { onSavedRef.current = onSaved }, [onSaved])
  useEffect(() => {
    if (requestId || !sessionStorage.getItem(`reception-booking:${patient.id}`)) return
    let active = true
    requestAppointment(key.current).then(a => { if (active && a) { sessionStorage.removeItem(`reception-booking:${patient.id}`); onSavedRef.current(a) } }).catch(() => { if (active) { setRecoveryError(true); setError('No se pudo comprobar el último intento. Vuelve a abrir la agenda cuando tengas conexión; no se enviará otra cita.') } }).finally(() => { if (active) setRecovering(false) })
    return () => { active = false }
  }, [patient.id, requestId])
  useEffect(() => {
    let active = true
    setDoctors([]); setSlots([]); setSlot(null); setConfirmed(false); setLoading(false); setNextDate(null)
    if (!specialty || !date || date < localDate()) return
    setLoading(true)
    receptionDoctors(specialty, date, patient.id).then(result => { if (active && !result.doctors.length) void nextAvailableDate(specialty, date).then(next => { if (active) setNextDate(next) }); if (active) { setDoctors(result.doctors); setDoctor(previous => result.doctors.some(d => d.id === previous) ? previous : ''); setComplete(result.complete) } }).catch(e => { if (active) setError(userMessage(e)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [specialty, date, patient.id, planningRevision])
  useEffect(() => {
    let active = true
    setSlots([]); setSlot(null); setConfirmed(false)
    if (!doctor) return
    setLoading(true); if (keepError.current) keepError.current = false; else setError('')
    availableSlots(specialty, date, patient.id, doctor).then(rows => { if (active) setSlots(rows) }).catch(e => { if (active) setError(userMessage(e)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [slotsRevision, doctor, specialty, date, patient.id, planningRevision])
  async function save() {
    if (lock.current || recovering || recoveryError || !confirmed || (!slot && !pending)) return
    const intent: BookingIntent = pending ?? { patientId: patient.id, slot: slot!, specialtyId: specialty, requestId, key: key.current, reason, symptoms }
    lock.current = true; setSaving(true); setError(''); setPending(intent)
    if (!requestId) sessionStorage.setItem(`reception-booking:${patient.id}`, key.current)
    try {
      if (!pending) {
        // Validación previa: otra recepcionista pudo ocupar este horario desde que se cargó la lista.
        const fresh = await availableSlots(specialty, date, patient.id, intent.slot.doctor_id)
        if (!fresh.some(s => sameSlot(s, intent.slot))) {
          setPending(null); if (!requestId) sessionStorage.removeItem(`reception-booking:${patient.id}`)
          keepError.current = true; setSlot(null); setConfirmed(false); setSlotsRevision(r => r + 1)
          setError('Este horario acaba de ser ocupado por otra programación. Se actualizaron las horas disponibles; elige otra.')
          return
        }
      }
      const call = bookingCall(intent)
      const result = await receptionRpc<string | { appointment_id: string }>(call.name, call.args)
      if (!(typeof result === 'string' ? result : result?.appointment_id)) throw new Error('El servicio no confirmó la cita. Reintenta la misma operación.')
      const s = intent.slot
      sessionStorage.removeItem(`reception-booking:${patient.id}`)
      onSaved({ id: typeof result === 'string' ? result : result.appointment_id, request_id: requestId ?? intent.key, patient_id: patient.id, doctor_id: s.doctor_id, consulting_room_id: s.consulting_room_id, starts_at: s.starts_at, ends_at: s.ends_at, doctor_name: s.doctor_name, room_code: s.room_code, status: 'programada' })
      setPending(null)
    } catch (e) {
      if (definitiveBookingFailure(e)) {
        try {
          const existing = await requestAppointment(requestId ?? intent.key)
          if (existing) {
            if (appointmentMatches(existing, patient.id, intent.slot)) { sessionStorage.removeItem(`reception-booking:${patient.id}`); setPending(null); onSaved(existing); return }
            setRecoveryError(true)
            setError('La operación anterior tiene una cita con datos distintos. Revisa la agenda antes de continuar; no se creará otra cita.')
            return
          }
          setPending(null); sessionStorage.removeItem(`reception-booking:${patient.id}`); key.current = crypto.randomUUID(); setSlot(null)
          if (isSlotConflict(e)) { keepError.current = true; setConfirmed(false); setSlotsRevision(r => r + 1) } else setDoctor('')
        } catch { /* Keep the original key when reconciliation cannot be confirmed. */ }
      }
      setError(userMessage(e, 'No se confirmó el guardado. Reintenta esta misma cita; no se enviará otra solicitud.'))
    } finally { lock.current = false; setSaving(false) }
  }
  const selectedDoctor = doctors.find(d => d.id === doctor)
  return <section className="booking-workspace"><header className="agenda-heading"><Icon name="calendar" size={25} /><div><h3>Encuentra el mejor horario</h3><p>Horarios de El Salvador · Solo se ofrecen espacios disponibles.</p></div></header>
    {error && <p role="alert" className="agenda-warning">{error}</p>}
    {pending && !saving && <p role="status" className="agenda-warning">El resultado del guardado aún no está confirmado. Usa «Reintentar la misma cita» para recuperar el resultado sin duplicarla.</p>}
    {recovering && <p role="status">Comprobando el último intento de guardado…</p>}
    <fieldset disabled={saving || Boolean(pending) || recovering || recoveryError} className="booking-fields"><div className="agenda-controls"><label>Especialidad<select value={specialty} disabled={Boolean(specialtyId)} onChange={e => setSpecialty(Number(e.target.value))}><option value={0}>Selecciona una especialidad</option>{specialties.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Fecha de atención<input type="date" min={localDate()} value={date} onChange={e => setDate(e.target.value)} /></label></div>
    {!requestId && <div className="agenda-controls"><label>Motivo de consulta<textarea maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label><label>Síntomas o información adicional<textarea maxLength={1000} value={symptoms} onChange={e => setSymptoms(e.target.value)} /></label></div>}
    {loading && <p role="status">Consultando médicos y horarios…</p>}
    {specialty > 0 && !loading && !doctors.length && <div className="agenda-empty"><Icon name="clock" size={28} /><h4>No hay médicos disponibles para esta fecha</h4>{nextDate ? <><p>La próxima fecha con horarios para esta especialidad es el {nextDate.split("-").reverse().join("/")}.</p><button type="button" className="agenda-primary" onClick={() => setDate(nextDate)}>Ver horarios del {nextDate.split("-").reverse().join("/")}</button></> : <p>No hay horarios para esta especialidad en los próximos 30 días. Revisa las jornadas en Horarios y turnos.</p>}</div>}
    {!complete && doctors.length > 0 && <p className="agenda-note">Se muestran médicos con espacios libres. La vista completa de jornadas requiere habilitar la extensión de agenda preparada.</p>}
    <div className="agenda-doctors">{doctors.map(d => <button type="button" aria-pressed={doctor === d.id} key={d.id} onClick={() => setDoctor(d.id)}><Icon name="patient" size={25} /><strong>{d.name}</strong><span>{d.specialty || specialties.find(s => s.id === specialty)?.name}</span><small>{d.consultations.length ? [...new Set(d.consultations.map(c => `Consultorio ${c.room_code}`))].join(' · ') : 'Consultar horarios libres'}</small></button>)}</div>
    {selectedDoctor && complete && <details className="agenda-doctor-details"><summary>Jornadas y consultorios de {selectedDoctor.name} · próximos 7 días</summary><h4>Jornada laboral</h4>{selectedDoctor.shifts.map(s => <p key={s.starts_at}>{displayTime(s.starts_at)} — {displayTime(s.ends_at)}</p>)}<h4>Atención por consultorio</h4>{selectedDoctor.consultations.map(s => <p key={`${s.starts_at}-${s.room_code}`}>{displayTime(s.starts_at)} — {displayTime(s.ends_at)} · {s.room_code} · {s.slot_minutes} min</p>)}{selectedDoctor.breaks.length > 0 && <><h4>Intervalos no disponibles</h4>{selectedDoctor.breaks.map(b => <p key={b.starts_at}>{displayTime(b.starts_at)} — {displayTime(b.ends_at)}</p>)}</>}</details>}
    {doctor && !loading && !slots.length && <p className="agenda-warning">Este médico no tiene horas libres ese día. Revisa otra fecha; no se puede reservar fuera de su disponibilidad.</p>}
    <div className="agenda-slots">{slots.map(s => <button type="button" key={`${s.starts_at}-${s.consulting_room_id}`} aria-pressed={slot === s} onClick={() => { setSlot(s); setConfirmed(false) }}><strong>{displayTime(s.starts_at)}</strong><span>{s.slot_minutes} minutos · Consultorio {s.room_code}</span></button>)}</div></fieldset>
    {(slot || pending) && <div className="booking-summary"><span className="reception-eyebrow">REVISA ANTES DE GUARDAR</span><h4>{patient.first_name} {patient.last_name}</h4><p>Expediente {code}</p><p>{specialties.find(s => s.id === specialty)?.name} · {(pending?.slot ?? slot)!.doctor_name}</p><p>{displayTime((pending?.slot ?? slot)!.starts_at)} · Consultorio {(pending?.slot ?? slot)!.room_code}</p><label><input type="checkbox" checked={confirmed} disabled={saving || Boolean(pending)} onChange={e => setConfirmed(e.target.checked)} />Confirmé la identidad, el expediente y los datos de la cita con el paciente.</label><button type="button" className="agenda-primary" disabled={saving || recovering || recoveryError || !confirmed || (!requestId && !reason.trim())} onClick={() => void save()}>{saving ? 'Guardando cita…' : pending ? 'Reintentar la misma cita' : 'Confirmar y guardar cita'}</button></div>}
  </section>
}
