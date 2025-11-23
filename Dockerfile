FROM node:20-alpine

WORKDIR /app

# Install dependencies for sharp and network troubleshooting
RUN apk add --no-cache \
    g++ \
    make \
    python3 \
    curl \
    ca-certificates \
    vips-dev

# Configure npm for better reliability
RUN npm config set strict-ssl false
RUN npm config set registry https://registry.npmjs.org/
RUN npm config set fetch-retry-mintimeout 20000
RUN npm config set fetch-retry-maxtimeout 120000

# Install global packages needed for build
RUN npm install -g typescript shx

# Copy package files and modify to prevent prepare script from running
COPY package*.json ./
RUN node -e "const pkg = require('./package.json'); delete pkg.scripts.prepare; require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2));"

# Install dependencies without running the prepare script, including sharp with the correct platform
RUN npm cache clean --force && \
    npm install --legacy-peer-deps --no-optional && \
    npm install --platform=linuxmusl --arch=x64 sharp

# Copy source code
COPY . .

# Build TypeScript code manually
RUN npx tsc && \
    npx shx chmod +x dist/*.js

# Switch to production for runtime
ENV NODE_ENV=production

# The API key should be passed at runtime
# ENV OPENROUTER_API_KEY=your-api-key-here
# ENV OPENROUTER_DEFAULT_MODEL=your-default-model

# Run the server
CMD ["node", "dist/index.js"]
