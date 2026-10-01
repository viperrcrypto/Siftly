#!/usr/bin/env bash
# Setup a persistent Cloudflare Tunnel for Siftly
#
# Prerequisites:
# 1. .env.cloudflare with Cloudflare credentials
# 2. cloudflared installed
#
# Usage:
#   ./scripts/setup-tunnel.sh
#
# Creates subdomain:
#   - {prefix}.atlasguide.dev -> http://localhost:15000

set -eo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Siftly Cloudflare Tunnel Setup ===${NC}\n"

# Load from .env.cloudflare
if [[ -f .env.cloudflare ]]; then
    echo -e "Loading config from .env.cloudflare"
    set -a
    source .env.cloudflare
    set +a
else
    echo -e "${RED}Error: .env.cloudflare not found${NC}"
    echo ""
    echo "Create .env.cloudflare with:"
    echo "  CLOUDFLARE_API_TOKEN=your-token"
    echo "  CLOUDFLARE_ACCOUNT_ID=your-account-id"
    echo "  CLOUDFLARE_ZONE_ID=your-zone-id"
    echo "  CLOUDFLARE_DOMAIN=atlasguide.dev"
    echo "  CLOUDFLARE_SUBDOMAIN_PREFIX=siftly"
    exit 1
fi

# Check for required variables
MISSING_VARS=()
for var in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_ZONE_ID CLOUDFLARE_DOMAIN CLOUDFLARE_SUBDOMAIN_PREFIX; do
    if [[ -z "${!var:-}" ]]; then
        MISSING_VARS+=("$var")
    fi
done

