// 生成 content/ui/ 下全部最终 UI 布局输入（作者批次 4/5）
// 用法：bun .beegame/tmp/gen-ui-layouts.mjs
// 所有尺寸单位：最终宿主逻辑像素（host logical px）；相机平面内节点例外（1920x1080 设计坐标，经相机投影）。
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const OUT = join(ROOT, "content/ui");

// ---- 共享令牌（与 ART_DIRECTION §3/§13 对齐；具体值只在此声明一次）----
const C = {
  ink: "#0F0F22",
  panel: "#1B1D3D",
  text: "#F3F4FF",
  sub: "#9FA3C7",
  gold: "#FFD166",
  danger: "#FF5C7A",
  ball: "#FFF6BF",
  structure: "#2A2D5C",
  coral: "#FF6B6B",
  orange: "#FF914D",
  green: "#6FCF8F",
  blue: "#5AA9FF",
  purple: "#9B7EDE",
};

// 通用样式片段
const S = {
  panel: { background: { color: C.panel, opacity: 0.9, radius: 18 }, border: { width: 3, color: C.ink, radius: 18 } },
  box: { background: { color: C.panel, opacity: 0.85, radius: 10 }, border: { width: 3, color: C.ink, radius: 10 } },
  goldBtn: { background: { color: C.gold, radius: 12 }, border: { width: 3, color: C.ink, radius: 12 } },
  ghostBtn: { background: { color: C.panel, opacity: 0.85, radius: 12 }, border: { width: 3, color: C.text, radius: 12 } },
  dim: { background: { color: "#0C0C1E", opacity: 0.62 } },
  bg: { gradient: ["#1E1E42", "#13132B"] },
};

let nodes = [];
const N = (o) => { nodes.push(o); return o.id; };

// 便捷构造
function text(id, parentId, t, x, y, w, h, style, extra = {}) {
  N({ id, parentId, role: "text", text: t, layout: { anchor: "top-left", position: [x, y], size: [w, h] }, style, ...extra });
  return id;
}
function shape(id, parentId, x, y, w, h, style, layoutExtra = {}) {
  N({ id, parentId, role: "shape", layout: { anchor: "top-left", position: [x, y], size: [w, h], ...layoutExtra }, style });
  return id;
}
function stretch(id, parentId, style, anchorMin = [0, 0], anchorMax = [1, 1], sizeDelta = [0, 0]) {
  N({ id, parentId, role: "shape", layout: { anchorMin, anchorMax, sizeDelta, position: [0, 0] }, style });
  return id;
}
function centeredText(id, parentId, t, w, h, style) {
  N({ id, parentId, role: "text", text: t, layout: { anchor: "middle-center", position: [0, 0], size: [w, h] }, style });
  return id;
}
function button(id, parentId, x, y, w, h, label, style, actions) {
  N({ id, parentId, role: "button", actions, layout: { anchor: "top-left", position: [x, y], size: [w, h] }, style });
  centeredText(`${id}-label`, id, label, w, 32, { fontSize: 22, color: style === S.goldBtn ? C.ink : C.text, align: "center", lineHeight: 32 });
  return id;
}

// ---- 文档外壳 ----
const commonRootData = {
  orientation: "Landscape",
  referenceResolution: [1920, 1080],
  targetViewports: [[960, 540], [1920, 1080], [2560, 1080]],
  minimumControlSize: [44, 44],
};
function doc(id, kind, rootRole, rootId, rootDataExtra = {}) {
  const docObj = { schema: "beegame-content.v1", id, kind, assetRefs: [], data: { rootId, nodes } };
  N({ id: rootId, role: rootRole, data: { ...commonRootData, ...rootDataExtra } });
  return docObj;
}

