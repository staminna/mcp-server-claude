#!/bin/bash

# HTTPS Local Development Setup Script
# This script helps configure your system for HTTPS development with local-mcp-server.dev

echo "🔧 HTTPS Local Development Setup for local-mcp-server.dev"
echo "========================================================="

# Check if running as root for hosts file modification
if [ "$EUID" -ne 0 ]; then
    echo "⚠️  This script needs sudo access to modify /etc/hosts"
    echo "Please run: sudo ./setup-local-https.sh"
    exit 1
fi

# Check if local-mcp-server.dev is already in hosts file
echo "📋 Checking /etc/hosts configuration..."
if grep -q "local-mcp-server.dev" /etc/hosts; then
    echo "✅ local-mcp-server.dev already configured in /etc/hosts"
else
    echo "🔧 Adding local-mcp-server.dev to /etc/hosts..."
    echo "127.0.0.1   local-mcp-server.dev" >> /etc/hosts
    echo "✅ Added local-mcp-server.dev to /etc/hosts"
fi

# Test DNS resolution
echo "🌐 Testing DNS resolution..."
if ping -c 1 local-mcp-server.dev >/dev/null 2>&1; then
    echo "✅ local-mcp-server.dev resolves correctly to localhost"
else
    echo "❌ DNS resolution failed for local-mcp-server.dev"
fi

# Check mkcert installation
echo "🔐 Checking mkcert installation..."
if command -v mkcert >/dev/null 2>&1; then
    echo "✅ mkcert is installed"
    
    # Check if root CA is installed
    echo "📋 Checking mkcert root CA..."
    mkcert -CAROOT
    
    # Reinstall root CA to be safe
    echo "🔧 Reinstalling mkcert root CA..."
    mkcert -install
    echo "✅ mkcert root CA installed"
else
    echo "❌ mkcert not found. Please install it first:"
    echo "   brew install mkcert (on macOS)"
    echo "   or visit: https://github.com/FiloSottile/mkcert"
fi

# Test HTTPS connection
echo "🌐 Testing HTTPS connection..."
if curl -s --connect-timeout 5 https://local-mcp-server.dev >/dev/null 2>&1; then
    echo "✅ HTTPS connection to local-mcp-server.dev successful"
else
    echo "⚠️  HTTPS connection failed (server may not be running)"
    echo "   Start your Docker services with: docker-compose up -d"
fi

echo "🏁 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Ensure your Docker containers are running: docker-compose up -d"
echo "2. Test the MCP server connection: node test-https.js"
echo "3. Start your MCP server and verify HTTPS enforcement"
