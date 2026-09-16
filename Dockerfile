# 自托管私人牌桌镜像。构建上下文=仓库根目录（.dockerignore 是白名单，只带运行所需文件）
FROM node:22-alpine
WORKDIR /app
COPY index.html ./index.html
COPY online/ ./online/
WORKDIR /app/online
# 部署脚本若已把 node_modules 打包进来则直接用，否则在镜像内安装
RUN [ -d node_modules ] || npm ci --omit=dev
ENV NODE_ENV=production PORT=5235 CASC_ROOT=/app CASC_DATA=/data
EXPOSE 5235
CMD ["node","server.js"]
