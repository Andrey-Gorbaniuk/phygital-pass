FROM node:20-alpine AS web-build
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts eslint.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:20-alpine AS api-build
WORKDIR /workspace/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server ./
RUN npm run build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app/server
COPY --from=api-build /workspace/server/package.json /workspace/server/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=api-build /workspace/server/dist ./dist
COPY --from=web-build /workspace/dist ./public
EXPOSE 3000
CMD ["node", "dist/index.js"]
