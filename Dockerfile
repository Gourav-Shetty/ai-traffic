FROM node:20-slim

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Rebuild native modules for Linux (better-sqlite3, etc.)
RUN npm rebuild

# Copy application source
COPY . .

# Build TypeScript (if needed for production)
# RUN npm run build

# Expose development server port
EXPOSE 4000

# Run dev server
CMD ["npm", "run", "dev"]
