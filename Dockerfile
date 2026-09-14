# syntax=docker/dockerfile:1

# ---- 构建阶段：编译静态页面 ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- 发布阶段：nginx 托管静态页面 ----
FROM nginx:1.27-alpine AS web
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

# ---- 验收阶段：一次性运行类型检查 + 单元测试 + 端到端测试 ----
# 镜像内置与 @playwright/test 版本匹配的 Chromium
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS verify
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
CMD ["npm", "run", "verify"]
