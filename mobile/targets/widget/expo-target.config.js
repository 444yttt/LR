/**
 * Nostos home-screen and lock-screen widget (WidgetKit), built by @bacons/apple-targets during `expo prebuild`.
 * The widget reads only the App Group snapshot written by src/widget.tsx (contract: src/widgetSnapshot.ts).
 * No team id here: CI supplies DEVELOPMENT_TEAM only at signed-archive time.
 * @type {import('@bacons/apple-targets/build/config').ConfigFunction}
 */
module.exports = config => ({
  type: 'widget',
  name: 'NostosWidget',
  displayName: 'Nostos',
  bundleIdentifier: '.widget',
  // AppIntentConfiguration (configurable vehicle) and containerBackground need iOS 17.
  deploymentTarget: '17.0',
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
});
