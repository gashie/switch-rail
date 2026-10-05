import { uuidv7 } from './uuid.js';

const ORDER_BY_RE = /^(\w+)(\s+(ASC|DESC))?$/i;

const filterTo = (data, whitelist) => {
  const out = {};
  for (const k of whitelist) {
    if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
  }
  return out;
};

const buildWhere = (where, allowedCols, startIdx = 1) => {
  const keys = Object.keys(where).filter((k) => allowedCols.includes(k));
  const params = [];
  const parts = keys.map((k, i) => {
    params.push(where[k]);
    return `${k} = $${startIdx + i}`;
  });
  return { sql: parts.join(' AND '), params, nextIdx: startIdx + keys.length };
};

const validateOrderBy = (orderBy, allowedCols) => {
  const parts = orderBy.split(',').map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(ORDER_BY_RE);
    if (!m) throw new Error(`invalid orderBy clause: ${part}`);
    if (!allowedCols.includes(m[1])) {
      throw new Error(`unknown column in orderBy: ${m[1]}`);
    }
  }
  return parts.join(', ');
};

export const createBaseCrud = ({
  table,
  pk = 'id',
  columns,
  insertable,
  updatable,
  softDelete = false,
  defaultOrderBy
}) => {
  if (!table) throw new Error('createBaseCrud: table required');
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('createBaseCrud: columns required');
  }
  if (!Array.isArray(insertable)) throw new Error('createBaseCrud: insertable required');
  if (!Array.isArray(updatable)) throw new Error('createBaseCrud: updatable required');

  const colList = columns.join(', ');
  const sdFilter = softDelete ? 'deleted_at IS NULL' : null;

  const withSdAnd = (whereSql) => {
    if (!sdFilter) return whereSql;
    if (!whereSql) return sdFilter;
    return `${whereSql} AND ${sdFilter}`;
  };

  const create = async (client, input) => {
    const data = filterTo(input, insertable);
    const id = input[pk] !== undefined ? input[pk] : uuidv7();
    const cols = [pk, ...Object.keys(data)];
    const values = [id, ...Object.values(data)];
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING ${colList}`;
    const r = await client.query(sql, values);
    return r.rows[0];
  };

  const getById = async (client, id) => {
    const whereSql = withSdAnd(`${pk} = $1`);
    const sql = `SELECT ${colList} FROM ${table} WHERE ${whereSql} LIMIT 1`;
    const r = await client.query(sql, [id]);
    return r.rows[0] || null;
  };

  const findOne = async (client, { where = {} } = {}) => {
    const w = buildWhere(where, columns);
    const whereSql = withSdAnd(w.sql);
    const sql = `SELECT ${colList} FROM ${table}${whereSql ? ` WHERE ${whereSql}` : ''} LIMIT 1`;
    const r = await client.query(sql, w.params);
    return r.rows[0] || null;
  };

  const findMany = async (client, { where = {}, limit = 50, offset = 0, orderBy } = {}) => {
    const w = buildWhere(where, columns);
    const whereSql = withSdAnd(w.sql);
    const orderClause = (() => {
      const o = orderBy || defaultOrderBy;
      return o ? `ORDER BY ${validateOrderBy(o, columns)}` : '';
    })();
    const limitParamIdx = w.params.length + 1;
    const offsetParamIdx = w.params.length + 2;

    const rowsSql = `SELECT ${colList} FROM ${table}${whereSql ? ` WHERE ${whereSql}` : ''} ${orderClause} LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`.trim();
    const totalSql = `SELECT count(*)::bigint AS total FROM ${table}${whereSql ? ` WHERE ${whereSql}` : ''}`;

    const rowsR = await client.query(rowsSql, [...w.params, limit, offset]);
    const totalR = await client.query(totalSql, w.params);
    return { rows: rowsR.rows, total: Number(totalR.rows[0].total) };
  };

  const update = async (client, id, input) => {
    const data = filterTo(input, updatable);
    const cols = Object.keys(data);
    if (cols.length === 0) return getById(client, id);
    const setParts = cols.map((c, i) => `${c} = $${i + 1}`);
    if (columns.includes('updated_at')) setParts.push('updated_at = now()');
    const params = [...Object.values(data), id];
    const idIdx = params.length;
    const whereSql = withSdAnd(`${pk} = $${idIdx}`);
    const sql = `UPDATE ${table} SET ${setParts.join(', ')} WHERE ${whereSql} RETURNING ${colList}`;
    const r = await client.query(sql, params);
    return r.rows[0] || null;
  };

  const remove = async (client, id) => {
    if (softDelete) {
      await client.query(
        `UPDATE ${table} SET deleted_at = now() WHERE ${pk} = $1 AND deleted_at IS NULL`,
        [id]
      );
    } else {
      await client.query(`DELETE FROM ${table} WHERE ${pk} = $1`, [id]);
    }
    return { removed: true };
  };

  const upsert = async (client, conflictCols, input) => {
    if (!Array.isArray(conflictCols) || conflictCols.length === 0) {
      throw new Error('upsert: conflictCols required');
    }
    const data = filterTo(input, insertable);
    const id = input[pk] !== undefined ? input[pk] : uuidv7();
    const cols = [pk, ...Object.keys(data)];
    const values = [id, ...Object.values(data)];
    const placeholders = cols.map((_, i) => `$${i + 1}`);

    const updateCols = updatable.filter((c) => Object.prototype.hasOwnProperty.call(data, c));
    const setParts = updateCols.map((c) => `${c} = EXCLUDED.${c}`);
    if (columns.includes('updated_at')) setParts.push('updated_at = now()');
    // Always perform an update on conflict so RETURNING produces the row.
    // If nothing real to update, refresh the conflict column with itself.
    const onConflict =
      setParts.length > 0
        ? `DO UPDATE SET ${setParts.join(', ')}`
        : `DO UPDATE SET ${conflictCols[0]} = EXCLUDED.${conflictCols[0]}`;

    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')})
      ON CONFLICT (${conflictCols.join(', ')}) ${onConflict}
      RETURNING ${colList}`;
    const r = await client.query(sql, values);
    return r.rows[0];
  };

  return { create, getById, findOne, findMany, update, remove, upsert };
};
