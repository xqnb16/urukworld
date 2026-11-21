# 乌鲁克 · 城邦漫游

在这个目录运行 `pnpm install --frozen-lockfile` 和 `pnpm dev`，然后打开终端显示的本地地址。运行 `npm run build` 生成 `dist/`，再运行 `pnpm preview` 可检查 `/urukworld/` 下的生产构建。

推送到 `main` 后，GitHub Actions 构建并发布到 GitHub Pages。`public/models/` 存放 Meshopt 压缩后的 GLB 发布版。更新模型时先压缩新的 Blender 导出副本，再替换同名发布文件。入口只下载主城，并显示实时下载量。进入后后台加载旷野，地标就绪后自动启用。

- `WASD` 或方向键行走，按住 `Shift` 奔跑，按 `Space` 跳跃。
- 点击「踏入乌鲁克」或场景空白处锁定鼠标。直接移动鼠标转向，`Esc` 释放。对话结束后点击场景恢复锁定。
- `V` 切换第一人称与越肩，`N` 在正午和星夜之间切换，`M` 切换声景。顶部日晷可连续调到晚霞。
- 顶部地标按钮可前往城门集市、运河码头和白神庙王座。传送落点使用与行走一致的地面检测。
- 走近角色后按 `E` 或点击交谈。点击正在显示的台词可立即展开全文，数字键选择回应，`Esc` 返回漫游。

替换人物时，把带原始透明通道的全身 PNG 放到 `public/sprites/`，同名覆盖 `gilgamesh.png` 或 `citizen_01.png` 至 `citizen_04.png`，然后刷新页面。居民按编号循环使用这四张图。网页会裁掉透明留白、保留画面比例并把可见内容对齐脚底。因此立绘的最低可见像素应当是脚底。

商队使用 `traveler_merchant.png`、`traveler_caravan.png` 与 `traveler_guard.png`。西岸居民使用 `west/resident_01.png` 至 `west/resident_12.png`。默认 PNG 都可同名替换。界面字体许可证位于 `public/fonts/`。
