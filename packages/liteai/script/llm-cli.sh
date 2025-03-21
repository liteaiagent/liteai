#!/bin/bash
#
# AI4ALL Interactive CLI Token Generator & LLM Tester
# Supports gcloud exchange OR Browser Fallback
#
# Version: 1.0.0
#
# Usage:
#   ./llm-cli.sh <client_id> <client_secret> [--force-browser]
#

set -e

# Configuration
VERSION="1.0.0"
APIGEE_HOST="api-dev.valeo.com"
USER_AGENT="llm-cli/${VERSION}"
CLIENT_HEADER="x-ai4all-client: llm-cli/${VERSION}"

if [ $# -lt 2 ]; then
    echo "Usage: $0 <client_id> <client_secret> [--force-browser]"
    exit 1
fi

CLIENT_ID=$1
CLIENT_SECRET=$2
FORCE_BROWSER=false

if [[ "$3" == "--force-browser" ]]; then
    FORCE_BROWSER=true
fi

echo "=========================================================="
echo "🔑 AI4ALL Token Generator (v${VERSION})"
echo "=========================================================="

# 1. Determine Auth Method
if command -v gcloud &> /dev/null && [ "$FORCE_BROWSER" = false ]; then
    echo "☁️  Found gcloud CLI. Using Token Exchange flow..."

    GOOGLE_ID_TOKEN=$(gcloud auth print-identity-token 2>/dev/null || true)
    if [ -z "${GOOGLE_ID_TOKEN}" ]; then
        echo "⚠️  Not authenticated with Google. Please log in..."
        gcloud auth login --update-adc
        GOOGLE_ID_TOKEN=$(gcloud auth print-identity-token)
    fi

    echo "📡 Exchanging Google Token for Apigee JWT..."
    AUTH_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "https://${APIGEE_HOST}/rsd/ai4all/auth/token-exchange" \
        -A "${USER_AGENT}" \
        -H "Authorization: Basic $(echo -n "${CLIENT_ID}:${CLIENT_SECRET}" | base64 -w 0)" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -H "${CLIENT_HEADER}" \
        -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
        -d "subject_token=${GOOGLE_ID_TOKEN}" \
        -d "subject_token_type=urn:ietf:params:oauth:token-type:id_token")

    HTTP_STATUS=$(echo "$AUTH_RESPONSE" | tail -n1)
    RESPONSE_BODY=$(echo "$AUTH_RESPONSE" | sed '$d')

    if [ "$HTTP_STATUS" != "200" ]; then
        echo "❌ Token exchange failed (HTTP ${HTTP_STATUS}):"
        echo "$RESPONSE_BODY" | grep -q '{' && echo "$RESPONSE_BODY" | jq . || echo "$RESPONSE_BODY"
        exit 1
    fi

    # Try to parse with jq if available, otherwise use basic grep/sed
    if command -v jq &> /dev/null; then
        APIGEE_JWT=$(echo "$RESPONSE_BODY" | jq -r .access_token)
    else
        APIGEE_JWT=$(echo "$RESPONSE_BODY" | grep -o '"access_token"[^,]*' | awk -F'"' '{print $4}')
    fi

else
    if [ "$FORCE_BROWSER" = true ]; then
        echo "🌐 Forced Browser-based flow via --force-browser flag..."
    else
        echo "🌐 gcloud not found. Using Browser-based fallback..."
    fi

    REDIRECT_URI="https://${APIGEE_HOST}/rsd/ai4all/auth/callback"

    echo "🔗 Generating Login URL..."
    AUTH_URL=$(curl -s -i -X POST "https://${APIGEE_HOST}/rsd/ai4all/auth/authorize" \
        -A "${USER_AGENT}" \
        -H "Authorization: Basic $(echo -n "${CLIENT_ID}:${CLIENT_SECRET}" | base64 -w 0)" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -H "${CLIENT_HEADER}" \
        -d "redirect_uri=${REDIRECT_URI}&scope=openid email profile" | grep -i "location:" | awk '{print $2}' | tr -d '\r')

    if [ -z "${AUTH_URL}" ]; then
        echo "❌ Failed to generate Auth URL. Check your Client ID/Secret and redirect_uris configuration."
        exit 1
    fi

    echo ""
    echo "👉 Please open this URL in your browser and sign in:"
    echo ""
    echo "${AUTH_URL}"
    echo ""
    echo "After signing in, your browser will show a JSON response."
    echo "📋 Copy the 'access_token' value from that JSON and paste it below."
    echo ""
    echo -n "Paste Access Token: "
    read -r APIGEE_JWT
    echo ""
fi

if [ -z "${APIGEE_JWT}" ] || [ "${APIGEE_JWT}" = "null" ]; then
    echo "❌ No token provided. Exiting."
    exit 1
fi

echo "✅ Apigee JWT acquired."
echo ""
echo "🔐 Token (set as AI4ALL_API_KEY):"
echo ""
echo "${APIGEE_JWT}"
echo ""

# 2. Verify and Test
echo "=========================================================="
echo "👤 User Info (from Token)"
echo "=========================================================="
if command -v jq &> /dev/null; then
    curl -s "https://${APIGEE_HOST}/rsd/ai4all/auth/userinfo" \
        -A "${USER_AGENT}" \
        -H "Authorization: Bearer ${APIGEE_JWT}" \
        -H "${CLIENT_HEADER}" | jq .
else
    curl -s "https://${APIGEE_HOST}/rsd/ai4all/auth/userinfo" \
        -A "${USER_AGENT}" \
        -H "Authorization: Bearer ${APIGEE_JWT}" \
        -H "${CLIENT_HEADER}"
    echo ""
fi
echo ""

echo "=========================================================="
echo "🤖 Testing LLM Gateway"
echo "=========================================================="
if command -v jq &> /dev/null; then
    curl -s -X POST "https://${APIGEE_HOST}/rsd/ai4all/llm/v1/chat/completions" \
        -A "${USER_AGENT}" \
        -H "Authorization: Bearer ${APIGEE_JWT}" \
        -H "Content-Type: application/json" \
        -H "${CLIENT_HEADER}" \
        -d '{"model": "gemini-3.1-pro-preview", "messages": [{"role": "user", "content": "Hello in exactly 3 words."}]}' | jq .
else
    curl -s -X POST "C" \
        -A "${USER_AGENT}" \
        -H "Authorization: Bearer ${APIGEE_JWT}" \
        -H "Content-Type: application/json" \
        -H "${CLIENT_HEADER}" \
        -d '{"model": "gemini-3-pro-preview", "messages": [{"role": "user", "content": "Hello in exactly 3 words."}]}'
    echo ""
fi

echo "=========================================================="
echo "🧠 Available Models"
echo "=========================================================="
if command -v jq &> /dev/null; then
    curl -s -X GET "https://${APIGEE_HOST}/rsd/ai4all/llm/models" \
        -A "${USER_AGENT}" \
        -H "Authorization: Bearer ${APIGEE_JWT}" \
        -H "${CLIENT_HEADER}" | jq -r '.data[].id'
else
    curl -s -X GET "https://${APIGEE_HOST}/rsd/ai4all/llm/models" \
        -A "${USER_AGENT}" \
        -H "Authorization: Bearer ${APIGEE_JWT}" \
        -H "${CLIENT_HEADER}"
fi

echo ""
echo "=========================================================="
echo "🎉 Done."
echo "=========================================================="
