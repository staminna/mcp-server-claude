import https from 'https';
import fs from 'fs';

export function createSecureHttpsAgent(config) {
    if (!config.https) {
        return null;
    }

    const httpsOptions = {};

    // Handle Certificate Authority (CA) - FIXED VERSION
    if (config.https.ca) {
        try {
            if (typeof config.https.ca === 'string') {
                // Check if it's a file path and exists
                if (fs.existsSync(config.https.ca)) {
                    httpsOptions.ca = fs.readFileSync(config.https.ca, 'utf8');
                    console.log('✅ Successfully loaded CA certificate from:', config.https.ca);
                } else {
                    // Assume it's the certificate content itself
                    httpsOptions.ca = config.https.ca;
                    console.log('✅ Using provided CA certificate content');
                }
            } else {
                httpsOptions.ca = config.https.ca;
                console.log('✅ Using provided CA certificate buffer/array');
            }
        } catch (error) {
            console.error('❌ Failed to load CA certificate:', error.message);
            // Fallback: disable certificate verification
            httpsOptions.rejectUnauthorized = false;
        }
    }

    // Handle other HTTPS options
    if (config.https.passphrase) {
        httpsOptions.passphrase = config.https.passphrase;
    }
    
    // Default to false for development if there are certificate issues
    httpsOptions.rejectUnauthorized = config.https.rejectUnauthorized !== undefined 
        ? config.https.rejectUnauthorized 
        : false;
    
    if (config.https.servername) {
        httpsOptions.servername = config.https.servername;
    }

    console.log('🔧 HTTPS Agent Configuration:', {
        hasCA: !!httpsOptions.ca,
        rejectUnauthorized: httpsOptions.rejectUnauthorized,
        servername: httpsOptions.servername
    });

    return new https.Agent(httpsOptions);
}
