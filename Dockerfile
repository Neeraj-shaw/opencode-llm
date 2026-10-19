FROM node:22-slim

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --production

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

# Create data directory
RUN mkdir -p /data/freeflow-omniroute

# Environment
ENV FREEFLOW_PORT=28280
ENV FREEFLOW_HOST=0.0.0.0
ENV FREEFLOW_DATA_DIR=/data/freeflow-omniroute
ENV NODE_ENV=production

EXPOSE 28280

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:28280/health').then(r=>r.json()).then(j=>{if(j.status!=='ok')process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "--experimental-strip-types", "src/server.ts"]
