ARG BUILD_FROM
FROM ${BUILD_FROM}

RUN apk add --no-cache nodejs npm

WORKDIR /app
COPY package.json server.js ./
COPY examples ./examples

COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD ["/run.sh"]
