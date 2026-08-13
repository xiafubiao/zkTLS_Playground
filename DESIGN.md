# zkTLS Playground - 产品设计文档

## 1. 产品概述

### 1.1 问题背景

Primus 提供了多套 zkTLS SDK，开发者面对具体需求时难以快速判断使用哪套 SDK、如何配置参数。现有文档分散，缺乏一个可以快速试错的动手环境。

### 1.2 产品定位

一个 **stateless 的本地 Playground**，用户在浏览器中编辑代码、配置凭证、一键运行，实时看到 zkTLS attestation 的完整流程和结果。无需注册、无需服务端持久化、关闭即清。

### 1.3 核心价值

- **零门槛试跑**：预置数据源模板 + 默认凭证，打开即跑
- **双 SDK 支持**：zktls-core-sdk 和 network-core-sdk 一键切换
- **实时反馈**：代码修改后直接运行，stdout 实时推送
- **完全本地**：密钥不出机器，无安全顾虑

---

## 2. 用户可配置项

### 2.1 SDK 选择

用户通过下拉菜单选择 SDK，切换后自动加载对应代码模板和配置面板。

| SDK | 运行环境 | 认证方式 | 链上交互 | 模块格式 |
|---|---|---|---|---|
| `zktls-core-sdk` | Node.js (ESM) | appId + appSecret | 无 | `.mjs` |
| `network-core-sdk` | Node.js (CJS) | 钱包私钥 | submitTask + verifyAndPollTaskResult | `.cjs` |

#### 选择 `zktls-core-sdk` 时的配置

| 配置项 | 说明 |
|---|---|
| AppId | Primus 应用 ID |
| AppSecret | EVM 私钥，SDK 用于签名请求 |

> 默认值预填在配置面板中，用户可直接运行或替换为自己的凭证。

#### 选择 `network-core-sdk` 时的配置

| 配置项 | 说明 |
|---|---|
| Private Key | 测试钱包私钥，用于签名链上交易 |
| Address | 钱包地址（从私钥派生） |
| Chain ID | 目标链 ID（默认 84532 = Base Sepolia） |
| RPC URL | 链 RPC 端点（默认 https://sepolia.base.org） |

> 默认配置一个连接 **Base Sepolia 测试网** 的测试钱包，预填私钥和地址。用户需确保钱包有足够 ETH 付 gas（可通过 faucet 领取）。

### 2.2 数据源选择

预置 5 个数据源示例，用户可通过下拉菜单切换：

| 示例 | URL | 揭示字段 | 说明 |
|---|---|---|---|
| OKX Instruments | `okx.com/.../instruments?instType=SPOT&instId=BTC-USD` | instType, instId, baseCcy, quoteCcy | BTC-USD 交易对信息 |
| OKX Ticker | `okx.com/.../ticker?instId=BTC-USDT` | last, bidPx, askPx | BTC-USDT 实时价格 |
| CoinGecko | `api.coingecko.com/.../price?...ids=bitcoin` | btcUsd | BTC 美元价格 |
| Binance | `api.binance.com/.../price?symbol=BTCUSDT` | symbol, price | BTCUSDT 价格 |
| GitHub | `api.github.com/repos/primus-labs/zktls-core-sdk` | stars, forks | 仓库信息 |

选择数据源后自动生成对应代码模板（含 URL、responseResolves、JSONPath），用户可在编辑器中进一步修改。

### 2.3 代码编辑与实时运行

用户可在 Monaco 编辑器中自由修改代码逻辑：

- 修改 URL、header、body
- 调整 `responseResolves` 的字段和 `parsePath`
- 添加 `op`（如 `SHA256`、`>`、`=`）实现隐私操作
- 修改 `attMode`（`proxytls` / `mpctls`）
- 添加自定义业务逻辑

修改完成后点击 **Run** 按钮，后端将代码写入临时文件并执行，stdout/stderr 通过 WebSocket 实时推送到输出控制台。

---

