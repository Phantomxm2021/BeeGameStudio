// One-off generator for author-batch-3 editable UI inputs in content/ui.
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("content/ui", { recursive: true });

const rootMeta = {
  orientation: "Landscape",
  referenceResolution: [960, 540],
  targetViewports: [[960, 540], [1200, 540], [960, 600], [1280, 720]],
  minimumControlSize: [44, 44],
};

const stretch = { anchorMin: [0, 0], anchorMax: [1, 1], sizeDelta: [0, 0] };
const topBar = { anchorMin: [0, 0], anchorMax: [1, 0], sizeDelta: [0, 56] };

const doc = (id, kind, nodes) => ({
  schema: "beegame-content.v1",
  id,
  kind,
  assetRefs: [],
  data: { rootId: "root", nodes, ...rootMeta },
});

const root = (role, extra = {}) => ({
  id: "root",
  role,
  enabled: true,
  ...extra,
  layout: { anchorMin: [0, 0], anchorMax: [1, 1], sizeDelta: [0, 0] },
});

function n(id, role, layout, { text, style, name, data, enabled = true, parentId } = {}) {
  const node = { id, role, enabled };
  if (name) node.name = name;
  if (parentId) node.parentId = parentId;
  if (layout) node.layout = layout;
  if (text !== undefined) node.text = text;
  if (style) node.style = style;
  if (data) node.data = data;
  return node;
}

const col = (gap, justify = "center", align = "center", padding) => ({
  container: { direction: "column", gap, justify, align, ...(padding ? { padding } : {}) },
});
const rowC = (gap, justify = "center", align = "center") => ({ container: { direction: "row", gap, justify, align } });

const btnPrimary = { background: { color: "#29D3E0", radius: 14 }, color: "#0A1030", fontSize: 22, fontWeight: "bold" };
const panelBg = { background: { color: "#1B1840", opacity: 0.96, radius: 18 }, border: { width: 2, color: "#3A3580", radius: 18 } };

// ---------- HUD ----------
{
  const nodes = [
    root("hud-root"),
    n("bar", "container", { anchorMin: [0, 0], anchorMax: [1, 0], sizeDelta: [0, 56] }, {
      style: { background: { color: "#0E0C26", opacity: 0.72 } },
      data: { ...rowC(0, "space-between", "center", [0, 24, 0, 24]) },
    }),
    n("score-label", "text", { anchor: "middle-left", position: [0, 0], size: [180, 32] }, {
      parentId: "bar", text: "分数 0", style: { fontSize: 22, color: "#F4F2FF", align: "left", verticalAlign: "middle" },
    }),
    n("lives", "container", { anchor: "middle-center", position: [0, 0], size: [120, 28] }, {
      parentId: "bar",
      data: { ...rowC(8, "center", "center") },
    }),
    ...[0, 1, 2].map((i) => n(`life-${i}`, "shape", { size: [24, 24] }, {
      parentId: "lives", name: `life-icon-${i}`,
      style: { shape: "circle", color: "#5CFFB0" },
    })),
    n("pause-btn", "button", { anchor: "middle-right", position: [0, 0], size: [44, 44] }, {
      parentId: "bar", text: "II",
      style: { fontSize: 18, color: "#F4F2FF", background: { color: "#2C2860", radius: 10 } },
      actions: { activate: "pause" },
    }),
    n("serve-hint", "text", { anchor: "bottom-center", position: [0, -120], size: [420, 32] }, {
      text: "点击 / 空格 发球",
      style: { fontSize: 20, color: "#9E9AC8", align: "center", verticalAlign: "middle" },
      data: { visibleWhen: "state:ball-stuck" },
    }),
  ];
  writeFileSync("content/ui/hud.json", JSON.stringify({ ...doc("ui-hud", "ui-hud", nodes), ...rootMeta }, null, 2));
}

