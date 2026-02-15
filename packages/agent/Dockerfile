FROM node:22-slim

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY dist/ dist/

CMD ["node", "dist/server.js"]
