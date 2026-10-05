import { PageHeader, Card } from '@sika/shared';

export const NotFound = () => (
  <>
    <PageHeader title="Not found" breadcrumbs={[{ label: 'Operator' }]} />
    <Card>
      <p className="text-sm text-graphite-600">No page matches this URL.</p>
    </Card>
  </>
);
