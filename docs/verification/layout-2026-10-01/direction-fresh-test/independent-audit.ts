// Read frozen evidence, not the live project. No model calls or source revisions.
import { join } from 'node:path'

const root = import.meta.dir
const scene = await Bun.file(join(root, 'drafts/scene-draft.json')).json()
const paddle = scene.data.nodes.find((node: any) => node.id === 'paddle')
const ball = scene.data.nodes.find((node: any) => node.id === 'ball')
const bricks = scene.data.nodes.filter((node: any) => node.semantic?.includes('brick'))
const radius = ball.components.find((component: any) => component.type === 'circle-collider-2d').data.radius
const paddleHeight = paddle.components.find((component: any) => component.type === 'box-collider-2d').data.size[1]
const brickBottom = Math.max(...bricks.map((node: any) => node.transform.position[1] +
  node.components.find((component: any) => component.type === 'box-collider-2d').data.size[1] / 2))
const paddleContactCenterY = paddle.transform.position[1] - paddleHeight / 2 - radius
const brickExitCenterY = brickBottom + radius
const balance = await Bun.file(join(root, 'final/docs/BALANCE_DESIGN.md')).text()
const speed = Number(balance.match(/球速 `ballSpeed` \| \*\*(\d+)/)![1])
const keyboardSpeed = Number(balance.match(/`paddleKeyboardSpeed` \| \*\*(\d+)/)![1])
const maximumAngle = Number(balance.match(/`maxDeflection` \| \*\*(\d+)/)![1])
const rows = [...new Set(bricks.map((node: any) => node.transform.position[1]))].sort((a: any, b: any) => a - b)
const observations = {
  provenance: 'Numbers read from frozen scene draft and final BALANCE release table; comparison claims from LEVEL §1/3.2 and BALANCE §1/4.1/4.3.',
  rowsFromTopToBottom: rows.map(y => {
    const members = bricks.filter((node: any) => node.transform.position[1] === y)
    return { centerY: y, names: members.map((node: any) => node.name),
      hp: [...new Set(members.map((node: any) => node.data.behaviors[0].config.hp))] }
  }),
  statedTopTwoRowsHp: 2,
  actualTopTwoRowsHp: rows.slice(0, 2).map(y => bricks.find((node: any) => node.transform.position[1] === y).data.behaviors[0].config.hp),
  keyboardSpeed, ballMaximumHorizontalSpeed: speed * Math.sin(maximumAngle * Math.PI / 180),
  statedKeyboardSlower: balance.includes('速度略慢于球的最快水平速度'),
  actualKeyboardSlower: keyboardSpeed < speed * Math.sin(maximumAngle * Math.PI / 180),
  contactWindowExample: { caveat: 'Vertical unobstructed descent from the lowest brick bottom surface to paddle top; not all-angle or all-state fairness proof.',
    radius, brickBottom, brickExitCenterY, paddleContactCenterY,
    distance: paddleContactCenterY - brickExitCenterY,
    timeAtReleaseBallSpeed: (paddleContactCenterY - brickExitCenterY) / speed,
    documentedCenterlineTime: (paddle.transform.position[1] - brickBottom) / speed,
    rescueExample200pxSeconds: 200 / keyboardSpeed },
}
console.log(JSON.stringify(observations, null, 2))
