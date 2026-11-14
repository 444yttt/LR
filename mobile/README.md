# Garage Monitor for iOS

Expo + TypeScript in `mobile/`. The Garage and three detail screens follow [Final / Light Floor](https://www.figma.com/design/wfL98bFPY6pTSLFFjQInqU?node-id=59-56). The illustrations are generated side-profile vehicle assets. The floor, contact shadow, and vehicle images are drawn independently.

## Run locally

```sh
npm ci
npm run check
npm test
npm run ios
```

A Mac with Xcode or an iOS development build is required for native execution. With no endpoint configured the app opens the empty-data design.

## Owner sign-in

Configure an OAuth public native client using authorization code + PKCE with the redirect URI `garage-monitor://auth`. Its access token must be a short-lived JWT intended for a dedicated Garage API audience. The following are public Expo build settings:

- `EXPO_PUBLIC_GARAGE_API_URL` — HTTPS mobile gateway origin
- `EXPO_PUBLIC_GARAGE_ISSUER` — HTTPS OIDC issuer
- `EXPO_PUBLIC_GARAGE_CLIENT_ID` — public native client ID
- `EXPO_PUBLIC_GARAGE_RESOURCE` — optional RFC 8707 resource indicator, if used by the issuer

The app stores the Garage access token, its expiry, and the refresh token when the issuer sends one in the device secure store. The next launch reuses a live access token and renews it when it has expired. A failed renewal, or an HTTP 401, clears that session and shows Sign-in expired. The app never needs a JLR private key, a JLR refresh token, or the existing Worker's bootstrap bearer. A failed vehicle-data update can be retried; previous values are marked with the last successful update. Missing values remain blank. Trips and inactivity require the existing source-verification flag.

## Cloudflare rollout

The existing collector remains the JLR integration. On the production D1 database, mark `cloudflare/migrations/0000_baseline.sql` applied without executing it, then apply `0001_mobile_trip_ends.sql`. The steps are in `cloudflare/README.md`. The collector stores up to 50 distinct recent trip end timestamps with no routes or coordinates. Snapshot and trip data are written in one D1 batch. The collector deployment and owner verification are separate steps.

The gateway in `cloudflare/mobile-gateway` reads the existing D1 database. Configure `GARAGE_ISSUER`, `GARAGE_JWKS_URL`, `GARAGE_AUDIENCE` (dedicated API audience), and `GARAGE_OWNER_SUB` as deployment settings, then route the gateway to a dedicated HTTPS hostname. The gateway requires a correctly signed, unexpired token from the configured issuer and owner. It sends no VIN, location, credentials, or raw JLR responses. Before changing the production collector, compare the current deployment and bindings against the repository and preserve the existing encrypted credential vault.

## Notifications

Enable inactivity alerts in Range Rover → Data connection. On a successful refresh while the app runs, a fresh verified trip may trigger one local notification per trip and threshold (7 or 14 days). At 14 days the app emits the current threshold only. This implementation requires the app to run and does not deliver server-side push notifications. Test iOS notification permissions, a due verified snapshot, and duplicate suppression on an iPhone before relying on delivery.
