import { request } from './client'

export interface JellyAccountState {
  id: string
  name: string
  companyName: string
  status: string
  creditsBalance: number
  creditsReserved: number
  creditsToday: number
  expiresAt: string | null
  skills: string[]
}

export function fetchJellyAccountState(): Promise<JellyAccountState> {
  return request<JellyAccountState>('/api/jelly/cloud/me')
}

export function logoutJellyCloudSession(): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/api/jelly/cloud/logout', { method: 'POST' })
}
