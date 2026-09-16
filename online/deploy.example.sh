#!/bin/bash
# 部署到一台跑 Docker 的远程主机（示例）：生成 engine.js → 打包上传 → 构建镜像 → 重建容器
# 用法：复制为 deploy.sh（已在 .gitignore 里），改 HOST/BASE，在 .env 里填两个口令
set -e
cd "$(dirname "$0")"
HOST=${HOST:-user@your-nas}            # ssh 目标
BASE=${BASE:-/volume1/docker/hex-envoy} # 远端目录：$BASE/app 放代码，$BASE/data 放房间与对局记录
DOCKER=${DOCKER:-docker}                # 群晖等系统请写 /usr/local/bin/docker
set -a; source .env; set +a             # CASC_OWNER_PIN / CASC_SITE_PIN / CASC_MAX_ROOMS
: "${CASC_OWNER_PIN:?缺 CASC_OWNER_PIN}" "${CASC_SITE_PIN:?缺 CASC_SITE_PIN}"

python3 build-engine.py
node -e "require('./engine.js'); console.log('engine ok')"
ssh "$HOST" "mkdir -p $BASE/app $BASE/data"
tar czf - -C .. index.html -C online server.js engine.js package.json package-lock.json Dockerfile | ssh "$HOST" "tar xzf - -C $BASE/app"
ssh "$HOST" "cd $BASE && $DOCKER build -q -t hex-envoy-table:latest app && ($DOCKER rm -f hex-envoy-table >/dev/null 2>&1 || true) && \
  $DOCKER run -d --name hex-envoy-table --restart unless-stopped -p 127.0.0.1:5235:5235 \
  -e CASC_OWNER_PIN='$CASC_OWNER_PIN' -e CASC_SITE_PIN='$CASC_SITE_PIN' -e CASC_MAX_ROOMS='${CASC_MAX_ROOMS:-8}' -e TZ=Asia/Shanghai \
  -v $BASE/data:/data hex-envoy-table:latest && sleep 2 && $DOCKER logs --tail 3 hex-envoy-table"
