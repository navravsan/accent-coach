FROM node:20

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
EXPOSE 8080

CMD ["npm", "run", "server:prod"]
