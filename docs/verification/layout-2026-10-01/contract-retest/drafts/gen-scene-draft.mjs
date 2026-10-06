// LEVEL_SCENE_DESIGN v0.1 配套：生成 scene-2d 取景草稿与 camera 草稿。
// 运行：bun .beegame/tmp/gen-scene-draft.mjs
// 仅用于 check-content.mjs --layout-draft / --camera-draft 几何验证，不进 content/。
const W = 1920, H = 1080, PPU = 100;

// 砖阵
const COLS = 10, ROWS = 6;
const BW = 152, BH = 48, GX = 16, GY = 14, MX = 128, MY = 120;
// 加固砖：r4（自下而上第二行）c2/c5/c8 为开场上升期的硬碰节拍；r1 两角为收尾顶扫节拍
const REINFORCED = new Set(["1,0", "1,9", "4,2", "4,5", "4,8"]);

// 挡板 / 球
const PADDLE_W = 220, PADDLE_H = 28;
const PADDLE_X = 960, PADDLE_Y = 960;
const BALL_SIZE = 28;
const BALL_READY_X = 960, BALL_READY_Y = 926; // 相对挡板中心偏移 (0,-34)

const nodes = [];

// 相机：位于场地中心，正交，letterbox contain
nodes.push({
  id: "main-camera",
  name: "Main Camera",
  enabled: true,
  transform: { position: [W / 2, H / 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  components: [
    {
      id: "cam-main",
      type: "camera",
      data: {
        orthographic: true,
        orthographicSize: (H / 2) / PPU, // 5.4 世界单位
        coordinateSpace: "logical-pixels",
        viewport: { width: W, height: H },
        framing: "letterbox",
      },
    },
  ],
});

// 场地结构（L3 占位尺寸）：三边结构光 + 底线
const wallThick = 8;
nodes.push(
  {
    id: "wall-top", name: "Top Wall", enabled: true,
    transform: { position: [W / 2, wallThick / 2, 0] },
    components: [{ id: "wall-top-rend", type: "sprite-renderer", data: { size: [W, wallThick] } }],
  },
  {
    id: "wall-left", name: "Left Wall", enabled: true,
    transform: { position: [wallThick / 2, H / 2, 0] },
    components: [{ id: "wall-left-rend", type: "sprite-renderer", data: { size: [wallThick, H] } }],
  },
  {
    id: "wall-right", name: "Right Wall", enabled: true,
    transform: { position: [W - wallThick / 2, H / 2, 0] },
    components: [{ id: "wall-right-rend", type: "sprite-renderer", data: { size: [wallThick, H] } }],
  },
  {
    id: "miss-line", name: "Miss Line", enabled: true,
    transform: { position: [W / 2, H - 3, 0] },
    components: [{ id: "miss-line-rend", type: "sprite-renderer", data: { size: [W, 6] } }],
  },
);

// 砖阵容器
nodes.push({
  id: "brick-grid",
  name: "Brick Grid",
  enabled: true,
  transform: { position: [0, 0, 0] },
});

for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const reinforced = REINFORCED.has(`${r},${c}`);
    nodes.push({
      id: `brick-r${r}-c${c}`,
      parentId: "brick-grid",
      name: reinforced ? "Reinforced Brick" : "Normal Brick",
      semantic: [reinforced ? "brick-reinforced" : "brick-normal"],
      enabled: true,
      transform: {
        position: [MX + BW / 2 + c * (BW + GX), MY + BH / 2 + r * (BH + GY), 0],
      },
      components: [
        {
          id: `brick-r${r}-c${c}-rend`,
          type: "sprite-renderer",
          data: { size: [BW, BH], brickType: reinforced ? "reinforced" : "normal" },
        },
      ],
    });
  }
}

// 挡板
nodes.push({
  id: "paddle",
  name: "Paddle",
  semantic: ["paddle"],
  enabled: true,
  transform: { position: [PADDLE_X, PADDLE_Y, 0] },
  components: [
    { id: "paddle-rend", type: "sprite-renderer", data: { size: [PADDLE_W, PADDLE_H] } },
  ],
});

// 球（Ready 附着位）
nodes.push({
  id: "ball",
  name: "Ball",
  semantic: ["ball"],
  enabled: true,
  transform: { position: [BALL_READY_X, BALL_READY_Y, 0] },
  components: [
    { id: "ball-rend", type: "sprite-renderer", data: { size: [BALL_SIZE, BALL_SIZE] } },
  ],
});

const scene = {
  schema: "beegame-content.v1",
  id: "breakout-level-1-draft",
  kind: "scene-2d",
  assetRefs: [],
  data: {
    settings: {
      coordinateSystem: {
        origin: "top-left",
        units: "logical-pixels",
        width: W,
        height: H,
        pixelsPerUnit: PPU,
      },
    },
    cameraNodeId: "main-camera",
    nodes,
  },
};

await Bun.write(new URL("./scene-draft.json", import.meta.url), JSON.stringify(scene, null, 2));

// camera-draft 输入：直接的 camera 字段（用于宽高比 letterbox 验证）
const cameraDraft = {
  orthographic: true,
  orthographicSize: (H / 2) / PPU,
  coordinateSpace: "logical-pixels",
  viewport: { width: W, height: H },
  framing: "letterbox",
  pixelsPerUnit: PPU,
};
await Bun.write(new URL("./camera-draft.json", import.meta.url), JSON.stringify(cameraDraft, null, 2));

console.log(`nodes=${nodes.length}, bricks=${ROWS * COLS}, reinforced=${REINFORCED.size}`);
