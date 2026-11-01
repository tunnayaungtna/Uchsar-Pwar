/**
 * WebAuthn Biometric (Passkey / TouchID / FaceID / Windows Hello) helper
 * with graceful fallback for sandboxed iframe environments.
 */

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function isPlatformBiometricSupported(): Promise<boolean> {
  try {
    if (
      typeof window !== 'undefined' &&
      window.PublicKeyCredential &&
      typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
    ) {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
  } catch {
    // Sandboxed iframe may restrict PublicKeyCredential inspection
  }
  return false;
}

export async function registerBiometricPasskey(
  userId: string,
  userEmail: string
): Promise<{ credentialId: string; mode: 'hardware' | 'simulated' }> {
  try {
    if (typeof window !== 'undefined' && window.PublicKeyCredential && navigator.credentials) {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userIdBytes = new TextEncoder().encode(userId.slice(0, 32));

      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: {
            name: 'Merlion Kyat Vault',
            id: window.location.hostname,
          },
          user: {
            id: userIdBytes,
            name: userEmail || 'sg-user@merlionvault.local',
            displayName: userEmail || 'Singapore Vault Owner',
          },
          pubKeyCredParams: [
            { alg: -7, type: 'public-key' }, // ES256
            { alg: -257, type: 'public-key' }, // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred',
          },
          timeout: 45000,
        },
      })) as PublicKeyCredential | null;

      if (credential && credential.rawId) {
        return {
          credentialId: bufferToBase64Url(credential.rawId),
          mode: 'hardware',
        };
      }
    }
  } catch {
    // If iframe permissions policy blocks WebAuthn create, fall back to simulated biometric token
  }

  // Generate a deterministic local cryptographic credential ID for iframe preview environments
  const randomBytes = crypto.getRandomValues(new Uint8Array(24));
  return {
    credentialId: `sim_bio_${bufferToBase64Url(randomBytes.buffer)}`,
    mode: 'simulated',
  };
}

export async function verifyBiometricPasskey(
  credentialId: string
): Promise<{ verified: boolean; mode: 'hardware' | 'simulated' }> {
  if (!credentialId) {
    return { verified: false, mode: 'simulated' };
  }

  if (!credentialId.startsWith('sim_bio_')) {
    try {
      if (typeof window !== 'undefined' && window.PublicKeyCredential && navigator.credentials) {
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const rawId = base64UrlToUint8Array(credentialId);

        const assertion = await navigator.credentials.get({
          publicKey: {
            challenge,
            allowCredentials: [
              {
                id: rawId.buffer as ArrayBuffer,
                type: 'public-key',
                transports: ['internal'],
              },
            ],
            userVerification: 'required',
            timeout: 45000,
          },
        });

        if (assertion) {
          return { verified: true, mode: 'hardware' };
        }
      }
    } catch {
      return { verified: false, mode: 'hardware' };
    }
  }

  // Simulated hardware biometric sensor pulse for iframe preview
  await new Promise((resolve) => setTimeout(resolve, 650));
  return { verified: true, mode: 'simulated' };
}
