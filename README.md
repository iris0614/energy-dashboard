# 跨大西洋冬季能源平衡与套利看板

静态看板。[`index.html`](index.html) 与 [`transatlantic-energy-dashboard.html`](transatlantic-energy-dashboard.html) 内容相同。样式和计算在这个 HTML 里；示意序列和起点价格在 [`data.json`](data.json)。没有构建步骤，也不需要 API 密钥。

## 本地运行

在仓库根目录启动静态服务：

```bash
python3 -m http.server 8741 --bind 0.0.0.0
```

浏览器打开 [http://127.0.0.1:8741/](http://127.0.0.1:8741/)。

用 `file://` 直接打开时，`data.json` 和汇率请求可能被浏览器拦截。页面会改用内置回退，并在「数据快照」上标明，计算不会停住。汇率退回 `1.1204`。

## 数据

- **data.json**：`asOf`、起点 `seed`、示意序列 `series`、库存基数 `inventory`。页面加载时 `fetch("data.json")`。替换这个文件即可更新底稿，不必改 HTML。页眉写出文件里的 `asOf`，以及浏览器取得该文件的时间。
- **实时**：欧元兑美元。欧洲央行参考价，经 [Frankfurter](https://api.frankfurter.dev/v1/latest?from=EUR&to=USD) 大约每 60 秒读取一次，并画出近两个月的参考价。页面上会标来源和最近一次取得时间。
- **示意**：TTF、Henry Hub、Spark25 日租金、欧洲库存、采暖度日、美国炼厂开工率、馏分油库存和大西洋柴油价格。起点在 `data.json`，按 2025/26 采暖季的量级设定。未锁定的示意价格大约每 5 秒轻微向这份起点回归；改过的输入会被锁定，直到点「恢复示意起点」。

页眉按钮「指标说明与更新频率（Glossary）」用中文说明各指标、本页公式、公开来源和更新频率。

页脚写了库存、交付成本和热值平价的口径，并链到 EIA、AGSI/GIE、ICE TTF、Spark、欧洲央行和 Frankfurter 的公开页面。这些链接是定义和数据首页，不是示意数字的逐笔出处。