## 3. 架构设计

### 3.1 Stateless 架构

```
用户本地机器
┌─────────────────────────────────────────────┐
│  浏览器 (localhost:4567)                     │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │ Monaco Editor│  │ 配置面板              │  │
│  │ (代码编辑)    │  │ SDK选择 + 凭证输入    │  │
│  └─────────────┘  └──────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │ 输出控制台 (WebSocket 实时推送)        │  │
│  └───────────────────────────────────────┘  │
└──────────────────┬──────────────────────────┘
                   │ WebSocket
┌──────────────────▼──────────────────────────┐
│  Local Node.js Server                        │
│  ├─ 静态文件服务 (public/index.html)         │
│  ├─ WebSocket Server (实时输出)              │
│  └─ child_process.spawn (执行用户代码)       │
│       ├─ zktls-core-sdk  -> .mjs 临时文件    │
│       ├─ network-core-sdk -> .cjs 临时文件   │
│       ├─ 注入凭证（占位符替换）              │
│       ├─ 捕获 stdout/stderr -> WebSocket     │
│       └─ 超时 5 分钟自动杀死                 │
└─────────────────────────────────────────────┘
```

### 3.2 代码执行流程

```
1. 用户在编辑器中修改代码
2. 用户点击 Run
3. 前端通过 WebSocket 发送 { type: "run", code, sdk, config }
4. Server 接收：
   a. 根据 SDK 类型决定文件后缀（.mjs / .cjs）
   b. 将配置面板中的凭证替换到代码占位符（__APP_ID__ / __PRIVATE_KEY__ 等）
   c. 写入临时文件 /tmp/zktls_<uuid>.mjs
   d. spawn("node", [tmpFile], { cwd, timeout: 5min })
5. 子进程 stdout/stderr -> WebSocket -> 前端输出控制台
6. 子进程结束 -> 清理临时文件 -> 前端显示退出状态
```

### 3.3 凭证安全

| 原则 | 实现 |
|---|---|
| 不落盘 | 凭证在浏览器内存中，通过 WebSocket 传到 server，注入临时文件，执行后删除 |
| 不存储 | Server 不持久化任何凭证，进程重启即清 |
| 仅本地 | Server 只监听 127.0.0.1，外部无法访问 |
| 占位符替换 | 代码模板中使用 `__APP_ID__`、`__PRIVATE_KEY__` 等占位符，运行时替换 |

---

## 4. 两 SDK 关键差异

| 差异点 | zktls-core-sdk | network-core-sdk |
|---|---|---|
| 模块格式 | ESM (`import`) | CJS (`require`) |
| 初始化 | `new PrimusCoreTLS().init(appId, appSecret)` | `new PrimusNetwork().init(wallet, chainId)` |
| 请求生成 | `generateRequestParams()` + `setAttMode()` | 直接传入 `attest()` 参数 |
| 隐私操作 | `setAttConditions()` 单独设置 | `responseResolves` 内联 `op` 字段 |
| 执行 | `startAttestation()` | `submitTask()` + `attest()` |
| 验证 | `verifyAttestation()` 本地 | `verifyAndPollTaskResult()` 链上 |
| 花费 | 无 gas | submitTask 花 gas |
| 依赖 | 无 ethers | ethers v5 |

---

## 5. 数据源适配

### 5.1 支持的 op

| op | 输出 | 适用场景 |
|---|---|---|
| `REVEAL_STRING`（默认） | 原始值明文 | 公开数据 |
| `SHA256` | hex 哈希 | 隐藏敏感字段 |
| `SHA256_EX` | hex 哈希 | 跨 URL 联合哈希 |
| `>` / `>=` / `<` / `<=` / `=` / `!=` | `"true"` / `"false"` | 阈值证明 |
| `STREQ` / `STRNEQ` | `"true"` / `"false"` | 字符串相等证明 |

### 5.2 配置示例

