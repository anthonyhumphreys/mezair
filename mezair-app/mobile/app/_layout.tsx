import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { companionColors } from '@/components/companion-ui';
import { CompanionProvider } from '@/contexts/companion-context';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Development-only synthetic host for screenshots (see lib/sample-host.ts). `__DEV__` is false in
// release bundles, so this branch and the fixture module are stripped from them.
if (__DEV__ && process.env.EXPO_PUBLIC_MEZAIR_SAMPLE_DATA === '1') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/lib/sample-host').installSampleHost();
}

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <CompanionProvider>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Home' }} />
          <Stack.Screen
            name="thread"
            options={{
              title: 'Thread',
              headerLargeTitle: false,
              headerBackButtonDisplayMode: 'minimal',
              contentStyle: { backgroundColor: companionColors.screen },
            }}
          />
          <Stack.Screen name="work-items" options={{ title: 'Work items' }} />
          <Stack.Screen
            name="new-task"
            options={{
              title: 'New task',
              presentation: 'formSheet',
              sheetGrabberVisible: true,
              sheetAllowedDetents: [0.75, 1],
            }}
          />
        </Stack>
        <StatusBar style="auto" />
      </CompanionProvider>
    </ThemeProvider>
  );
}
