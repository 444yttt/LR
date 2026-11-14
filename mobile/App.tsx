import { View } from 'react-native';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { GarageApp } from './src/GarageApp';
import { DeepLinks } from './src/deepLinks';
import { useGarage } from './src/useGarage';
import { page } from './src/ui/theme';

function Live() {
  const data = useGarage();
  return <GarageApp data={data}><DeepLinks /></GarageApp>;
}

export default function App() {
  const [loaded, error] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: page }} />;
  return <Live />;
}
