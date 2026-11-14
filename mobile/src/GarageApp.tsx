import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DriveScreen, DrivesScreen } from './screens/DrivesScreen';
import { GarageScreen } from './screens/GarageScreen';
import { AddVehicleSheet, ConnectionScreen, NotificationsScreen, StatusScreen } from './screens/SettingsScreens';
import { VehicleScreen } from './screens/VehicleScreen';
import { DataProvider, type Data } from './ui/parts';
import { Sheet, Stack, type Entry } from './ui/stack';
import { NowProvider, page } from './ui/theme';

function screen(entry: Entry): ReactNode {
  const route = entry.route;
  switch (route.name) {
    case 'garage': return null;
    case 'vehicle': return <VehicleScreen entry={entry} vehicle={route.vehicle} />;
    case 'drives': return <DrivesScreen />;
    case 'drive': return <DriveScreen endedAt={route.endedAt} />;
    case 'status': return <StatusScreen vehicle={route.vehicle} />;
    case 'connection': return <ConnectionScreen vehicle={route.vehicle} />;
    case 'notifications': return <NotificationsScreen />;
  }
}

/** The whole UI for a given data source. `children` render inside the navigation stack (e.g. deep links). */
export function GarageApp({ data, children }: { data: Data; children?: ReactNode }) {
  const [adding, setAdding] = useState(false);
  return <GestureHandlerRootView style={{ flex: 1, backgroundColor: page }}>
    <SafeAreaProvider>
      <NowProvider>
        <DataProvider value={data}>
          <View style={{ flex: 1, backgroundColor: page }}>
            <Stack base={<GarageScreen onAdd={() => setAdding(true)} />} render={screen}>{children}</Stack>
            <Sheet visible={adding} onClose={() => setAdding(false)}>
              <AddVehicleSheet onClose={() => setAdding(false)} />
            </Sheet>
          </View>
        </DataProvider>
      </NowProvider>
    </SafeAreaProvider>
  </GestureHandlerRootView>;
}
