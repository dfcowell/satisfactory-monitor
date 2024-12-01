FROM docker:cli

RUN apk add --no-cache nodejs npm

RUN mkdir /app

ADD ./package.json /app
ADD ./package-lock.json /app

WORKDIR /app

RUN npm ci

ADD . .

ENTRYPOINT [ "node" ]