// =========================================================================
// 1) game-hud.json —— Ready/Playing 场内合成：game-view + 相机平面 + HUD
// =========================================================================
function gameHud() {
  nodes = [];
  const d = doc("breakout-game-hud", "ui-hud", "hud-root", "game-hud-root", {
    layoutCamera: { nodeId: "game-view", path: ".beegame/tmp/camera-draft.json" },
  });
  // game-view：拉伸填满实际视口；相机 letterbox 在其内计算
  N({ id: "game-view", parentId: "game-hud-root", role: "container", layout: { anchorMin: [0, 0], anchorMax: [1, 1], sizeDelta: [0, 0], position: [0, 0] } });
  // 相机参考平面：尺寸必须等于相机 viewport；item.absolute 退出父排版
  N({ id: "camera-plane", parentId: "game-view", role: "container", data: { space: "camera-reference-2d" }, layout: { anchor: "top-left", position: [0, 0], size: [1920, 1080], item: { absolute: true } } });
  // Ready 发球提示（相机平面坐标，随场地投影；仅 Ready 态显示）
  text("ready-prompt-primary", "camera-plane", "按 空格 或点击屏幕 发球", 620, 688, 680, 48,
    { fontSize: 34, color: C.text, align: "center", lineHeight: 48 });
  text("ready-prompt-sub", "camera-plane", "方向键 / A·D 移动挡板", 620, 744, 680, 32,
    { fontSize: 22, color: C.sub, align: "center", lineHeight: 32 });
  // HUD 条：上沿，满宽，固定高
  N({ id: "hud-strip", parentId: "game-view", role: "container", layout: { anchorMin: [0, 0], anchorMax: [1, 0], sizeDelta: [0, 52], position: [0, 0] } });
  // 分数盒（左上）
  N({ id: "score-box", parentId: "hud-strip", role: "container", layout: { anchor: "top-left", position: [24, 2], size: [220, 48] }, style: S.box });
  text("score-label", "score-box", "分数", 14, 4, 60, 16, { fontSize: 14, color: C.sub, lineHeight: 16 });
  text("score-value", "score-box", "0000", 14, 23, 192, 24,
    { fontSize: 24, color: C.text, lineHeight: 26, fontVariant: "tabular-nums" },
    { bindings: { text: "hud.score" } });
  // 生命组（居中）
  N({ id: "lives-group", parentId: "hud-strip", role: "container", layout: { anchor: "top-center", position: [0, 10], size: [120, 32] } });
  [["life-1", 0], ["life-2", 46], ["life-3", 92]].forEach(([id, x]) =>
    shape(id, "lives-group", x, 2, 28, 28, { background: { color: C.ball, radius: 14 }, border: { width: 3, color: C.ink, radius: 14 } }));
  // 暂停按钮（右上，触控可见入口）；data.anchor 显式右上枢轴
  N({ id: "pause-button", parentId: "hud-strip", role: "button", actions: { activate: "pause" },
    layout: { anchor: "top-right", position: [-24, 4], size: [88, 44] }, style: S.box, data: { anchor: { x: 1, y: 0 } } });
  shape("pause-bar-1", "pause-button", 24, 14, 6, 16, { background: { color: C.text, radius: 2 } });
  shape("pause-bar-2", "pause-button", 36, 14, 6, 16, { background: { color: C.text, radius: 2 } });
  text("pause-text", "pause-button", "暂停", 50, 12, 36, 20, { fontSize: 16, color: C.text, lineHeight: 20 });
  return d;
}

// =========================================================================
// 2) loading-screen.json
// =========================================================================
function loadingScreen() {
  nodes = [];
  const d = doc("breakout-loading", "ui-screen", "screen-root", "loading-root");
  stretch("loading-bg", "loading-root", S.bg);
  N({ id: "loading-column", parentId: "loading-root", role: "container",
    layout: { anchor: "middle-center", position: [0, 0], size: [360, 204], container: { direction: "column", gap: 20, padding: [24, 24, 24, 24], align: "center", justify: "center" } } });
  shape("loading-spinner", "loading-column", 0, 0, 48, 48, { background: { color: C.gold, radius: 24 }, border: { width: 3, color: C.ink, radius: 24 } });
  text("loading-text", "loading-column", "加载中…", 60, 8, 240, 32, { fontSize: 24, color: C.text, align: "center", lineHeight: 32 });
  shape("progress-track", "loading-column", 24, 0, 312, 14, { background: { color: C.structure, radius: 7 } });
  shape("progress-fill", "progress-track", 2, 2, 150, 10, { background: { color: C.gold, radius: 5 } });
  return d;
}

// =========================================================================
// 3) loading-error-screen.json —— Loading 失败可重试
// =========================================================================
function loadingError() {
  nodes = [];
  const d = doc("breakout-loading-error", "ui-screen", "screen-root", "loading-error-root");
  stretch("loading-error-bg", "loading-error-root", S.bg);
  N({ id: "error-column", parentId: "loading-error-root", role: "container",
    layout: { anchor: "middle-center", position: [0, 0], size: [440, 300], container: { direction: "column", gap: 18, padding: [28, 32, 28, 32], align: "center", justify: "center" } } });
  shape("error-icon", "error-column", 0, 0, 48, 48, { background: { color: C.danger, radius: 24 }, border: { width: 3, color: C.ink, radius: 24 } });
  text("error-title", "error-column", "加载失败", 60, 6, 320, 36, { fontSize: 30, color: C.text, align: "center", lineHeight: 36 });
  text("error-message", "error-column", "资源加载未完成，请检查网络后重试。", 40, 0, 360, 48, { fontSize: 18, color: C.sub, align: "center", lineHeight: 24 });
  N({ id: "retry-load-button", parentId: "error-column", role: "button", actions: { activate: "retry-loading" },
    layout: { anchor: "top-left", position: [110, 0], size: [220, 56] }, style: S.goldBtn });
  centeredText("retry-load-button-label", "retry-load-button", "重试", 220, 28, { fontSize: 22, color: C.ink, align: "center", lineHeight: 28 });
  return d;
}

