# HTTPS Certificate Support

The Directus MCP Server now supports custom HTTPS certificates for secure connections to Directus instances with self-signed certificates or custom Certificate Authorities.

## Configuration Options

You can configure HTTPS certificates using environment variables in your `.env` file:

### Certificate Authority (CA)
```bash
# Path to CA certificate file
DIRECTUS_HTTPS_CA=/Users/jorgenunes/2026/DirectusRoom/certs/local-mcp-server.dev.pem

# Or provide the certificate content directly
DIRECTUS_HTTPS_CA="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
```

### Client Certificate Authentication
```bash
# Client certificate and private key
DIRECTUS_HTTPS_CERT=/Users/jorgenunes/2026/DirectusRoom/certs/client-certificate.pem
DIRECTUS_HTTPS_KEY=/Users/jorgenunes/2026/DirectusRoom/certs/private-key.pem

# Optional passphrase for encrypted private key
# DIRECTUS_HTTPS_PASSPHRASE=your_passphrase_here
```

### PFX/PKCS12 Certificates
```bash
# PFX file containing certificate and private key
DIRECTUS_HTTPS_PFX=/path/to/certificate.pfx
DIRECTUS_HTTPS_PASSPHRASE=your_passphrase_here
```

### Additional Options
```bash
# Disable certificate validation (not recommended for production)
DIRECTUS_HTTPS_REJECT_UNAUTHORIZED=false

# Server name for SNI (Server Name Indication)
DIRECTUS_HTTPS_SERVERNAME=your-server-name.com
```

## Usage Examples

### Example 1: Self-Signed Certificate
```bash
# .env
DIRECTUS_URL=https://local-mcp-server.dev/admin/login
DIRECTUS_TOKEN=your_admin_token_here
DIRECTUS_HTTPS_CA=/path/to/self-signed-ca.pem
```

### Example 2: Client Certificate Authentication
```bash
# .env
DIRECTUS_URL=https://local-mcp-server.dev/admin/login
DIRECTUS_TOKEN=your_admin_token_here
DIRECTUS_HTTPS_CERT=/path/to/client.crt
DIRECTUS_HTTPS_KEY=/path/to/client.key
DIRECTUS_HTTPS_CA=/path/to/company-ca.pem
```

### Example 3: PFX Certificate
```bash
# .env
DIRECTUS_URL=https://directus.internal.com
DIRECTUS_TOKEN=your_admin_token_here
DIRECTUS_HTTPS_PFX=/path/to/certificate.pfx
DIRECTUS_HTTPS_PASSPHRASE=certificate_password
```

## Programmatic Usage

You can also configure certificates programmatically when creating a DirectusClient:

```typescript
import { DirectusClient } from './client/directus-client.js';
import fs from 'fs';

const client = new DirectusClient({
  url: 'https://your-directus-instance.com',
  token: 'your_admin_token_here',
  https: {
    ca: fs.readFileSync('/path/to/ca-certificate.pem'),
    cert: fs.readFileSync('/path/to/client-certificate.pem'),
    key: fs.readFileSync('/path/to/private-key.pem'),
    rejectUnauthorized: true,
    servername: 'your-server-name.com'
  }
});
```

## Certificate File Formats

The server supports various certificate formats:

- **PEM**: Text-based format with `-----BEGIN CERTIFICATE-----` headers
- **DER**: Binary format
- **PFX/PKCS12**: Binary format containing certificate and private key
- **Certificate chains**: Multiple certificates in a single file or array

## Security Notes

1. **File Permissions**: Ensure certificate files have appropriate permissions (600 for private keys)
2. **Environment Variables**: Be careful with sensitive data in environment variables
3. **Certificate Validation**: Only disable `rejectUnauthorized` in development environments
4. **Certificate Expiry**: Monitor certificate expiration dates

## Troubleshooting

### Common Issues

1. **Certificate Path Issues**: Ensure file paths are absolute and accessible
2. **Permission Errors**: Check file permissions for certificate files
3. **Format Issues**: Verify certificate format matches the expected type
4. **Network Issues**: Ensure the Directus server is accessible and certificates are valid

### Logging

The server logs certificate loading operations:
- `Loaded CA certificate from file`
- `Using provided CA certificate content`
- `Created HTTPS agent with custom certificate configuration`

Check the server logs for certificate-related information and errors.
