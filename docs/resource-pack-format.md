# BeeGame Resource Pack ZIP 规范

用户只需要上传一个 `.zip`，不需要手写 `pack.json`。系统会根据文件名、目录和扩展名自动生成 Pack 元数据；`pack.json` 仅作为可选的高级覆盖配置。

```text
my-pack.zip
├── characters/
│   ├── hero_idle.png
│   └── hero_run.png
├── environment/
│   └── tree.glb
├── audio/
│   └── ambience.ogg
├── preview.png               # 可选，Pack 封面；也支持 jpg/jpeg/webp/gif/mp4/webm
└── pack.json                 # 可选，由系统导出或高级用户提供
```

约定：

- 第一层目录作为元素类别，例如 `characters`、`models`、`vfx`、`fonts`、`audio`、`textures`。
- 根目录的 `preview.jpg`、`preview.jpeg`、`preview.png`、`preview.webp`、`preview.gif`、`preview.mp4` 或 `preview.webm` 会被识别为 Pack 封面，不计入元素列表。
- 系统根据 `png/jpg/svg/webp` 与 `fbx/glb/gltf/obj/blend` 等扩展名推断 2D、3D 或混合 Pack。
- 如果存在 `pack.json`，它只覆盖系统能推断的字段，不存在时仍然可以导入。
- 文件名应使用稳定、无空格的路径，避免同一 Pack 内出现重复路径。

推荐的 `pack.json` 字段：`name`、`style`、`gameTypes`、`dimension`、`categories`、`license`、`version`、`coverPath`。
