# zkTLS Playground (Vercel Edition)

轻量改造后的 zkTLS Playground，可直接部署到 Vercel。

## 改造内容

- ✅ 移除 WebSocket，改用 HTTP API (`/api/run`)
- ✅ 使用动态 import 替代 `spawn` 子进程
- ✅ 兼容 Vercel Serverless Functions
- ✅ 最大执行时间 120 秒

## 部署到 Vercel

### 方法 1: Vercel CLI (推荐)

```bash
# 1. 安装 Vercel CLI
npm i -g vercel

# 2. 登录
vercel login

# 3. 部署
vercel
```

### 方法 2: GitHub 集成

1. 把代码推送到 GitHub 仓库
2. 在 [vercel.com](https://vercel.com) 导入仓库
3. 直接部署，无需额外配置

## 本地开发

```bash
npm install
npx vercel dev
```

访问: http://localhost:3000

## 注意事项

- Vercel Pro 计划：最大执行时间 300 秒
- Vercel Hobby 计划：最大执行时间 10 秒
- 如果需要更长执行时间，请升级到 Pro 计划
