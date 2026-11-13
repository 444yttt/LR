#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${IOS_P12_BASE64:?Missing IOS_P12_BASE64}"
: "${IOS_P12_PASSWORD:?Missing IOS_P12_PASSWORD}"
: "${IOS_AD_HOC_PROFILE_BASE64:?Missing IOS_AD_HOC_PROFILE_BASE64}"
: "${RUNNER_TEMP:?Missing RUNNER_TEMP}"
scratch=$(mktemp -d "$RUNNER_TEMP/garage-sign.XXXXXX")
keychain="$scratch/garage.keychain-db"
profile_path=
original_keychains=()
while IFS= read -r entry; do
  entry=$(printf '%s' "$entry" | sed -E 's/^[[:space:]]*"//; s/"$//')
  original_keychains+=("$entry")
done < <(security list-keychains -d user)
cleanup() {
  if (("${#original_keychains[@]}")); then
    security list-keychains -d user -s "${original_keychains[@]}" >/dev/null 2>&1 || true
  fi
  security delete-keychain "$keychain" >/dev/null 2>&1 || true
  if [[ -n "$profile_path" ]]; then rm -f "$profile_path"; fi
  rm -rf "$scratch"
}
trap cleanup EXIT

printf '%s' "$IOS_P12_BASE64" | base64 -D > "$scratch/signing.p12"
printf '%s' "$IOS_AD_HOC_PROFILE_BASE64" | base64 -D > "$scratch/app.mobileprovision"
keychain_password=$(openssl rand -hex 24)
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 7200 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$scratch/signing.p12" -P "$IOS_P12_PASSWORD" -T /usr/bin/codesign -t cert -f pkcs12 -k "$keychain" >/dev/null
security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain" >/dev/null
if (("${#original_keychains[@]}")); then
  security list-keychains -d user -s "$keychain" "${original_keychains[@]}"
else
  security list-keychains -d user -s "$keychain"
fi
unset IOS_P12_BASE64 IOS_P12_PASSWORD IOS_AD_HOC_PROFILE_BASE64 keychain_password
rm -f "$scratch/signing.p12"
security cms -D -i "$scratch/app.mobileprovision" > "$scratch/profile.plist"
security find-identity -v -p codesigning "$keychain" > "$scratch/identities"
bundle_id=$(node -p 'require("./app.json").expo.ios.bundleIdentifier')
python3 - "$scratch" "$bundle_id" <<'PY'
import datetime
import hashlib
import pathlib
import plistlib
import sys

root = pathlib.Path(sys.argv[1])
bundle = sys.argv[2]
profile = plistlib.loads((root / "profile.plist").read_bytes())
entitlements = profile["Entitlements"]
team = profile["TeamIdentifier"][0]
if entitlements["application-identifier"] != f"{team}.{bundle}":
    raise SystemExit("The profile bundle ID does not match app.json.")
if not profile.get("ProvisionedDevices") or entitlements.get("get-task-allow"):
    raise SystemExit("An Ad Hoc distribution profile with registered devices is required.")
if profile["ExpirationDate"] <= datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None):
    raise SystemExit("The provisioning profile has expired.")
identities = (root / "identities").read_text()
certificate = next((hashlib.sha1(cert).hexdigest().upper() for cert in profile["DeveloperCertificates"]
                    if hashlib.sha1(cert).hexdigest().upper() in identities), None)
if certificate is None:
    raise SystemExit("The imported signing key does not match the provisioning profile.")
uuid = profile["UUID"]
(root / "metadata").write_text("\n".join([team, uuid, certificate]) + "\n")
(root / "ExportOptions.plist").write_bytes(plistlib.dumps({
    "method": "release-testing", "destination": "export", "signingStyle": "manual",
    "teamID": team, "signingCertificate": certificate, "provisioningProfiles": {bundle: uuid},
}))
PY
team=$(sed -n '1p' "$scratch/metadata")
uuid=$(sed -n '2p' "$scratch/metadata")
identity=$(sed -n '3p' "$scratch/metadata")
profiles="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
mkdir -p "$profiles"
profile_path="$profiles/$uuid.mobileprovision"
cp "$scratch/app.mobileprovision" "$profile_path"

workspace=$(find ios -maxdepth 1 -name '*.xcworkspace' -print -quit)
test -n "$workspace"
scheme=$(basename "$workspace" .xcworkspace)
ruby -rxcodeproj - "$scheme" "$team" "$uuid" "$identity" <<'RUBY'
scheme, team, uuid, identity = ARGV
project = Xcodeproj::Project.open("ios/#{scheme}.xcodeproj")
target = project.targets.find { |item| item.product_type == 'com.apple.product-type.application' }
abort 'Could not find the iOS application target' unless target
config = target.build_configurations.find { |item| item.name == 'Release' }
abort 'Could not find the Release configuration' unless config
config.build_settings.merge!(
  'CODE_SIGN_STYLE' => 'Manual',
  'DEVELOPMENT_TEAM' => team,
  'CODE_SIGN_IDENTITY' => identity,
  'PROVISIONING_PROFILE_SPECIFIER' => uuid
)
project.save
RUBY
xcodebuild -workspace "$workspace" -scheme "$scheme" -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$scratch/GarageMonitor.xcarchive" archive -quiet
xcodebuild -exportArchive -archivePath "$scratch/GarageMonitor.xcarchive" \
  -exportOptionsPlist "$scratch/ExportOptions.plist" -exportPath "$RUNNER_TEMP/garage-export"
