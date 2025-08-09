FROM node:18-alpine AS builder
WORKDIR /app

# Build client
COPY client/package*.json ./client/
WORKDIR /app/client
RUN npm ci --silent
COPY client/ .
RUN npm run build

# Install server deps
WORKDIR /app
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm ci --production --silent
COPY server/ .

# Copy built client into server public dir
RUN mkdir -p public
RUN cp -R /app/client/dist/. public/

ENV NODE_ENV=production
EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]