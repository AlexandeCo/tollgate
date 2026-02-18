FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 4243 4244
ENV ANTHROPIC_BASE_URL=""
CMD ["node", "bin/sniff.js", "start"]
