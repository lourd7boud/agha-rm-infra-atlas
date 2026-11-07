# ATLAS Signing Bridge

Outbound-only Windows component for one ATLAS signing task. It verifies the frozen
manifest/file hashes before calling a local token driver and uploads signed artifacts
without ever sending the private key or PIN to ATLAS.

Current state:

- pairing, lease, download integrity and artifact staging are implemented;
- Windows certificate-store diagnostics are implemented (`pnpm diagnose`);
- signer authentication uses the OAuth 2.0 Device Authorization Grant through the
  dedicated public `atlas-signing-bridge` client; the bridge never asks for or stores
  the user's password;
- the diagnostic driver deliberately refuses to sign;
- the BARID ESIGN/EURAFRIC token adapter must be validated against the actual USB token
  and the portal's official signing/validation component before enabling completion.

Production requires HTTPS. Plain HTTP is accepted only on `localhost`/`127.0.0.1`.