// =========================================================================
// 4) rotate-screen.json —— 竖版 / 小于 960x540
// =========================================================================
function rotateScreen() {
  nodes = [];
  const d = doc("breakout-rotate", "ui-screen", "screen-root", "rotate-root");
  stretch("rotate-bg", "rotate-root", S.bg);
  N({ id: "rotate-column", parentId: "rotate-root", role: "container",
    layout: { anchor: "middle-center", position: [0, 0], size: [508, 280], container: { direction: "column", gap: 20, padding: [24, 24, 24, 24], align: "center" } } });
  // 旋转图标：圆环 + 箭头（作者化形状，运行时可换 assetRef 图形但矩形不变）
  shape("rotate-icon", "rotate-column", 206, 0, 96, 96, { border: { width: 3, color: C.ink, radius: 48 } });
  shape("rotate-icon-arrow", "rotate-icon", 40, 10, 20, 20, { background: { color: C.gold, radius: 4 }, border: { width: 3, color: C.ink, radius: 4 } });
  text("rotate-title", "rotate-column", "请旋转设备至横版", 24, 0, 460, 40, { fontSize: 30, color: C.text, align: "center", lineHeight: 40 });
  text("rotate-body", "rotate-column", "也可请扩大窗口（至少 960×540）。恢复后将自动返回此前界面。", 24, 0, 460, 48,
    { fontSize: 18, color: C.sub, align: "center", lineHeight: 24 });
  return d;
}

// =========================================================================
// 5) start-screen.json
// =========================================================================
function startScreen() {
  nodes = [];
  const d = doc("breakout-start", "ui-screen", "screen-root", "start-root");
  stretch("start-bg", "start-root", S.bg);
  // 右上音量入口
  N({ id: "start-volume-button", parentId: "start-root", role: "button", actions: { activate: "open-volume" },
    layout: { anchor: "top-right", position: [-24, 24], size: [128, 48] }, style: S.ghostBtn, data: { anchor: { x: 1, y: 0 } } });
  shape("start-volume-icon", "start-volume-button", 16, 15, 20, 18, { background: { color: C.text, radius: 3 } });
  text("start-volume-text", "start-volume-button", "音量", 44, 12, 64, 24, { fontSize: 18, color: C.text, lineHeight: 24 });
  // 居中主列
  N({ id: "start-column", parentId: "start-root", role: "container",
    layout: { anchor: "middle-center", position: [0, 0], size: [600, 480], container: { direction: "column", gap: 18, padding: [28, 24, 28, 24], align: "center" } } });
  text("game-title", "start-column", "打砖块", 24, 0, 552, 96,
    { fontSize: 80, color: C.text, align: "center", lineHeight: 96 });
  // 母题区：球沿上扬弧弹起，弧端指小砖簇（普通形，数量克制）
  N({ id: "title-motif", parentId: "start-column", role: "container", layout: { anchor: "top-left", position: [24, 0], size: [552, 120] } });
  shape("motif-ball", "title-motif", 140, 44, 64, 64,
    { background: { color: C.ball, radius: 32 }, border: { width: 5, color: C.ink, radius: 32 } });
  shape("motif-arc", "title-motif", 180, 62, 220, 8,
    { background: { color: C.ink, radius: 4 } }, { rotation: -0.28 });
  shape("motif-brick-1", "title-motif", 360, 18, 40, 26, { background: { color: C.coral, radius: 4 }, border: { width: 3, color: C.ink, radius: 4 } });
  shape("motif-brick-2", "title-motif", 406, 18, 40, 26, { background: { color: C.blue, radius: 4 }, border: { width: 3, color: C.ink, radius: 4 } });
  shape("motif-brick-3", "title-motif", 337, 52, 40, 26, { background: { color: C.orange, radius: 4 }, border: { width: 3, color: C.ink, radius: 4 } });
  shape("motif-brick-4", "title-motif", 383, 52, 40, 26, { background: { color: C.green, radius: 4 }, border: { width: 3, color: C.ink, radius: 4 } });
  shape("motif-brick-5", "title-motif", 429, 52, 40, 26, { background: { color: C.purple, radius: 4 }, border: { width: 3, color: C.ink, radius: 4 } });
  // 最高分盒
  N({ id: "highscore-box", parentId: "start-column", role: "container", layout: { anchor: "top-left", position: [140, 0], size: [320, 48] }, style: S.box });
  text("highscore-label", "highscore-box", "最高分", 20, 12, 72, 24, { fontSize: 16, color: C.sub, lineHeight: 24 });
  text("highscore-value", "highscore-box", "0000", 104, 10, 196, 28,
    { fontSize: 22, color: C.sub, lineHeight: 28, fontVariant: "tabular-nums" },
    { bindings: { text: "game.highScore" } });
  // 主按钮
  N({ id: "start-game-button", parentId: "start-column", role: "button", actions: { activate: "start-game" },
    layout: { anchor: "top-left", position: [160, 0], size: [280, 64] }, style: S.goldBtn });
  centeredText("start-game-button-label", "start-game-button", "开始游戏", 280, 32, { fontSize: 24, color: C.ink, align: "center", lineHeight: 32 });
  text("start-hints", "start-column", "空格 发球 · Esc 暂停 · 支持鼠标与触控", 40, 0, 520, 24,
    { fontSize: 16, color: C.sub, align: "center", lineHeight: 24 });
  return d;
}

