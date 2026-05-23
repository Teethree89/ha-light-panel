FROM node:20-bookworm-slim

WORKDIR /app
COPY package.json server.js ./
COPY examples ./examples

ENV HOST=0.0.0.0
ENV PORT=8890
ENV CONFIG_PATH=/app/config.json

EXPOSE 8890
USER node
CMD ["node", "server.js"]
