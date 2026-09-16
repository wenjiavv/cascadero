#!/bin/bash
# 部署到一台跑 Docker 的远程主机（示例）：生成 engine.js → 打包上传 → 远端构建镜像 → 重建容器
# 用法：复制为 online/deploy.sh（已在 .gitignore 里），改 HOST/BASE/DOCKER，在仓库根目录的 .env 里填口令
set -e
cd "$(dirname "$0")/.."                        # 仓库根目录
HOST=${HOST:-user@your-nas}                    # ssh 目标
BASE=${BASE:-/volume1/docker/cascadero}        # 远端目录：$BASE/app 放构建上下文，$BASE/data 放房间与对局记录，$BASE/env 放口令(0600)
DOCKER=${DOCKER:-docker}                       # 群晖等系统请写 /usr/local/bin/docker
BIND=${BIND:-127.0.0.1:5235}                   # 容器端口绑定；反向代理在别的机器上时改成 5235（所有接口）
[ -f .env ] || { echo "缺 .env（参考 .env.example）"; exit 1; }
grep -qE '^CASC_OWNER_PIN=' .env && grep -qE '^CASC_SITE_PIN=' .env || { echo ".env 里要有 CASC_OWNER_PIN 和 CASC_SITE_PIN"; exit 1; }

python3 online/build-engine.py
node -e "require('./online/engine.js'); console.log('engine ok')"
(cd online && [ -d node_modules ] || npm ci --omit=dev)
ssh "$HOST" "mkdir -p $BASE/app $BASE/data"
COPYFILE_DISABLE=1 tar czf - Dockerfile .dockerignore index.html online/server.js online/engine.js online/package.json online/package-lock.json online/node_modules | ssh "$HOST" "tar xzf - -C $BASE/app"
sed -E 's/[[:space:]]+#.*$//' .env | ssh "$HOST" "umask 077; cat > $BASE/env; chmod 600 $BASE/env"     # 口令走 0600 的 env 文件，不进命令行
ssh "$HOST" "cd $BASE && $DOCKER build -q -t cascadero-table:latest app && ($DOCKER rm -f cascadero-table >/dev/null 2>&1 || true) && \
  $DOCKER run -d --name cascadero-table --restart unless-stopped -p $BIND:5235 --env-file $BASE/env -e TZ=Asia/Shanghai \
  -v $BASE/data:/data cascadero-table:latest && sleep 2 && $DOCKER logs --tail 3 cascadero-table"