// =========================================================================
// 6) pause-screen.json
// =========================================================================
function pauseScreen() {
  nodes = [];
  const d = doc("breakout-pause", "ui-screen", "screen-root", "pause-root");
  stretch("pause-dim", "pause-root", S.dim);
  N({ id: "pause-panel", parentId: "pause-root", role: "container",
    layout: { anchor: "middle-center", position: [0, 0], size: [480, 360], container: { direction: "column", gap: 16, padding: [28, 32, 28, 32], align: "center" } }, style: S.panel });
  text("pause-title", "pause-panel", "已暂停", 32, 0, 416, 40, { fontSize: 32, color: C.text, align: "center", lineHeight: 40 });
  button("continue-button", "pause-panel", 0, 0, 416, 56, "继续游戏", S.goldBtn, { activate: "resume" });
  button("pause-retry-button", "pause-panel", 0, 0, 416, 48, "再来一局", S.ghostBtn, { activate: "retry" });
  button("pause-back-button", "pause-panel", 0, 0, 416, 48, "返回开始界面", S.ghostBtn, { activate: "back-to-start" });
  button("pause-volume-button", "pause-panel", 0, 0, 416, 48, "音量设置", S.ghostBtn, { activate: "open-volume" });
  return d;
}

// =========================================================================
// 7) volume-settings-screen.json（Start / Paused 共用）
// =========================================================================
function volumeScreen() {
  nodes = [];
  const d = doc("breakout-volume-settings", "ui-screen", "screen-root", "volume-root");
  stretch("volume-dim", "volume-root", S.dim);
  N({ id: "volume-panel", parentId: "volume-root", role: "container",
    layout: { anchor: "middle-center", position: [0, 0], size: [480, 418], container: { direction: "column", gap: 14, padding: [28, 32, 28, 32], align: "center" } }, style: S.panel });
  text("volume-title", "volume-panel", "音量设置", 32, 0, 416, 34, { fontSize: 28, color: C.text, align: "center", lineHeight: 34 });
  // 总静音行
  N({ id: "mute-row", parentId: "volume-panel", role: "container",
    layout: { anchor: "top-left", position: [0, 0], size: [416, 44], container: { direction: "row", gap: 12, padding: [0, 0, 0, 0], justify: "start", align: "center" } } });
  text("mute-label", "mute-row", "总静音", 0, 8, 120, 28, { fontSize: 20, color: C.text, lineHeight: 28 });
  N({ id: "master-mute-toggle", parentId: "mute-row", role: "toggle", actions: { activate: "toggle-master-mute" },
    layout: { anchor: "top-left", position: [0, 0], size: [56, 44] } });
  shape("mute-box", "master-mute-toggle", 14, 8, 28, 28, { border: { width: 3, color: C.ink, radius: 6 } });
  shape("mute-check", "mute-box", 6, 7, 16, 12, { background: { color: C.gold, radius: 2 } });
  // 音乐
  text("music-label", "volume-panel", "音乐音量", 0, 0, 416, 24, { fontSize: 18, color: C.sub, lineHeight: 24 });
  N({ id: "music-slider", parentId: "volume-panel", role: "slider", actions: { adjust: "music-volume" },
    layout: { anchor: "top-left", position: [0, 0], size: [416, 48] } });
  shape("music-track", "music-slider", 22, 19, 372, 10, { background: { color: C.structure, radius: 5 } });
  shape("music-fill", "music-slider", 22, 19, 180, 10, { background: { color: C.gold, radius: 5 } });
  shape("music-thumb", "music-slider", 190, 10, 28, 28, { background: { color: C.ball, radius: 14 }, border: { width: 3, color: C.ink, radius: 14 } });
  // 音效
  text("sfx-label", "volume-panel", "音效音量", 0, 0, 416, 24, { fontSize: 18, color: C.sub, lineHeight: 24 });
  N({ id: "sfx-slider", parentId: "volume-panel", role: "slider", actions: { adjust: "sfx-volume" },
    layout: { anchor: "top-left", position: [0, 0], size: [416, 48] } });
  shape("sfx-track", "sfx-slider", 22, 19, 372, 10, { background: { color: C.structure, radius: 5 } });
  shape("sfx-fill", "sfx-slider", 22, 19, 180, 10, { background: { color: C.gold, radius: 5 } });
  shape("sfx-thumb", "sfx-slider", 190, 10, 28, 28, { background: { color: C.ball, radius: 14 }, border: { width: 3, color: C.ink, radius: 14 } });
  button("volume-done-button", "volume-panel", 0, 0, 416, 56, "完成", S.goldBtn, { activate: "close-volume" });
  return d;
}

