import { readFileSync, writeFileSync } from "node:fs";

const rootMeta = {
  orientation: "Landscape",
  referenceResolution: [960, 540],
  targetViewports: [[960, 540], [1200, 540], [960, 600], [1280, 720]],
  minimumControlSize: [44, 44],
};

for (const f of ["hud", "start", "pause", "results", "message", "system"]) {
  const p = `content/ui/${f}.json`;
  const d = JSON.parse(readFileSync(p, "utf8"));
  for (const k of Object.keys(rootMeta)) { delete d.data[k]; delete d[k]; }
  for (const node of d.data.nodes) {
    if (node.id !== "root" && !node.parentId) node.parentId = "root";
  }
  const rootNode = d.data.nodes.find((x) => x.id === "root");
  rootNode.data = { ...(rootNode.data || {}), ...rootMeta };
  writeFileSync(p, JSON.stringify(d, null, 2));
}
console.log("fixed");
