'use server'

import { redirect } from 'next/navigation'
import {
  clearAdminSession,
  createAdminSession,
  isAdminConfigured,
  isValidAdminKey,
} from '@/lib/admin-auth'

export async function login(formData: FormData) {
  const key = formData.get('key')
  if (!isAdminConfigured()) redirect('/admin?error=config')
  if (typeof key !== 'string' || !isValidAdminKey(key)) redirect('/admin?error=invalid')

  await createAdminSession()
  redirect('/admin')
}

export async function logout() {
  await clearAdminSession()
  redirect('/admin')
}