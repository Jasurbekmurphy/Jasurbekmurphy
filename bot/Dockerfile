FROM node:22-alpine
WORKDIR /app
COPY package.json worker.js server.js ./
ENV HOST=0.0.0.0 PORT=8787 DB_PATH=/data/davomat.db
VOLUME /data
EXPOSE 8787
CMD ["node", "server.js"]
