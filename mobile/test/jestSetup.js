// In-memory AsyncStorage for every render test (vehicle specs are stored there). No device storage is touched.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
