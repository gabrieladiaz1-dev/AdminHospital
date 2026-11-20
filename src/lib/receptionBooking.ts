import type { ReceptionAppointment, Slot } from './reception.ts'

export const appointmentLabels: Record<string, string> = { programada: 'Programada', confirmada: 'Confirmada', en_atencion: 'En atención', completada: 'Completada', cancelada: 'Cancelada', no_asistio: 'No asistió' }
export function agendaCounts(rows: { status: string }[]) {
  return { total: rows.length, scheduled: rows.filter(row => row.status === 'programada').length, waiting: rows.filter(row => ['programada', 'confirmada'].includes(row.status)).length, attending: rows.filter(row => row.status === 'en_atencion').length }
}
export function appointmentMatches(row: ReceptionAppointment, patientId: string, slot: Slot) {
  return row.patient_id === patientId && row.doctor_id === slot.doctor_id && row.consulting_room_id === slot.consulting_room_id && new Date(row.starts_at).getTime() === new Date(slot.starts_at).getTime() && new Date(row.ends_at).getTime() === new Date(slot.ends_at).getTime() && !['cancelada', 'no_asistio'].includes(row.status)
}
export interface BookingIntent { patientId: string; slot: Slot; specialtyId: number; requestId?: string; key: string; reason: string; symptoms: string }
export function bookingCall(intent: BookingIntent) {
  if (intent.requestId) return { name: 'schedule_appointment', args: { p_request: intent.requestId, p_patient: intent.patientId, p_doctor: intent.slot.doctor_id, p_room: intent.slot.consulting_room_id, p_start: intent.slot.starts_at, p_end: intent.slot.ends_at } }
  return { name: 'reception_walkin_attention', args: { p_patient: intent.patientId, p_key: intent.key, p_values: { mode: 'scheduled', specialty_id: intent.specialtyId, doctor_id: intent.slot.doctor_id, room_id: intent.slot.consulting_room_id, starts_at: intent.slot.starts_at, ends_at: intent.slot.ends_at, reason: intent.reason.trim(), symptoms: intent.symptoms.trim(), priority: 'normal', identity_confirmed: true } } }
}
export function definitiveBookingFailure(error: unknown) {
  const code = (error as { code?: string })?.code
  return Boolean(code && (/^(22|23|40|42)/.test(code) || ['P0001', 'PGRST202', 'PGRST204'].includes(code)))
}
export function availablePatientSlots(slots: Slot[], booked: { doctor_id: string; consulting_room_id: string; patient_id: string; starts_at: string; ends_at: string }[], doctorIds: Set<string>, patientId: string | null, now: number, doctorId?: string) {
  return slots.filter(s => doctorIds.has(s.doctor_id) && (!doctorId || s.doctor_id === doctorId) && new Date(s.starts_at).getTime() > now && !booked.some(b => (b.doctor_id === s.doctor_id || b.consulting_room_id === s.consulting_room_id || b.patient_id === patientId) && new Date(b.starts_at) < new Date(s.ends_at) && new Date(b.ends_at) > new Date(s.starts_at)))
}
export function sameSlot(a: Slot, b: Slot) {
  return a.doctor_id === b.doctor_id && a.consulting_room_id === b.consulting_room_id && new Date(a.starts_at).getTime() === new Date(b.starts_at).getTime() && new Date(a.ends_at).getTime() === new Date(b.ends_at).getTime()
}
/** Conflict raised by the appointments exclusion constraints (doctor, room or patient overlap). */
export function isSlotConflict(error: unknown) {
  return (error as { code?: string })?.code === '23P01'
}
