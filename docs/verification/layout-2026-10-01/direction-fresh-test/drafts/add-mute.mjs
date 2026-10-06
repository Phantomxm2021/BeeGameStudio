import { readFileSync, writeFileSync } from "node:fs";

const muteStyle = { fontSize: 18, color: "#F4F2FF", background: { color: "#2C2860", radius: 10 } };

// start.json: screen-level icon button, top-right
{
  const p = "content/ui/start.json";
  const d = JSON.parse(readFileSync(p, "utf8"));
  d.data.nodes.push({
    id: "mute-btn", role: "button", enabled: true, parentId: "root",
    layout: { anchor: "top-right", position: [-24, 24], size: [44, 44] },
    text: "♪", actions: { activate: "toggle-mute" }, style: muteStyle,
  });
  writeFileSync(p, JSON.stringify(d, null, 2));
}

// pause.json: absolute icon button over panel's top-right corner
{
  const p = "content/ui/pause.json";
  const d = JSON.parse(readFileSync(p, "utf8"));
  d.data.nodes.push({
    id: "mute-btn", role: "button", enabled: true, parentId: "panel",
    layout: {
      anchor: "top-right", position: [-14, 12], size: [44, 44],
      item: { absolute: true },
    },
    text: "♪", actions: { activate: "toggle-mute" }, style: muteStyle,
  });
  writeFileSync(p, JSON.stringify(d, null, 2));
}
console.log("mute added");