// ---------- Start ----------
{
  const nodes = [
    root("screen-root"),
    n("stage", "container", { anchor: "center", position: [0, 0], size: [560, 420] }, {
      data: { ...col(20) },
    }),
    n("mark", "container", { size: [120, 96] }, { parentId: "stage", data: { ...col(8) } }),
    n("mark-ball", "shape", { size: [26, 26] }, { parentId: "mark", style: { shape: "circle", color: "#FFFFFF" } }),
    n("mark-paddle", "shape", { size: [88, 14] }, { parentId: "mark", style: { shape: "capsule", color: "#5CFFB0" } }),
    n("title", "text", { size: [480, 84] }, {
      parentId: "stage", text: "打砖块",
      style: { fontSize: 64, color: "#F4F2FF", align: "center", fontWeight: "bold" },
    }),
    n("subtitle", "text", { size: [420, 30] }, {
      parentId: "stage", text: "击碎全部砖块，别让球落地",
      style: { fontSize: 18, color: "#9E9AC8", align: "center" },
    }),
    n("start-btn", "button", { size: [240, 56] }, {
      parentId: "stage", text: "开始游戏", actions: { activate: "start" },
      style: btnPrimary,
    }),
    n("controls-hint", "text", { size: [480, 26] }, {
      parentId: "stage", text: "键盘 ← → / 鼠标 / 触控拖动 移动挡板",
      style: { fontSize: 15, color: "#6E6AA0", align: "center" },
    }),
  ];
  writeFileSync("content/ui/start.json", JSON.stringify({ ...doc("ui-start", "ui-screen", nodes), ...rootMeta }, null, 2));
}

// ---------- Pause ----------
{
    const nodes = [
      root("screen-root"),
      n("dim", "shape", { anchorMin: [0, 0], anchorMax: [1, 1], sizeDelta: [0, 0] }, {
        style: { shape: "rect", color: "#0A0820", opacity: 0.66 },
      }),
      n("panel", "container", { anchor: "center", position: [0, 0], size: [320, 320] }, {
        style: panelBg, data: { ...col(16, "center", "center", [28, 24, 28, 24]) },
      }),
      n("pause-title", "text", { size: [240, 48] }, {
        parentId: "panel", text: "暂停", style: { fontSize: 34, color: "#F4F2FF", align: "center", fontWeight: "bold" },
      }),
      n("resume-btn", "button", { size: [240, 52] }, {
        parentId: "panel", text: "继续", actions: { activate: "resume" }, style: btnPrimary,
      }),
      n("retry-btn", "button", { size: [240, 52] }, {
        parentId: "panel", text: "再玩一次", actions: { activate: "restart" },
        style: { background: { color: "#2C2860", radius: 14 }, color: "#F4F2FF", fontSize: 20 },
      }),
      n("to-menu-btn", "button", { size: [240, 52] }, {
        parentId: "panel", text: "返回开始界面", actions: { activate: "to-menu" },
        style: { background: { color: "#2C2860", radius: 14 }, color: "#F4F2FF", fontSize: 20 },
      }),
    ];
    writeFileSync("content/ui/pause.json", JSON.stringify({ ...doc("ui-pause", "ui-screen", nodes), ...rootMeta }, null, 2));
}

// ---------- Results (win / lose shared geometry) ----------
{
  const nodes = [
    root("screen-root"),
    n("dim", "shape", stretch, { style: { shape: "rect", color: "#0A0820", opacity: 0.72 } }),
    n("panel", "container", { anchor: "center", position: [0, 0], size: [380, 340] }, {
      style: panelBg, data: { ...col(18, "center", "center", [32, 28, 32, 28]) },
    }),
    n("result-title", "text", { size: [300, 52] }, {
      parentId: "panel", text: "通关",
      style: { fontSize: 40, color: "#29D3E0", align: "center", fontWeight: "bold" },
      data: { boundText: "win=通关;lose=游戏结束" },
    }),
    n("result-score", "text", { size: [300, 34] }, {
      parentId: "panel", text: "总分 0",
      style: { fontSize: 22, color: "#F4F2FF", align: "center" },
    }),
    n("retry-btn", "button", { size: [240, 56] }, {
      parentId: "panel", text: "再玩一次", actions: { activate: "restart" }, style: btnPrimary,
    }),
    n("to-menu-btn", "button", { size: [240, 48] }, {
      parentId: "panel", text: "返回开始界面", actions: { activate: "to-menu" },
      style: { color: "#9E9AC8", fontSize: 17, background: { color: "transparent" } },
    }),
  ];
  writeFileSync("content/ui/results.json", JSON.stringify({ ...doc("ui-results", "ui-screen", nodes), ...rootMeta }, null, 2));
}

