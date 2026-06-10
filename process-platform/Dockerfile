FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

FROM node:22-bookworm-slim AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 5173 3000
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS server
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
RUN mkdir -p data/attachments
EXPOSE 3000
CMD ["sh", "-c", "npm run db:init && npm run server"]
