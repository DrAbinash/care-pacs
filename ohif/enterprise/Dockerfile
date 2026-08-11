# CARE Diagnostics OHIF Enterprise Build
# Builds OHIF from source and bakes CARE-only Orthanc config.
# This avoids demo datasource and avoids ohif/app entrypoint rewriting.

FROM node:18-bullseye AS builder

ARG OHIF_BRANCH=v3.10.0

WORKDIR /opt

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch ${OHIF_BRANCH} https://github.com/OHIF/Viewers.git ohif

WORKDIR /opt/ohif

RUN yarn install --frozen-lockfile

# Replace runtime config with CARE-only Orthanc config
COPY app-config.js /opt/ohif/platform/app/public/app-config.js

# Build default OHIF app
RUN yarn build

FROM nginx:1.25-alpine

COPY --from=builder /opt/ohif/platform/app/dist /usr/share/nginx/html
COPY app-config.js /usr/share/nginx/html/app-config.js
COPY default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
