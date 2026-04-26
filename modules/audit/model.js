const EVENT_COLS =
  'id, ts, day, seq, actor_type, actor_id, event_type, resource_type, resource_id, payload, prev_hash, hash';

export const createAuditModel = () => ({
  getLastHashForDay: async (client, day) => {
    const r = await client.query(
      `SELECT hash FROM audit_events WHERE day = $1 ORDER BY seq DESC LIMIT 1`,
      [day]
    );
    return r.rows[0]?.hash || null;
  },

  insertEvent: async (
    client,
    { id, day, actorType, actorId, eventType, resourceType, resourceId, payload, prevHash, hash }
  ) => {
    const r = await client.query(
      `INSERT INTO audit_events
        (id, day, actor_type, actor_id, event_type, resource_type, resource_id, payload, prev_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
       RETURNING ${EVENT_COLS}`,
      [
        id,
        day,
        actorType,
        actorId ?? null,
        eventType,
        resourceType ?? null,
        resourceId ?? null,
        JSON.stringify(payload ?? {}),
        prevHash,
        hash
      ]
    );
    return r.rows[0];
  },

  listEventsForDay: async (client, day) => {
    const r = await client.query(
      `SELECT ${EVENT_COLS} FROM audit_events WHERE day = $1 ORDER BY seq ASC`,
      [day]
    );
    return r.rows;
  },

  list: async (client, { from, to, actor, eventType, resourceType, resourceId, limit, offset }) => {
    const conds = [];
    const params = [];
    const push = (p) => {
      params.push(p);
      return `$${params.length}`;
    };
    if (from) conds.push(`day >= ${push(from)}`);
    if (to) conds.push(`day <= ${push(to)}`);
    if (actor) conds.push(`actor_id = ${push(actor)}`);
    if (eventType) conds.push(`event_type = ${push(eventType)}`);
    if (resourceType) conds.push(`resource_type = ${push(resourceType)}`);
    if (resourceId) conds.push(`resource_id = ${push(resourceId)}`);

    const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rowsSql = `SELECT ${EVENT_COLS} FROM audit_events ${whereSql} ORDER BY seq ASC LIMIT ${push(limit)} OFFSET ${push(offset)}`;
    const totalSql = `SELECT count(*)::bigint AS total FROM audit_events ${whereSql}`;

    const rowsR = await client.query(rowsSql, params);
    const totalR = await client.query(totalSql, params.slice(0, params.length - 2));
    return { rows: rowsR.rows, total: Number(totalR.rows[0].total) };
  }
});
