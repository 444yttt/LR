import { View } from 'react-native';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { GarageApp } from './src/GarageApp';
import { DeepLinks } from './src/deepLinks';
import { useGarage } from './src/useGarage';
import { WidgetSync } from './src/widget';
import { page } from './src/ui/theme';

function Live() {
  const data = useGarage();
  // WidgetSync writes the iOS widget's App Group snapshot from the live session only; demo builds never write it.
  return <GarageApp data={data}><DeepLinks /><WidgetSync /></GarageApp>;
}

// Demo/preview builds only (exactly EXPO_PUBLIC_DEMO_DATA=1). Expo inlines the variable at build time, so in
// a production build this condition is a constant `false` and Metro drops the require: the fixtures are not bundled.
// Keep it written out in full (no destructuring, no helper call) or the dead-code removal stops working.
const Demo: React.ComponentType<{ children?: React.ReactNode }> | null = process.env.EXPO_PUBLIC_DEMO_DATA === '1'
  ? require('./src/demo/DemoApp').DemoApp
  : null;

export default function App() {
  const [loaded, error] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: page }} />;
  return Demo ? <Demo><DeepLinks /></Demo> : <Live />;
}
