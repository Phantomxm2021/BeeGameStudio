// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { closeResourceLibraryRoute, isResourceLibraryRoute, openResourceLibraryRoute } from './resourceLibraryRoute'

describe('resource library URL route', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/')
  })

  test('survives a reload because the open state is encoded in the URL', () => {
    expect(isResourceLibraryRoute()).toBe(false)
    openResourceLibraryRoute()
    expect(window.location.search).toBe('?resourceLibrary=1')
    expect(isResourceLibraryRoute()).toBe(true)
    closeResourceLibraryRoute()
    expect(isResourceLibraryRoute()).toBe(false)
  })
})