```javascript
// 明文揭示
{ keyName: "price", parseType: "json", parsePath: "$.data[0].last" }

// 哈希揭示（隐藏原始值）
{ keyName: "balance", parseType: "json", parsePath: "$.balance", op: "SHA256" }

// 阈值比较（返回 true/false）
{ keyName: "volume", parseType: "json", parsePath: "$.vol", op: ">", value: "10000" }
```

---

## 6. 技术约束（实测验证）

| 约束 | 说明 |
|---|---|
| ethers v5 必须 | network-core-sdk 依赖 ethers v5 API，v6 不兼容 |
| ESM/CJS 冲突 | zktls-core-sdk 用 import，network-core-sdk 用 require，通过 .mjs/.cjs 后缀解决 |
| `parseType` 无效 | SDK 不消费此字段，算法服务不识别 hex/base64 |
| PDF 二进制不可直接 reveal | `REVEAL_STRING` 对非 UTF-8 二进制触发 JSON 序列化失败 |
| PDF 可用 SHA256_EX | 证明文件哈希，`parsePath: "$"` 引用整个响应体 |
| mpctls 节点不稳定 | MPC 节点可能超时，proxytls 是更稳定的选择 |
| `proveLargeData` | 大文件场景需启用 |
| `getAllJsonResponse` | 值为字符串 `'true'` 不是布尔值 |

---

## 7. 链配置

### 默认链

| 配置 | 值 |
|---|---|
| 链 | Base Sepolia (测试网) |
| Chain ID | 84532 |
| RPC URL | `https://sepolia.base.org` |
| ETH Faucet | https://www.alchemy.com/faucets/base-sepolia |

### Primus 合约地址

| 链 | 合约地址 |
|---|---|
| Base Sepolia | `0xCE7cefB3B5A7eB44B59F60327A53c9Ce53B0afdE` |
| Base | `0xCE7cefB3B5A7eB44B59F60327A53c9Ce53B0afdE` |
| Arbitrum | `0x982Cef8d9F184566C2BeC48c4fb9b6e7B0b4A58B` |
| BNB Chain | `0xF24199D5D431bE869af3Da61162CbBb58C389324` |

---

## 8. 文件结构

```
EasyBuild/
├── package.json              # 依赖: zktls-core-sdk + network-core-sdk + ethers v5 + express + ws
├── server.js                 # Express 静态服务 + WebSocket + child_process 执行
├── public/
│   └── index.html            # Monaco 编辑器 + 配置面板 + 输出控制台 (单文件)
└── DESIGN.md                 # 本文档
```

| 文件 | 职责 |
|---|---|
| `server.js` | 监听 127.0.0.1:4567；静态文件服务；WebSocket 接收代码+凭证；spawn 子进程执行；stdout/stderr 推送；临时文件清理 |
| `index.html` | SDK 下拉选择；数据源示例下拉选择；配置面板（凭证输入，预填默认值）；Monaco 编辑器；输出控制台；Run 按钮；WebSocket 通信 |
| `package.json` | 依赖管理；`npm start` 启动 |

---

## 9. 路线图

### Phase 1：已完成

- [x] zktls-core-sdk + network-core-sdk 双 SDK 支持
- [x] 5 个数据源示例模板
- [x] Monaco 代码编辑器
- [x] 配置面板（凭证输入，预填默认值）
- [x] WebSocket 实时输出
- [x] Stateless 本地运行

### Phase 2：待开发

- [ ] 代码保存/加载（localStorage）
- [ ] 更多数据源示例（带认证的 API）
- [ ] 隐私操作模板（SHA256 / 阈值比较）
- [ ] 多 URL 批量证明模板
- [ ] 代码导出为独立项目
- [ ] 错误诊断 + 修复建议

### Phase 3：进阶

- [ ] 在线分享代码片段（URL 编码）
- [ ] 自定义数据源向导（输入 URL 自动探测 JSONPath）
- [ ] SDK 版本切换
- [ ] Stream 模式支持
- [ ] PDF / 二进制数据源适配
