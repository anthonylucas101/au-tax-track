import { AppShell, Group, Text, ActionIcon, Tooltip, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { IconSun, IconMoon } from '@tabler/icons-react';

export function AppHeader() {
  const { setColorScheme } = useMantineColorScheme();
  const colorScheme = useComputedColorScheme('light');
  const isDark = colorScheme === 'dark';

  return (
    <AppShell.Header>
      <Group h="100%" px="md" justify="space-between">
        <Text fw={700} size="md" c="indigo.6" visibleFrom="sm">
          AU Tax Tracker
        </Text>
        <Text fw={700} size="md" c="indigo.6" hiddenFrom="sm">
          AU Tax
        </Text>

        <Tooltip label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} position="bottom-end">
          <ActionIcon
            variant="subtle"
            size="lg"
            radius="md"
            color={isDark ? 'yellow' : 'indigo'}
            onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
            aria-label="Toggle colour scheme"
          >
            {isDark
              ? <IconSun size={20} stroke={1.8} />
              : <IconMoon size={20} stroke={1.8} />
            }
          </ActionIcon>
        </Tooltip>
      </Group>
    </AppShell.Header>
  );
}
