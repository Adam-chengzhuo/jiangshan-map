# Cloudflare Pages（免费静态站点）

本仓库的公开站点只用 Cloudflare Pages 的静态构建。不要改用 Worker、Pages Functions，也不要开通付费产品。不要把仓库根目录设为输出目录：根目录含有不得再分发的郡州府边界和现代省界。

在 Cloudflare Pages 的 Git 连接里使用：

| 设置 | 值 |
| --- | --- |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | 仓库根目录（留空） |

`npm run build` 即 `node scripts/build_public.js`。构建只用 Node.js 标准库，没有需要安装的依赖，也没有后端。

构建会：

1. 把运行所需、且许可上可以公开的文件写入临时目录。
2. 重新编码 `js/atlas_boot.js` 与 `js/atlas_snapshots.js`，去掉 CHGIS / Hartwell 郡州府边界及其几何完全相同的副本。
3. 从 `js/china_geo_data.js` 去掉 DataV GeoAtlas / 高德现代省界，保留上游标为公有领域的水系。
4. 跑 `node scripts/check_public_dist.js`。检查失败则不会留下 `dist/`。

本地复现：

```bash
npm run build
node scripts/check_public_dist.js
python3 -m http.server 8765 --directory dist
```

然后打开 `http://127.0.0.1:8765/`。页面应显示王朝疆域、时间轴、城市与人物，并写明受限行政区划图层不提供。

部署目录里的署名、GPL-3.0 文本和第三方说明是 `dist/LICENSE` 与 `dist/NOTICE.txt`。
