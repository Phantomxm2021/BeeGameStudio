import { describe, expect, test } from 'bun:test'
import { multiEditDiffConfigForInput } from './MultiEditPermissionRequest.js'

describe('MultiEditPermissionRequest', () => {
  test('shows one multiple-edit diff with the declared edit order', () => {
    expect(
      multiEditDiffConfigForInput({
        file_path: '/project/GDD.md',
        edits: [
          { old_string: 'one', new_string: 'ONE', replace_all: false },
          { old_string: 'two', new_string: 'TWO', replace_all: true },
        ],
      }),
    ).toEqual({
      filePath: '/project/GDD.md',
      edits: [
        { old_string: 'one', new_string: 'ONE', replace_all: false },
        { old_string: 'two', new_string: 'TWO', replace_all: true },
      ],
      editMode: 'multiple',
    })
  })
})