// =========================================================================
// 8/9) win-screen.json / game-over-screen.json
// =========================================================================
function resultScreen(kindId, fileId, rootId, titleText, titleColor, defaultValue) {
  nodes = [];
  const d = doc(fileId, "ui-screen", "screen-root", rootId);
  stretch(`${kindId}-dim`, rootId, S.dim);
  N({ id: `${kindId}-panel`, parentId: rootId, role: "container",
    layout: { anchor: "middle-center", position: [0, 0], size: [520, 420], container: { direction: "column", gap: 16, padding: [28, 32, 28, 32], align: "center" } }, style: S.panel });
  text(`${kindId}-title`, `${kindId}-panel`, titleText, 32, 0, 456, 44,
    { fontSize: 36, color: titleColor, align: "center", lineHeight: 44 });
  N({ id: `${kindId}-score-box`, parentId: `${kindId}-panel`, role: "container",
    layout: { anchor: "top-left", position: [0, 0], size: [456, 112], container: { direction: "column", gap: 4, padding: [12, 16, 12, 16], align: "center" } }, style: S.box });
  text(`${kindId}-score-label`, `${kindId}-score-box`, "本局得分", 16, 0, 424, 24, { fontSize: 16, color: C.sub, align: "center", lineHeight: 24 });
  text(`${kindId}-score-value`, `${kindId}-score-box`, defaultValue, 16, 0, 424, 60,
    { fontSize: 52, color: C.text, align: "center", lineHeight: 60, fontVariant: "tabular-nums" },
    { bindings: { text: "result.score" } });
  // 新纪录牌（运行时无纪录则 enabled:false）
  N({ id: `${kindId}-record-badge`, parentId: `${kindId}-panel`, role: "container",
    layout: { anchor: "top-left", position: [0, 0], size: [456, 40] },
    style: { background: { color: C.gold, opacity: 0.18, radius: 10 }, border: { width: 3, color: C.gold, radius: 10 } } });
  centeredText(`${kindId}-record-text`, `${kindId}-record-badge`, "新纪录！", 456, 24,
    { fontSize: 20, color: C.gold, align: "center", lineHeight: 24 });
  button(`${kindId}-retry-button`, `${kindId}-panel`, 0, 0, 456, 56, "再来一局", S.goldBtn, { activate: "retry" });
  button(`${kindId}-back-button`, `${kindId}-panel`, 0, 0, 456, 48, "返回开始界面", S.ghostBtn, { activate: "back-to-start" });
  return d;
}

// ---- 输出 ----
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const files = [
  ["game-hud.json", gameHud()],
  ["loading-screen.json", loadingScreen()],
  ["loading-error-screen.json", loadingError()],
  ["rotate-screen.json", rotateScreen()],
  ["start-screen.json", startScreen()],
  ["pause-screen.json", pauseScreen()],
  ["volume-settings-screen.json", volumeScreen()],
  ["win-screen.json", resultScreen("win", "breakout-win", "win-root", "通关！", C.gold, "3250")],
  ["game-over-screen.json", resultScreen("gameover", "breakout-game-over", "gameover-root", "游戏结束", C.danger, "0000")],
];
for (const [name, d] of files) {
  writeFileSync(join(OUT, name), JSON.stringify(d, null, 2) + "\n");
  console.log("wrote", name, d.data.nodes.length, "nodes");
}
