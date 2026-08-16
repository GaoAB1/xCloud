# xCloud 面板镜像
FROM node:20-alpine

WORKDIR /app

# 先复制依赖清单，利用 Docker 层缓存
COPY package.json package-lock.json ./
RUN npm install --omit=dev && npm cache clean --force

# 再复制应用代码
COPY . .

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

# 数据持久化：用户/应用/会话 + 网盘文件
VOLUME /app/data

CMD ["node", "server.js"]