if [[ ${#MISSING_VARS[@]} -gt 0 ]]; then
    echo -e "${RED}Error: Missing required variables in .env.cloudflare:${NC}"
    for var in "${MISSING_VARS[@]}"; do
        echo "  - $var"
    done
    exit 1
fi

PREFIX="$CLOUDFLARE_SUBDOMAIN_PREFIX"
TUNNEL_NAME="${PREFIX}-dev"
PORT="${PORT:-15000}"

echo -e "${YELLOW}Setting up tunnel '${TUNNEL_NAME}' for domain: ${CLOUDFLARE_DOMAIN}${NC}"
echo ""

# Check if tunnel already exists
existing=$(curl -s "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel?name=${TUNNEL_NAME}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json")

TUNNEL_ID=$(echo "$existing" | jq -r '.result[0].id // empty')
TUNNEL_TOKEN=""

if [[ -n "$TUNNEL_ID" ]]; then
    echo -e "${YELLOW}Tunnel '${TUNNEL_NAME}' already exists (ID: ${TUNNEL_ID})${NC}"

    token_response=$(curl -s "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/token" \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}")
    TUNNEL_TOKEN=$(echo "$token_response" | jq -r '.result // empty')

    if [[ -z "$TUNNEL_TOKEN" ]]; then
        echo -e "${RED}Failed to retrieve tunnel token for existing tunnel ${TUNNEL_ID}${NC}"
        exit 1
    fi
else
    echo -e "${BLUE}Creating tunnel: ${TUNNEL_NAME}${NC}"

    response=$(curl -s "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel" \
        -X POST \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
        -H "Content-Type: application/json" \
        --data "{\"name\": \"${TUNNEL_NAME}\", \"config_src\": \"cloudflare\"}")

    if ! echo "$response" | jq -e '.success' > /dev/null; then
        echo -e "${RED}Failed to create tunnel: $(echo "$response" | jq -r '.errors[0].message // .errors // "Unknown error"')${NC}"
        exit 1
    fi

    TUNNEL_ID=$(echo "$response" | jq -r '.result.id')
    TUNNEL_TOKEN=$(echo "$response" | jq -r '.result.token')

    echo -e "${GREEN}Created tunnel: ${TUNNEL_ID}${NC}"
fi

HOSTNAME_APP="${PREFIX}.${CLOUDFLARE_DOMAIN}"

# Configure tunnel route
echo -e "${BLUE}Configuring tunnel route...${NC}"

config_response=$(curl -s "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/configurations" \
    -X PUT \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{
        \"config\": {
            \"ingress\": [
                {\"hostname\": \"${HOSTNAME_APP}\", \"service\": \"http://localhost:${PORT}\", \"originRequest\": {}},
                {\"service\": \"http_status:404\"}
            ]
        }
    }")

if ! echo "$config_response" | jq -e '.success' > /dev/null; then
    echo -e "${RED}Failed to configure tunnel: $(echo "$config_response" | jq -r '.errors[0].message // .errors // "Unknown error"')${NC}"
    exit 1
fi

echo -e "${GREEN}Tunnel configured: ${HOSTNAME_APP} -> http://localhost:${PORT}${NC}"
echo ""

# Create DNS record
echo -e "${BLUE}Creating DNS record...${NC}"

dns_check=$(curl -s "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?name=${HOSTNAME_APP}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}")

existing_dns=$(echo "$dns_check" | jq -r '.result[0].id // empty')

if [[ -n "$existing_dns" ]]; then
    dns_response=$(curl -s "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${existing_dns}" \
        -X PATCH \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
        -H "Content-Type: application/json" \
        --data "{
            \"type\": \"CNAME\",
            \"name\": \"${HOSTNAME_APP}\",
            \"content\": \"${TUNNEL_ID}.cfargotunnel.com\",
            \"proxied\": true
        }")
    if ! echo "$dns_response" | jq -e '.success' > /dev/null; then
        echo -e "${RED}Failed to update DNS: $(echo "$dns_response" | jq -r '.errors[0].message // "Unknown error"')${NC}"
        exit 1
    fi
    echo -e "  ${YELLOW}Updated: ${HOSTNAME_APP}${NC}"
else
    dns_response=$(curl -s "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
        -X POST \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
        -H "Content-Type: application/json" \
        --data "{
            \"type\": \"CNAME\",
            \"name\": \"${HOSTNAME_APP}\",
            \"content\": \"${TUNNEL_ID}.cfargotunnel.com\",
            \"proxied\": true
        }")
    if ! echo "$dns_response" | jq -e '.success' > /dev/null; then
        echo -e "${RED}Failed to create DNS: $(echo "$dns_response" | jq -r '.errors[0].message // "Unknown error"')${NC}"
        exit 1
    fi
    echo -e "  ${GREEN}Created: ${HOSTNAME_APP}${NC}"
fi
echo ""

# Save tunnel token to .env
if grep -q "CLOUDFLARE_TUNNEL_TOKEN" .env 2>/dev/null; then
    if [[ "$(uname)" == "Darwin" ]]; then
        sed -i '' "s|^CLOUDFLARE_TUNNEL_TOKEN=.*|CLOUDFLARE_TUNNEL_TOKEN=${TUNNEL_TOKEN}|" .env
    else
        sed -i "s|^CLOUDFLARE_TUNNEL_TOKEN=.*|CLOUDFLARE_TUNNEL_TOKEN=${TUNNEL_TOKEN}|" .env
    fi
else
    echo "CLOUDFLARE_TUNNEL_TOKEN=${TUNNEL_TOKEN}" >> .env
fi

echo -e "${GREEN}=== Setup Complete ===${NC}"
echo ""
echo -e "  ${BLUE}URL${NC}: https://${HOSTNAME_APP}"
echo -e "  ${BLUE}Tunnel ID${NC}: ${TUNNEL_ID}"
echo ""
echo -e "${YELLOW}To start the tunnel:${NC}"
echo "  cloudflared tunnel --no-autoupdate run --token \$CLOUDFLARE_TUNNEL_TOKEN"
echo ""
echo -e "Or use: ${GREEN}./start.sh${NC} (starts both app + tunnel)"
