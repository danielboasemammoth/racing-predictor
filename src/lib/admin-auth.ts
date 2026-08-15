import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

const ADMIN_COOKIE = 'racing_admin_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8

function adminKey() {
  return process.env.ADMIN_API_KEY
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function sessionValue(key: string) {
  return createHmac('sha256', key).update('racing-predictor-admin-session').digest('hex')
}

export function isAdminConfigured() {
  return Boolean(adminKey())
}

export function isValidAdminKey(candidate: string) {
  const key = adminKey()
  return Boolean(key && safeEqual(candidate, key))
}

export async function hasAdminSession() {
  const key = adminKey()
  const candidate = (await cookies()).get(ADMIN_COOKIE)?.value
  return Boolean(key && candidate && safeEqual(candidate, sessionValue(key)))
}

export async function createAdminSession() {
  const key = adminKey()
  if (!key) throw new Error('ADMIN_API_KEY is not configured')

  const cookieStore = await cookies()
  cookieStore.set(ADMIN_COOKIE, sessionValue(key), {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  })
}

export async function clearAdminSession() {
  (await cookies()).delete(ADMIN_COOKIE)
}