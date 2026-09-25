# CARE Diagnostics Viewer — OHIF enterprise image
# Pins an immutable OHIF commit and injects CARE-owned customisation assets.
# Does not vendor the OHIF monorepo. Does not alter Orthanc storage or MWL.

FROM node:18-bookworm AS builder

# Human-facing tag (documentation). Immutable pin is OHIF_COMMIT.
# DO NOT change OHIF_REF / OHIF_COMMIT without an explicit clinical migration plan.
# Builder OS is Bookworm for apt reliability only — Node stays 18; OHIF stays frozen.
ARG OHIF_REF=v3.10.0
ARG OHIF_COMMIT=0b6e9cba7613dba1df883985d3c821a86b3ba0ff
ARG CARE_VIEWER_VERSION=1.2.0-p2-radiologist

WORKDIR /opt

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates python3 make g++ patch \
    && rm -rf /var/lib/apt/lists/*

# Fetch exactly one commit (reproducible; fails if SHA unavailable).
RUN mkdir ohif \
 && cd ohif \
 && git init \
 && git remote add origin https://github.com/OHIF/Viewers.git \
 && git fetch --depth 1 origin "${OHIF_COMMIT}" \
 && git checkout --force FETCH_HEAD \
 && test "$(git rev-parse HEAD)" = "${OHIF_COMMIT}" \
 && echo "Pinned OHIF commit $(git rev-parse HEAD) (ref ${OHIF_REF})"

WORKDIR /opt/ohif

# CARE patches against the frozen commit only — fail the build if they do not apply.
COPY patches /opt/care-patches
RUN set -eu; \
  for p in /opt/care-patches/v3.10.0-*.patch; do \
    echo "Applying CARE patch $p"; \
    patch -p1 --forward --dry-run < "$p"; \
    patch -p1 --forward < "$p"; \
  done

# CARE hanging protocols (registered via patched getHangingProtocolModule).
COPY care-customization/hanging-protocols/ohif/careProtocols.js \
     /opt/ohif/extensions/default/src/hangingprotocols/care/careProtocols.js

RUN yarn install --frozen-lockfile

# CARE runtime config: webpack APP_CONFIG defaults to config/default.js.
# Also land as public/app-config.js for clarity; final stage overwrites dist.
COPY app-config.js /opt/ohif/platform/app/public/config/default.js
COPY app-config.js /opt/ohif/platform/app/public/app-config.js

# CARE-owned assets must exist or the build fails.
COPY care-customization /opt/care-customization
RUN test -f /opt/care-customization/care-bridge.js \
 && test -f /opt/care-customization/care-chrome.js \
 && test -f /opt/care-customization/care-config.js \
 && test -f /opt/care-customization/care-security.js \
 && test -f /opt/care-customization/care-measurement.js \
 && test -f /opt/care-customization/measurement/care-measurement-adapter.js \
 && test -f /opt/care-customization/assets/care-diagnostics-logo.png

COPY scripts/inject-care-customization.sh /opt/scripts/inject-care-customization.sh
COPY scripts/record-build-metadata.sh /opt/scripts/record-build-metadata.sh
RUN chmod +x /opt/scripts/inject-care-customization.sh /opt/scripts/record-build-metadata.sh

RUN yarn build \
 && /opt/scripts/inject-care-customization.sh /opt/ohif/platform/app/dist /opt/care-customization \
 && /opt/scripts/record-build-metadata.sh /opt/ohif/platform/app/dist \
      --care-version "${CARE_VIEWER_VERSION}" \
      --ohif-ref "${OHIF_REF}" \
      --ohif-commit "${OHIF_COMMIT}"

FROM nginx:1.25-alpine

COPY --from=builder /opt/ohif/platform/app/dist /usr/share/nginx/html
COPY app-config.js /usr/share/nginx/html/app-config.js
COPY default.conf /etc/nginx/conf.d/default.conf

# Fail image build if CARE injection did not land.
RUN test -f /usr/share/nginx/html/care/care-bridge.js \
 && test -f /usr/share/nginx/html/care/build-info.json \
 && test -f /usr/share/nginx/html/care/assets/care-diagnostics-logo.png \
 && grep -q 'care/care-bridge.js' /usr/share/nginx/html/index.html \
 && grep -q 'CARE Diagnostics Viewer' /usr/share/nginx/html/app-config.js \
 && grep -q "care-diagnostics-logo.png" /usr/share/nginx/html/app-config.js \
 && test -f /usr/share/nginx/html/care/care-measurement.js \
 && test -f /usr/share/nginx/html/care/measurement/care-measurement-adapter.js \
 && grep -q 'care/care-measurement.js' /usr/share/nginx/html/index.html \
 && grep -q "care.mriBrain" /usr/share/nginx/html/app-config.js \
 && grep -q "ct-subdural" /usr/share/nginx/html/app-config.js

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz && wget -q -O /dev/null http://127.0.0.1/app-config.js || exit 1

CMD ["nginx", "-g", "daemon off;"]
