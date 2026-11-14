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

## Screens

- **Garage**: pull to refresh when signed in. The Range Rover status line shows `Updated N min ago` when the report is fresh. The **＋** button opens an Add vehicle sheet. It lists the data sources and says that adding vehicles is unavailable in this build.
- **Vehicle detail**: the status line and footer open **Connection**. The status panel opens **Vehicle status**. The action row opens **Recent drives** (Range Rover) or **Connection** (Ferrari 296, BMW M4; both stay not connected / setup required, with no sample values).
- **Recent drives / Drive**: these list only verified trip end times, grouped by JST day. The gateway sends only end times. Duration, distance, and efficiency appear if the gateway later sends trip objects (`{ endedAt, startedAt, distanceKm, efficiencyLPer100Km }`). Until then they show as not reported.
- **Connection**: shows the state (not configured, signed out, sign-in failed, not updated yet, updating, update failed, sign-in expired, JLR authorization expired, collector error, waiting, stale, connected), the last successful update, and the last check on this iPhone. It also has the retry / sign-in / refresh action and sign-out. Sign-out clears the session on the device only.
- **Notifications**: shows the iOS permission state and has toggles for inactivity alerts (master, 7 days, 14 days). When permission is denied it links to iOS Settings.

State presentation lives in `src/garageModel.ts` and is covered by `test/garageModel.test.ts`.

## Deep links

`garage-monitor://` opens the Garage. `garage-monitor://vehicle/<range-rover|ferrari-296|bmw-m4>[/status|/connection]`, `garage-monitor://drives` and `garage-monitor://notifications` open those screens. `garage-monitor://auth` stays the OAuth redirect and is never routed to a screen.

## Motion

Motion uses react-native-reanimated 4 (UI-thread worklets), react-native-gesture-handler, and expo-haptics. Opening a vehicle is a shared-element transition: the car, the floor ellipse, and the contact shadow fly from the card to the detail stage as three separate layers. The car settles on landing. Swiping from the left edge scrubs the transition back. With Reduce Motion on, screens change without animation and metrics appear without counting.

## Notifications

Enable inactivity alerts in Range Rover → Connection → Notifications. On a successful refresh while the app runs, a fresh verified trip may trigger one local notification per trip and threshold (7 or 14 days, each with its own toggle). At 14 days the app emits the current threshold only. If the 14-day alert is off, it falls back to the 7-day alert for that trip, sent once. Tapping a notification opens the Range Rover (`garage-monitor://vehicle/range-rover`). This implementation requires the app to run and does not deliver server-side push notifications. Test iOS notification permissions, a due verified snapshot, and duplicate suppression on an iPhone before relying on delivery.
