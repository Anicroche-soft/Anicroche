FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY avec ./avec

CMD ["npm", "start"]
