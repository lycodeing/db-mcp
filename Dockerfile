# Dockerfile for db-mcp
FROM node:20-alpine AS builder

WORKDIR /app

# 复制 package 文件
COPY package*.json ./
COPY tsconfig.json ./

# 安装依赖
RUN npm ci --only=production=false

# 复制源代码
COPY src ./src

# 构建
RUN npm run build

# 生产镜像
FROM node:20-alpine

WORKDIR /app

# 复制必要文件
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# 创建配置目录
RUN mkdir -p /app/config

# 设置环境变量
ENV NODE_ENV=production
ENV DB_MCP_CONFIG=/app/config/config.json

# 暴露端口（用于健康检查，实际 MCP 通过 stdio 通信）
EXPOSE 3000

# 启动命令
CMD ["node", "dist/index.js"]
