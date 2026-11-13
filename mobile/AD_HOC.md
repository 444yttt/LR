# Garage Monitor Ad Hoc build

Use the private LR repository's GitHub Actions settings to configure three secrets:

- `IOS_P12_BASE64`: Base64 of the password-protected distribution identity export, including its private key.
- `IOS_P12_PASSWORD`: password for that export.
- `IOS_AD_HOC_PROFILE_BASE64`: Base64 of the Apple Ad Hoc provisioning profile.

The profile must cover `studio.naus.garagemonitor`, select the same distribution certificate, and include the target iPhone. Keep the signing key and provisioning profile out of Git, logs and the public simulator repository.

After setting the secrets, rerun the iOS Ad Hoc IPA workflow on `garage-monitor/ios-ad-hoc` (or run it manually once the workflow exists on the default branch). Download the IPA from the successful run's GarageMonitor-iOS-AdHoc artifact. The IPA includes device registration information and is retained for three days.
