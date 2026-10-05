import { PageHeader, Card } from '@sika/shared';

export const Settings = () => (
  <>
    <PageHeader title="Settings" subtitle="API keys, certificate management, webhook URLs." />
    <Card>
      <p className="text-sm text-graphite-600">
        Self-service rotation for API keys and rail certificates is configured
        with the rail's operator team. Reach out via the regulator console for
        emergency rotations.
      </p>
    </Card>
  </>
);

export default Settings;