// ---------- Rotation / size message ----------
{
  const nodes = [
    root("screen-root", { style: { background: { color: "#12102A" } } }),
    n("stage", "container", { anchor: "center", position: [0, 0], size: [520, 260] }, { data: { ...col(18) } }),
    n("msg-icon", "text", { size: [120, 80] }, {
      parentId: "stage", text: "↻",
      style: { fontSize: 64, color: "#29D3E0", align: "center" },
      data: { visibleWhen: "reason:portrait; hiddenWhen:reason:size" },
    }),
    n("msg-text", "text", { size: [460, 72] }, {
      parentId: "stage", text: "请旋转设备至横屏",
      style: { fontSize: 28, color: "#F4F2FF", align: "center", lineHeight: 36 },
      data: { boundText: "portrait=请旋转设备至横屏;size=窗口尺寸过小，请放大窗口" },
    }),
    n("msg-sub", "text", { size: [420, 30] }, {
      parentId: "stage", text: "最小支持尺寸 960 × 540",
      style: { fontSize: 16, color: "#9E9AC8", align: "center" },
    }),
  ];
  writeFileSync("content/ui/message.json", JSON.stringify({ ...doc("ui-message", "ui-screen", nodes), ...rootMeta }, null, 2));
}

// ---------- Loading / error system screen ----------
{
  const nodes = [
    root("screen-root", { style: { background: { color: "#12102A" } } }),
    n("loading-group", "container", { anchor: "center", position: [0, 0], size: [320, 160] }, {
      data: { ...col(16) }, data2: undefined,
    }),
  ];
  // rebuild with proper fields
  const loadingGroup = {
    id: "loading-group", role: "container", enabled: true,
    layout: { anchor: "center", position: [0, 0], size: [320, 180] },
    data: { ...col(16), visibleWhen: "phase:loading" },
  };
  const errorGroup = {
    id: "error-group", role: "container", enabled: false,
    layout: { anchor: "center", position: [0, 0], size: [420, 220] },
    data: { ...col(16), visibleWhen: "phase:error" },
  };
  const sysNodes = [
    root("screen-root", { style: { background: { color: "#12102A" } } }),
    loadingGroup,
    { id: "loading-spinner", role: "shape", enabled: true, parentId: "loading-group",
      layout: { size: [40, 40] }, style: { shape: "circle", color: "#29D3E0" } },
    { id: "loading-text", role: "text", enabled: true, parentId: "loading-group",
      layout: { size: [300, 30] }, text: "加载中…",
      style: { fontSize: 20, color: "#F4F2FF", align: "center" } },
    errorGroup,
    { id: "error-text", role: "text", enabled: true, parentId: "error-group",
      layout: { size: [400, 64] }, text: "加载失败，请检查网络",
      style: { fontSize: 20, color: "#FF7A5C", align: "center", lineHeight: 28 } },
    { id: "error-retry", role: "button", enabled: true, parentId: "error-group",
      layout: { size: [200, 52] }, text: "重试",
      actions: { activate: "retry-load" }, style: btnPrimary },
  ];
  writeFileSync("content/ui/system.json", JSON.stringify({ ...doc("ui-system", "ui-screen", sysNodes), ...rootMeta }, null, 2));
}

console.log("UI docs written:", ["hud", "start", "pause", "results", "message", "system"].map((s) => `content/ui/${s}.json`).join(", "));
