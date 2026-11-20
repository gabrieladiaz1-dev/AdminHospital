import type { Page } from '../types'

const endpointConnectedPages = new Set<Page>([
  'Laboratorios',
  'Ambulancia',
  'Configuración',
  'Mi perfil',
  'Acerca del hospital',
  'Cómo llegar',
  'Recepción',
  'Habitaciones y Camas',
  'Resumen general',
  'Personal hospitalario',
  'Horarios y turnos',
  'Farmacia',
])

export function isEndpointConnectedPage(page: Page): boolean {
  return endpointConnectedPages.has(page)
}
