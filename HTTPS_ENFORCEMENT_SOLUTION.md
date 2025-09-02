# HTTPS Enforcement for local-mcp-server.dev MCP Server

This document provides a comprehensive solution to enforce HTTPS on your localhost environment for the Directus MCP server.

## Problem Summary

Your MCP server configuration is trying to connect to `https://local-mcp-server.dev/server/ping` but encounters SSL certificate verification errors, causing the connection to fail with "unable to verify the first certificate" errors.

## Root Cause Analysis

1. **Certificate Configuration**: You have the correct CA certificate configured but SSL verification is still failing
2. **Health Check Endpoint**: The MCP server was trying `/server/ping` which may not be available in all Directus versions
3. **DNS Resolution**: The domain `local-mcp-server.dev` needs to resolve to localhost
4. **Certificate Trust**: The mkcert root CA needs to be properly configured

## Complete Solution

### 1. Updated Environment Configuration

Your `.env` file has been updated with proper HTTPS configuration:

```bash
DIRECTUS_URL=https://local-mcp-server.dev
DIRECTUS_TOKEN=your_DIRECTUS_TOKEN_here
DIRECTUS_HTTPS_CA=/Users/jorgenunes/2026/DirectusRoom/certs/rootCA.pem
DIRECTUS_HTTPS_REJECT_UNAUTHORIZED=true
DIRECTUS_TIMEOUT=30000
DIRECTUS_RETRIES=3
DIRECTUS_WEBSOCKET=false
NODE_ENV=development

# Enhanced HTTPS Configuration
DIRECTUS_HTTPS_SERVERNAME=local-mcp-server.dev
```

Key changes:
- `DIRECTUS_HTTPS_REJECT_UNAUTHORIZED=true` - Now enforces SSL certificate validation
- Added `DIRECTUS_HTTPS_SERVERNAME=local-mcp-server.dev` - Ensures proper SNI

### 2. Enhanced Health Check Implementation

The DirectusClient has been updated with a more robust ping method that:
- Tries multiple health check endpoints (`/server/ping`, `/server/health`, `/utils/health`, `/admin/server/health`)
- Falls back to the `/collections` endpoint if health endpoints fail
- Provides detailed logging for troubleshooting

### 3. DNS Configuration

Ensure `local-mcp-server.dev` resolves to localhost by adding this to your `/etc/hosts` file:

```
127.0.0.1   local-mcp-server.dev
```

### 4. Verification Steps

Run the test script to verify your HTTPS configuration:

```bash
cd /Users/jorgenunes/2026/mcp-server-claude
node test-https.js
```

This will:
- Verify certificate files exist and are valid
- Test the HTTPS connection
- Attempt multiple health check endpoints
- Provide detailed troubleshooting information

### 5. Certificate Trust Verification

Verify your mkcert setup:

```bash
# Check if mkcert root CA is installed
mkcert -CAROOT

# If needed, reinstall the root CA
mkcert -install
```

## Troubleshooting Common Issues

### Issue: "unable to verify the first certificate"
**Solution**: 
1. Verify the CA certificate path in your `.env` file
2. Ensure the certificate file exists and is readable
3. Check that `DIRECTUS_HTTPS_REJECT_UNAUTHORIZED=true` is set

### Issue: "ENOTFOUND local-mcp-server.dev"
**Solution**: 
Add `127.0.0.1 local-mcp-server.dev` to `/etc/hosts`

### Issue: "Health check failed on all endpoints"
**Solution**: 
1. Verify Directus is running: `docker-compose ps`
2. Check Nginx is serving HTTPS: `curl -k https://local-mcp-server.dev`
3. Verify certificates are mounted correctly in Docker

### Issue: "Connection refused"
**Solution**: 
1. Ensure Docker containers are running
2. Check port 443 is not blocked by firewall
3. Verify Nginx configuration is correct

## Security Benefits

With this configuration, you now have:
- **Proper SSL/TLS encryption** for all MCP server communications
- **Certificate validation** to prevent man-in-the-middle attacks
- **Local certificate authority** for secure development environment
- **Comprehensive logging** for security auditing

## Testing Your Setup

After implementing these changes:

1. Run the test script: `node test-https.js`
2. Start your MCP server and check for successful HTTPS connections
3. Verify no "unable to verify the first certificate" errors in logs
4. Confirm secure communication with your Directus instance

## Next Steps

1. Consider implementing client certificate authentication for additional security
2. Set up certificate renewal processes for production environments
3. Monitor certificate expiration dates
4. Implement proper certificate rotation procedures

Your HTTPS enforcement is now properly configured for secure local development!
