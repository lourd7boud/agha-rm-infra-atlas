FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Create uploads directory
RUN mkdir -p /app/uploads /app/logs

EXPOSE 3000

CMD ["node", "dist/index.js"]
