FROM node:22-alpine
WORKDIR /app
COPY . .
# 若部署脚本已把 node_modules 一并打包则直接用，否则在镜像内安装
RUN [ -d node_modules ] || npm ci --omit=dev
ENV NODE_ENV=production PORT=5235 CASC_DATA=/data
EXPOSE 5235
CMD ["node","server.js"]
