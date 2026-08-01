#!/usr/bin/env bash
# Deploy the PumpFun channel bot to Google Cloud Run.
#
#   ./deploy-cloudrun.sh
#
# Reads configuration from .env in this directory, stores the Telegram token in
# Secret Manager, and deploys a single always-on instance. Re-running it is a
# safe redeploy: the secret is versioned, not duplicated.
#
# Requires: gcloud authenticated (`gcloud auth login`) with run.admin,
# secretmanager.admin and cloudbuild.builds.editor on the target project.

set -euo pipefail

cd "$(dirname "$0")"

SERVICE="${SERVICE:-pumpfun-channel-bot}"
REGION="${REGION:-us-central1}"
PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
SECRET_NAME="${SECRET_NAME:-pumpfun-channel-bot-token}"

if [[ -z "${PROJECT}" || "${PROJECT}" == "(unset)" ]]; then
    echo "No GCP project set. Use: PROJECT=my-project $0" >&2
    exit 1
fi

if [[ ! -f .env ]]; then
    echo "No .env found in $(pwd). Copy .env.example and fill it in first." >&2
    exit 1
fi

# Pull the token out of .env; everything else ships as plain env vars.
TOKEN="$(grep -E '^TELEGRAM_BOT_TOKEN=' .env | head -1 | cut -d= -f2-)"
if [[ -z "${TOKEN}" ]]; then
    echo "TELEGRAM_BOT_TOKEN is not set in .env" >&2
    exit 1
fi

echo "Project: ${PROJECT}   Service: ${SERVICE}   Region: ${REGION}"

# Store (or rotate) the bot token in Secret Manager.
if gcloud secrets describe "${SECRET_NAME}" --project "${PROJECT}" >/dev/null 2>&1; then
    printf '%s' "${TOKEN}" | gcloud secrets versions add "${SECRET_NAME}" \
        --data-file=- --project "${PROJECT}" >/dev/null
    echo "Secret ${SECRET_NAME}: new version added"
else
    printf '%s' "${TOKEN}" | gcloud secrets create "${SECRET_NAME}" \
        --data-file=- --replication-policy=automatic --project "${PROJECT}" >/dev/null
    echo "Secret ${SECRET_NAME}: created"
fi

# Every non-secret key from .env becomes a runtime env var. This goes through
# a YAML file, not --set-env-vars: values here legitimately contain commas
# (SOLANA_RPC_URLS is a comma-separated list) and "@" (CHANNEL_ID), so both the
# default comma separator and the ^@^ alternate-delimiter trick would corrupt
# them. Quoting every value as a YAML string is the only lossless path.
ENV_YAML="$(mktemp -t channel-bot-env-XXXXXX.yaml)"
trap 'rm -f "${ENV_YAML}"' EXIT

while IFS= read -r line; do
    [[ "${line}" =~ ^[[:space:]]*# || -z "${line// }" ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    [[ "${key}" == "TELEGRAM_BOT_TOKEN" ]] && continue
    [[ -z "${key}" ]] && continue
    # Escape double quotes for YAML, then emit a quoted scalar.
    printf '%s: "%s"\n' "${key}" "${value//\"/\\\"}" >> "${ENV_YAML}"
done < .env

echo "Shipping $(wc -l < "${ENV_YAML}") env vars (token comes from Secret Manager)"

gcloud run deploy "${SERVICE}" \
    --source . \
    --project "${PROJECT}" \
    --region "${REGION}" \
    --platform managed \
    --min-instances 1 \
    --max-instances 1 \
    --no-cpu-throttling \
    --port 3000 \
    --no-allow-unauthenticated \
    --env-vars-file "${ENV_YAML}" \
    --set-secrets "TELEGRAM_BOT_TOKEN=${SECRET_NAME}:latest"

echo
echo "Deployed. Logs:"
echo "  gcloud run services logs tail ${SERVICE} --region ${REGION} --project ${PROJECT}"
