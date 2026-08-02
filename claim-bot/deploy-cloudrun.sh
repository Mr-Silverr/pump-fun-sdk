#!/usr/bin/env bash
# Deploy the PumpFun claim bot (@pfclaimsbot) to Google Cloud Run.
#
#   ./deploy-cloudrun.sh
#
# Reads configuration from .env in this directory, stores the Telegram token in
# Secret Manager, and deploys a single always-on instance. Re-running it is a
# safe redeploy: the secret is versioned, not duplicated.
#
# Requires: gcloud authenticated (`gcloud auth login`) with run.admin,
# secretmanager.admin and cloudbuild.builds.editor on the target project.
#
# Tracking state (tracked items, per-chat settings, claim history) is mirrored
# to the Cloud Storage bucket in STATE_BUCKET, because the container filesystem
# is scratch space: without the mirror, every redeploy would drop what users
# track. The script creates the bucket and grants the runtime service account
# on first run. Max instances is pinned to 1: two instances would both long-poll
# the same Telegram bot and fight over updates.

set -euo pipefail

cd "$(dirname "$0")"

SERVICE="${SERVICE:-pumpfun-claim-bot}"
REGION="${REGION:-us-central1}"
PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
SECRET_NAME="${SECRET_NAME:-pumpfun-claim-bot-token}"
STATE_BUCKET="${STATE_BUCKET:-pumpfun-bot-state}"
# The project's default compute service account was deleted, so both the build
# and the runtime identity have to be pinned or the deploy fails.
BUILD_SA="${BUILD_SA:-three-ws-build@${PROJECT}.iam.gserviceaccount.com}"
RUNTIME_SA="${RUNTIME_SA:-three-ws@${PROJECT}.iam.gserviceaccount.com}"

if [[ -z "${PROJECT}" || "${PROJECT}" == "(unset)" ]]; then
    echo "No GCP project set. Use: PROJECT=my-project $0" >&2
    exit 1
fi

if [[ ! -f .env ]]; then
    echo "No .env found in $(pwd). Copy .env.example and fill it in first." >&2
    exit 1
fi

TOKEN="$(grep -E '^TELEGRAM_BOT_TOKEN=' .env | head -1 | cut -d= -f2-)"
if [[ -z "${TOKEN}" ]]; then
    echo "TELEGRAM_BOT_TOKEN is not set in .env (get it from @BotFather)" >&2
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

# Project-level access is not enough: without a per-secret binding the revision
# fails to create with a secret-access error.
gcloud secrets add-iam-policy-binding "${SECRET_NAME}" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role=roles/secretmanager.secretAccessor \
    --project "${PROJECT}" >/dev/null
echo "Secret access: ${RUNTIME_SA} can read ${SECRET_NAME}"

# State bucket: created once, and readable/writable by the runtime identity.
if gcloud storage buckets describe "gs://${STATE_BUCKET}" --project "${PROJECT}" >/dev/null 2>&1; then
    echo "State bucket gs://${STATE_BUCKET}: present"
else
    gcloud storage buckets create "gs://${STATE_BUCKET}" \
        --project "${PROJECT}" --location "${REGION}" --uniform-bucket-level-access >/dev/null
    echo "State bucket gs://${STATE_BUCKET}: created"
fi
gcloud storage buckets add-iam-policy-binding "gs://${STATE_BUCKET}" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role=roles/storage.objectAdmin \
    --project "${PROJECT}" >/dev/null
echo "State bucket access: ${RUNTIME_SA} can read and write objects"

# Every non-secret key from .env becomes a runtime env var, through a YAML file
# rather than --set-env-vars: SOLANA_RPC_URLS is a comma-separated list, so both
# the default comma separator and the ^@^ alternate-delimiter trick corrupt it.
ENV_YAML="$(mktemp -t claim-bot-env-XXXXXX.yaml)"
trap 'rm -f "${ENV_YAML}"' EXIT

while IFS= read -r line; do
    [[ "${line}" =~ ^[[:space:]]*# || -z "${line// }" ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    [[ "${key}" == "TELEGRAM_BOT_TOKEN" ]] && continue
    [[ "${key}" == "STATE_BUCKET" ]] && continue
    [[ -z "${key}" || -z "${value}" ]] && continue
    printf '%s: "%s"\n' "${key}" "${value//\"/\\\"}" >> "${ENV_YAML}"
done < .env

# The mirror is not optional in this deployment: state has nowhere else to live.
printf 'STATE_BUCKET: "%s"\n' "${STATE_BUCKET}" >> "${ENV_YAML}"

echo "Shipping $(wc -l < "${ENV_YAML}") env vars (token comes from Secret Manager)"

# Build from a copy, not from the live directory: other agents edit this
# worktree concurrently and `gcloud run deploy --source` uploads files one by
# one, so an edit landing mid-upload ships a torn tree that fails to compile.
STAGE="$(mktemp -d -t claim-bot-src-XXXXXX)"
trap 'rm -f "${ENV_YAML}"; rm -rf "${STAGE}"' EXIT
cp -a package.json tsconfig.json Dockerfile src "${STAGE}/"
for optional in .dockerignore .gcloudignore package-lock.json; do
    [[ -f "${optional}" ]] && cp -a "${optional}" "${STAGE}/"
done
true
echo "Staged build context at ${STAGE}"

gcloud run deploy "${SERVICE}" \
    --source "${STAGE}" \
    --project "${PROJECT}" \
    --region "${REGION}" \
    --platform managed \
    --build-service-account "projects/${PROJECT}/serviceAccounts/${BUILD_SA}" \
    --service-account "${RUNTIME_SA}" \
    --memory 2Gi \
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
