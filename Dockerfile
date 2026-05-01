FROM node:20-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p data/boards data/sessions uploads

EXPOSE 3000

CMD ["node", "server.js"]
