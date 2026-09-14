# 展品照度暴露核算台

闭馆交接场景下，为保护专员核算敏感展品**当班照度暴露量**的纯前端核算台。
数据仅在浏览器内处理，不设业务后端；通过 Docker Compose 以静态页面形式发布。

## 核算规则

### 录入项

| 录入项 | 规则 |
| --- | --- |
| 展品名 | 必填 |
| 班次开始 / 结束 | 必填，精确到分钟的完整本地日期时间（`YYYY-MM-DDTHH:mm`），按同一浏览器本地时区比较，**允许跨日**；结束必须晚于开始 |
| 允许暴露量 | 必填，`0.01` 至 `100000` lx·h，最多两位小数 |
| 时间点与照度表 | 至少两行；**首末时间点必须分别等于班次起止**，中间点严格递增；照度 `0` 至 `5000` lx，最多两位小数 |

### 计算与判定

- 相邻区间段暴露量：**(前值 ＋ 后值) ÷ 2 × 分钟差 ÷ 60**（梯形近似），全程使用
  [decimal.js](https://mikemcl.github.io/decimal.js/) 十进制定点运算，避免二进制浮点误差。
- 页面将**各段**及**总量**四舍五入（ROUND_HALF_UP）到 `0.01` lx·h 展示；
  但**总量必须先累加未舍入段值再舍入**，因此逐段显示值之和可能与总量存在尾差。
- 判定（唯一结论）：**总量 ≤ 限额 → 合格**，显示剩余额；**总量 > 限额 → 超限**，显示超出量。
  剩余额 / 超出量同样按 `0.01` lx·h 展示。
- 合法提交后展示：逐段算式、总量、限额、差额与唯一判定。

### 错误处理

一次提交中若存在**时间边界**（首末点不等于班次起止）、**顺序**（未严格递增）、
**必填**或**范围**（含小数位）错误：

- 全部错误**合并标出**在对应行 / 字段上（红色行底 + 逐条消息 + 汇总横幅）；
- **保留全部输入**；
- **不更新旧结论**（上一次合法核算结果保持原样）。

修正后重新提交，合法时才刷新结论。

## 技术栈与结构

TypeScript · Vue 3 · Vite · decimal.js · Vitest · Playwright

```
src/
  lib/exposure.ts        # 纯函数核心：解析、校验、核算（不依赖 DOM）
  App.vue                # 录入表单、错误合并标出
  components/ResultPanel.vue  # 逐段算式、总量、差额、判定
tests/
  unit/exposure.spec.ts  # Vitest：跨日、临界舍入、判定、校验
  e2e/app.spec.ts        # Playwright：表格录入、结论、错误保留
Dockerfile               # 多阶段：build → web(nginx) / verify(验收)
docker-compose.yml       # web 静态发布 + verify 一次性验收
```

## 本地开发

```bash
npm install
npm run dev          # 开发服务器
npm run typecheck    # vue-tsc 类型检查
npm run test:unit    # Vitest 单元测试（跨日 / 临界舍入）
npm run test:e2e     # Playwright 端到端（自动构建并启动 preview）
npm run verify       # 一次性验收 = typecheck + 单元 + 端到端
```

> 首次运行端到端测试前需 `npx playwright install chromium`
> （Linux 还需系统库：`npx playwright install-deps chromium`，或直接使用下方 Docker 验收）。

## Docker 发布与验收

### 发布静态页面

```bash
docker compose up -d --build web
# 默认 http://localhost:8080 ；可用 WEB_PORT 覆盖宿主端口：
WEB_PORT=9000 docker compose up -d --build web
```

`web` 服务由多阶段构建产出：Node 构建 `dist/`，再由 nginx 托管，容器内端口 80。

### 一次性验收（verify 服务）

```bash
docker compose run --rm verify
```

`verify` 基于官方 Playwright 镜像（内置 Chromium 及系统依赖），在容器内完成
依赖安装 → 类型检查 → Vitest 单元测试 → 构建 → Playwright 端到端测试，
跑完即退出；退出码为 0 表示验收通过，非 0 表示失败。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `WEB_PORT` | `8080` | `web` 服务映射到宿主机的端口 |
