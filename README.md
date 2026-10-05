# 跨大西洋冬季能源平衡与套利看板

单文件静态看板：[`transatlantic-energy-dashboard.html`](transatlantic-energy-dashboard.html)。HTML、CSS 与原生 JavaScript 都在这一个文件里，没有构建步骤，也不需要 API 密钥。

## 本地运行

在仓库根目录启动静态服务：

```bash
python3 -m http.server 8741 --bind 0.0.0.0
```

浏览器打开 [http://127.0.0.1:8741/transatlantic-energy-dashboard.html](http://127.0.0.1:8741/transatlantic-energy-dashboard.html)。

用 `file://` 直接打开时，库存、套利和图表仍可在本地计算；汇率请求可能被浏览器拦截，页面会退回内置 EURUSD `1.1204`，界面不会停住。

## 数据

- **实时**：欧元兑美元。欧洲央行参考价，经 [Frankfurter](https://api.frankfurter.dev/v1/latest?from=EUR&to=USD) 大约每 60 秒读取一次，并画出近两个月的参考价。页面上会标来源和最近一次取得时间。
- **示意**：TTF、Henry Hub、Spark25 日租金、欧洲库存、采暖度日、美国炼厂开工率、馏分油库存和大西洋柴油价格。起点按 2025/26 采暖季的量级设定，并在页面上标明。未锁定的示意价格大约每 5 秒轻微跳动；改过的输入会被锁定，直到点「恢复示意起点」。

页脚写了库存、交付成本和热值平价的口径，并链到 EIA、AGSI/GIE、ICE TTF、Spark、欧洲央行和 Frankfurter 的公开页面。这些链接是定义和数据首页，不是示意数字的逐笔出处。
