import { AppShell, NavLink, Stack, Text, Select, Divider, Box, Group } from '@mantine/core';
import { useNavigate, useLocation } from 'react-router-dom';
import { useFy } from '../lib/fyContext.js';

interface NavItem {
  label: string;
  to: string;
  exact?: boolean;
}

function NavSection({ label, items }: { label: string; items: NavItem[] }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isActive = items.some((i) =>
    i.exact ? pathname === i.to : pathname.startsWith(i.to),
  );

  return (
    <NavLink
      label={label}
      defaultOpened={isActive}
      styles={{
        label: { fontWeight: 600, fontSize: '0.85rem' },
        root: { borderRadius: 8, marginBottom: 2 },
      }}
    >
      {items.map((item) => {
        const active = item.exact ? pathname === item.to : pathname === item.to;
        return (
          <NavLink
            key={item.to}
            label={item.label}
            active={active}
            onClick={() => navigate(item.to)}
            styles={{ root: { borderRadius: 6, paddingLeft: 24 } }}
          />
        );
      })}
    </NavLink>
  );
}

function NavItem({ label, to, exact }: NavItem) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = exact ? pathname === to : pathname.startsWith(to);
  return (
    <NavLink
      label={label}
      active={active}
      onClick={() => navigate(to)}
      styles={{ root: { borderRadius: 8, marginBottom: 2 } }}
    />
  );
}

export function Nav() {
  const { years, selected, selectByLabel, loading } = useFy();

  return (
    <AppShell.Navbar p="sm">
      <Stack gap={0} h="100%">
        {/* Brand */}
        <Box px={4} pb="md" pt={4}>
          <Text fw={700} size="lg" c="indigo.7">AU Tax Tracker</Text>
        </Box>

        {/* FY selector */}
        <Box px={4} pb="md">
          <Text size="xs" c="dimmed" fw={600} tt="uppercase" mb={6} style={{ letterSpacing: '0.05em' }}>
            Financial Year
          </Text>
          <Select
            size="sm"
            data={years.map((y) => ({ value: y.label, label: y.label }))}
            value={selected?.label ?? null}
            onChange={(v) => v && selectByLabel(v)}
            disabled={loading || years.length === 0}
            styles={{ input: { fontWeight: 600 } }}
          />
        </Box>

        <Divider mb="sm" />

        {/* Nav links */}
        <Stack gap={2} style={{ flex: 1, overflowY: 'auto' }}>
          <NavItem label="Dashboard" to="/" exact />
          <NavItem label="Salary" to="/salary" />
          <NavItem label="Tax Estimate" to="/tax-estimate" />

          <Divider my={6} />

          <NavSection
            label="Investments"
            items={[
              { label: 'Holdings', to: '/investments/holdings' },
              { label: 'Trades', to: '/investments/trades' },
              { label: 'Dividends', to: '/investments/dividends' },
              { label: 'Import', to: '/investments/import' },
              { label: 'CGT', to: '/investments/cgt' },
            ]}
          />

          <NavSection
            label="Crypto"
            items={[
              { label: 'Import', to: '/investments/crypto-import' },
              { label: 'Trades', to: '/investments/crypto-trades' },
              { label: 'CGT', to: '/investments/crypto-cgt' },
            ]}
          />

          <NavSection
            label="Property"
            items={[
              { label: 'Properties', to: '/property' },
            ]}
          />

          <Divider my={6} />

          <NavItem label="Deductions" to="/deductions" />
          <NavItem label="Export" to="/export" />
        </Stack>
      </Stack>
    </AppShell.Navbar>
  );
}
