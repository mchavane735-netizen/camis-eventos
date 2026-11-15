FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --include=dev --legacy-peer-deps --no-audit --no-fund
RUN npx vite --version || npm install --no-save --legacy-peer-deps --no-audit --no-fund vite esbuild @vitejs/plugin-react
RUN npx vite --version
COPY . .
RUN npm run build
CMD ["npm", "start"]
