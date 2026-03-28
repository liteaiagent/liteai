#!/bin/bash
#
# AI4ALL Interactive CLI Token Generator & LLM Tester
# Supports gcloud exchange OR Browser Fallback
#
# Version: 1.2.0
#
# Usage:
#   ./llm-cli.sh <client_id> <client_secret> [--force-browser]
#

set -e

# Configuration
VERSION="1.2.0"
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

# Define path for local token storage
TOKEN_DIR="${HOME}/.ai4all/creds"
TOKEN_FILE="${TOKEN_DIR}/${CLIENT_ID}"

echo "=========================================================="
echo "🔑 AI4ALL Token Generator (v${VERSION})"
echo "=========================================================="

save_tokens() {
    mkdir -p "${TOKEN_DIR}"
    echo "SAVED_ACCESS_TOKEN=\"$1\"" > "$TOKEN_FILE"
    echo "SAVED_REFRESH_TOKEN=\"$2\"" >> "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
}

NEEDS_LOGIN=true

# 1. Attempt to use saved session (Refresh Token Flow)
if [ -f "$TOKEN_FILE" ] && [ "$FORCE_BROWSER" = false ]; then
    source "$TOKEN_FILE"

    # Check if access token is still valid
    TOKEN_VALID=false
    if [ -n "$SAVED_ACCESS_TOKEN" ] && [ "$SAVED_ACCESS_TOKEN" != "null" ]; then
        # Extract payload and decode base64
        PAYLOAD=$(echo "$SAVED_ACCESS_TOKEN" | cut -d'.' -f2 | tr '_-' '/+' | awk '{m=length()%4; if(m==2) print $0"=="; else if(m==3) print $0"="; else print $0}')
        EXP_TIME=$(echo "$PAYLOAD" | base64 -d 2>/dev/null | grep -o '"exp":[^,}]*' | awk -F':' '{print $2}' || echo "0")

        if [[ "$EXP_TIME" =~ ^[0-9]+$ ]]; then
            CURRENT_TIME=$(date +%s)
            # Add 60s buffer to avoid edge cases
            if [ "$CURRENT_TIME" -lt $((EXP_TIME - 60)) ]; then
                TOKEN_VALID=true
                echo "♻️  Found valid saved access token in ${TOKEN_FILE}."
                APIGEE_JWT=$SAVED_ACCESS_TOKEN
                NEEDS_LOGIN=false
            fi
        fi
    fi

    # If access token is invalid/expired, try to use refresh token
    if [ "$TOKEN_VALID" = false ] && [ -n "$SAVED_REFRESH_TOKEN" ] && [ "$SAVED_REFRESH_TOKEN" != "null" ]; then
        echo "♻️  Found saved session, but access token is expired."
        echo "📡 Attempting to refresh access token..."

        REFRESH_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "https://${APIGEE_HOST}/rsd/ai4all/auth/token" \
            -A "${USER_AGENT}" \
            -H "Authorization: Basic $(echo -n "${CLIENT_ID}:${CLIENT_SECRET}" | base64 -w 0)" \
            -H "Content-Type: application/x-www-form-urlencoded" \
            -H "${CLIENT_HEADER}" \
            -d "grant_type=refresh_token" \
            -d "refresh_token=${SAVED_REFRESH_TOKEN}")

        REFRESH_HTTP_STATUS=$(echo "$REFRESH_RESPONSE" | tail -n1)
        REFRESH_BODY=$(echo "$REFRESH_RESPONSE" | sed '$d')

        if [ "$REFRESH_HTTP_STATUS" = "200" ]; then
            echo "✅ Successfully refreshed token!"
            if command -v jq &> /dev/null; then
                APIGEE_JWT=$(echo "$REFRESH_BODY" | jq -r .access_token)
                REFRESH_TOKEN=$(echo "$REFRESH_BODY" | jq -r .refresh_token)
            else
                APIGEE_JWT=$(echo "$REFRESH_BODY" | grep -o '"access_token"[^,]*' | awk -F'"' '{print $4}')
                REFRESH_TOKEN=$(echo "$REFRESH_BODY" | grep -o '"refresh_token"[^,}]*' | awk -F'"' '{print $4}')
            fi

            # Save the newly rotated tokens
            save_tokens "$APIGEE_JWT" "$REFRESH_TOKEN"
            NEEDS_LOGIN=false
        else
            echo "⚠️  Refresh token expired or invalid (HTTP ${REFRESH_HTTP_STATUS}). Proceeding to full login..."
        fi
    fi
fi

# 2. Perform Full Login (if needed)
if [ "$NEEDS_LOGIN" = true ]; then
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

        if command -v jq &> /dev/null; then
            APIGEE_JWT=$(echo "$RESPONSE_BODY" | jq -r .access_token)
            REFRESH_TOKEN=$(echo "$RESPONSE_BODY" | jq -r .refresh_token)
        else
            APIGEE_JWT=$(echo "$RESPONSE_BODY" | grep -o '"access_token"[^,]*' | awk -F'"' '{print $4}')
            REFRESH_TOKEN=$(echo "$RESPONSE_BODY" | grep -o '"refresh_token"[^,}]*' | awk -F'"' '{print $4}')
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
        echo "📋 (Optional) Copy the 'refresh_token' value to save for future runs."
        echo -n "Paste Refresh Token (or press Enter to skip): "
        read -r REFRESH_TOKEN
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

    if [ -n "${REFRESH_TOKEN}" ] && [ "${REFRESH_TOKEN}" != "null" ]; then
        save_tokens "$APIGEE_JWT" "$REFRESH_TOKEN"
        echo "💾 Session saved to ${TOKEN_FILE}"
    fi
    echo ""
fi

# 3. Verify and Test
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
    curl -s -X POST "https://${APIGEE_HOST}/rsd/ai4all/llm/v1/chat/completions" \
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
