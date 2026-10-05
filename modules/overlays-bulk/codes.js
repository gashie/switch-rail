export const RUN_STATES = Object.freeze({
  QUEUED:    'QUEUED',
  RUNNING:   'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED:    'FAILED',
  PARTIAL:   'PARTIAL'
});

export const LINE_STATES = Object.freeze({
  PENDING:   'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED:    'FAILED'
});

export const SOURCE_FORMATS = Object.freeze(['CSV', 'XLSX', 'PAIN001']);

export const OVERLAY_TYPE = 'BULK_BATCH';
