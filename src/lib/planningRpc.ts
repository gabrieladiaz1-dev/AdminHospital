type ServiceError = { code?: string; message?: string; status?: number }
export interface PlanningTransport {
  auth: { getSession: () => Promise<{ data: { session: unknown | null }; error: unknown }> }
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: ServiceError | null; status?: number }>
}
export function planningError(operation: string, error: unknown, status?: number) {
  const source = error as ServiceError | null
  const code = source?.code ?? ''
  const detail = source?.message ?? (error instanceof Error ? error.message : '')
  let category = 'backend', text = detail || 'El servidor no devolvió un resultado válido.', finalCode = code || 'BACKEND_ERROR'
  if (code === 'AUTH_SESSION_MISSING' || /session missing|refresh.token|invalid.*jwt|jwt.*expired/i.test(detail) || ['PGRST301', 'PGRST302', 'PGRST303'].includes(code)) {
    category = 'authentication'; finalCode = 'AUTH_SESSION_MISSING'; text = 'La sesión ADMIN falta o venció. Inicia sesión nuevamente para consultar o guardar jornadas.'
  } else if (/api.?key/i.test(detail) && status === 401) {
    category = 'configuration'; finalCode = 'API_KEY_INVALID'; text = 'Supabase rechazó la clave pública configurada para este proyecto.'
  } else if (code === '42501') {
    category = /row.level|policy|rls/i.test(detail) ? 'rls' : 'permissions'
    text = category === 'rls' ? 'Una política RLS del servidor rechazó esta operación para tu sesión.' : 'La sesión no tiene el rol administrador activo o permiso para ejecutar esta función.'
  } else if (['PGRST202', '42883'].includes(code)) {
    category = 'rpc'; text = 'Supabase no encuentra esta RPC con los parámetros enviados. Comprueba la firma publicada y la caché del API.'
  } else if (code === 'PGRST203') {
    category = 'rpc'; text = 'Supabase encuentra varias firmas de esta RPC y no puede resolver la operación.'
  } else if (code === '23P01') {
    category = 'conflict'; text = /recurring_fixed_room_excl|consulting_room_id/i.test(detail) ? 'El consultorio ya está asignado a otro doctor en esas fechas. Elige otro consultorio o ajusta la vigencia.' : /recurring_employee_weekdays_excl/i.test(detail) ? 'El empleado ya tiene una jornada en esos días y fechas. Edita la jornada existente.' : detail && !/conflicting key|exclusion constraint/i.test(detail) ? detail : 'La jornada o el consultorio se superponen con otra asignación. Revisa los días y la vigencia.'
  } else if (code === '40001') {
    category = 'conflict'; text = 'La jornada cambió desde que la abriste. Actualiza los datos antes de volver a editar.'
  } else if (code === '23505') {
    category = 'conflict'; text = detail && !/duplicate key/i.test(detail) ? detail : 'Ya existe un registro incompatible con esta operación.'
  } else if (!code && (/fetch|network|timeout|abort|ECONN|ENOTFOUND|EACCES/i.test(detail) || error instanceof TypeError || status === 0)) {
    category = 'network'; finalCode = 'NETWORK_ERROR'; text = 'No se pudo alcanzar el API de Supabase. Comprueba tu conexión; si estabas guardando, reintenta la misma operación para confirmar su resultado.'
  }
  return Object.assign(new Error(`${text} [${operation} · ${finalCode}]`), { code: finalCode, category, operation })
}
export async function invokePlanningRpc<T>(client: PlanningTransport, operation: string, args: Record<string, unknown>): Promise<T> {
  let session: unknown
  try {
    const auth = await client.auth.getSession()
    if (auth.error) throw auth.error
    session = auth.data.session
  } catch (error) { throw planningError(operation, error) }
  if (!session) throw planningError(operation, { code: 'AUTH_SESSION_MISSING' })
  // The shared Supabase client attaches and refreshes this user's JWT. Never use an anon
  // Authorization header or a service key in the browser to bypass session permissions.
  try {
    const result = await client.rpc(operation, args)
    if (result.error) throw planningError(operation, result.error, result.status)
    return result.data as T
  } catch (error) {
    if ((error as { operation?: string })?.operation === operation) throw error
    throw planningError(operation, error)
  }
}
