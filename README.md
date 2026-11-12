# LR Vehicle Monitor

Read-only Range Rover L460 (2025) vehicle monitoring proof of concept.

## Current status
- Vehicle is visible/verified on JLR Data Hub.
- Data categories selection has been reached.
- **No credential registered; no API call or live vehicle monitoring has been verified yet.**
- JLR access may be subject to region/consent restrictions; do not misrepresent residency or vehicle ownership.
- Existing ChatGPT weekly reminder is separate from this project.

## iPhone-only setup (GitHub Codespaces)

1. On GitHub, open this private repository, select **Code → Codespaces → Create codespace on main**.
2. In the Codespaces terminal run:
   ```bash
   npm install
   npm run keygen
   npm run verify
   cat ~/.jlr-secrets/certificate.pem
   ```
3. Copy **only** the PEM certificate (BEGIN CERTIFICATE to END CERTIFICATE) into JLR's **PUBLIC KEY** field.
4. Never paste `private.pem` into chat, a GitHub issue, source control or the JLR form.
5. **Before deleting Codespaces**, arrange secure private-key migration to the eventual Cloudflare Worker secret store. A lost private key makes the registered certificate unusable. Codespaces storage is not permanent key management.

## Design

- JLR REST owner flow: OAuth Authorization Code + PKCE (or Device Code) with signed client assertion, plus per-request DPoP.
- Do not assume client credentials alone permits owner REST calls. It is used for owner MQTT streaming; REST owner flows require user authorization.
- `/v1/vehicles/{vin}/journeys` availability and Japanese vehicle support still require testing.
- Store journey end timestamps (not merely API update times).
- Treat missing API data as **unknown**, not as evidence the vehicle has not driven.
- Warn at 7 days without confirmed driving; repeat at 14 days. Keep an explicit 'last fetched at' and an API-error status.
- Ferrari 296 and BMW are future adapters; do not assume their APIs work.

## Safety and privacy
- Do not commit certificates containing unnecessary personal info, private keys, tokens, VINs, locations or journey data.
- Keep the API read-only. Obtain appropriate driver consent before processing trips.
- Avoid waking vehicle electronics just to check telemetry.
- For OBD/LTE hardware, validate standby draw and vehicle sleep-state interference before leaving a device connected.

## Official docs
- [JLR quickstart](https://developer.jlr.com/docs/guides/quickstart)
- [Vehicle-owner authentication](https://developer.jlr.com/docs/guides/personas/vehicle-owners)
- [Authorization Code / PKCE](https://developer.jlr.com/docs/authentication/authorization-code)
- [REST API](https://developer.jlr.com/docs/guides/rest-api)
