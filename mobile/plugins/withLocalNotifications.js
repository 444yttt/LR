const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

/**
 * Nostos schedules local notifications only.
 *
 * expo-notifications (SDK 54) always writes the aps-environment entitlement.
 * That makes App Store provisioning require Push Notifications. Remove it.
 *
 * List this plugin before expo-notifications. User plugins are registered
 * first and their mods run last, so this delete wins over the entitlement
 * the notifications plugin adds.
 *
 * CFBundleVersion follows CURRENT_PROJECT_VERSION. app.json ios.buildNumber
 * stays the default; CI passes CURRENT_PROJECT_VERSION on xcodebuild.
 */
function withLocalNotifications(config) {
  config = withEntitlementsPlist(config, (config) => {
    delete config.modResults['aps-environment'];
    return config;
  });
  config = withInfoPlist(config, (config) => {
    config.modResults.CFBundleVersion = '$(CURRENT_PROJECT_VERSION)';
    return config;
  });
  return config;
}

module.exports = withLocalNotifications;
