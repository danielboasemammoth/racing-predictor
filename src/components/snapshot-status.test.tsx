import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { SnapshotStatus } from './snapshot-status'

afterEach(() => vi.unstubAllGlobals())

it('renders a labelled UTC fallback instead of presenting Melbourne time as local time', () => {
  vi.stubGlobal('React', React)
  const html = renderToStaticMarkup(<SnapshotStatus generatedAt="2026-10-10T04:09:41.587Z" />)
  expect(html).toContain('04:09 am UTC')
  expect(html).toContain('dateTime="2026-10-10T04:09:41.587Z"')
  expect(html).not.toContain('03:09 pm')
})

it('retains the missing-snapshot status', () => {
  vi.stubGlobal('React', React)
  expect(renderToStaticMarkup(<SnapshotStatus generatedAt={undefined} />)).toContain('Waiting for a successful refresh.')
})