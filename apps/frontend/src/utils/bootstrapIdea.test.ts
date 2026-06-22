import { describe, expect, it } from 'vitest'

import { buildBootstrapPayload } from './bootstrapIdea'

describe('buildBootstrapPayload', () => {
  it('keeps snake game ideas as plain text', () => {
    const payload = buildBootstrapPayload('做一个贪吃蛇游戏')

    expect(payload).toEqual({ idea: '做一个贪吃蛇游戏' })
  })

  it('keeps other ideas as plain text', () => {
    const payload = buildBootstrapPayload('做一个塔防游戏')

    expect(payload).toEqual({ idea: '做一个塔防游戏' })
  })

  it('attaches selected clarification patch when provided', () => {
    const payload = buildBootstrapPayload('贪吃蛇游戏', {
      platform: 'Web Browser',
      input_mode: 'Keyboard Arrow Keys',
      visual_style: 'Simple 2D Grid',
      gameplay_direction: 'Classic Snake',
      mvp_focus: 'Movement and score display',
    }, 'zh')

    expect(payload).toEqual({
      idea: '贪吃蛇游戏',
      clarification: {
        platform: 'Web Browser',
        input_mode: 'Keyboard Arrow Keys',
        visual_style: 'Simple 2D Grid',
        gameplay_direction: 'Classic Snake',
        mvp_focus: 'Movement and score display',
      },
      language: 'zh',
    })
  })
})
