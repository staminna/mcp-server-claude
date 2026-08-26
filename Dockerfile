# Build the TypeScript sources, then ship only the compiled output and the
# production dependency tree.
FROM node:22-alpine AS builder

WORKDIR /app

# Install against the lockfile first so this layer is cached independently of
# the sources.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

USER node

# stdio transport: the MCP protocol runs over stdin/stdout, logs go to stderr.
# The server starts and answers introspection without credentials; DIRECTUS_URL
# and DIRECTUS_TOKEN are needed only for tool calls that reach Directus.
ENTRYPOINT ["node", "dist/index.js"]
