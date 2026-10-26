# syntax=docker/dockerfile:1
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server.js ./
COPY server ./server
COPY database ./database
COPY public ./public
COPY data ./data
RUN mkdir -p /app/.data && chown -R node:node /app
USER node
EXPOSE 8080
CMD ["npm","start"]
