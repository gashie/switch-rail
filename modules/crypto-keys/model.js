const KEY_PUBLIC_COLS =
  'id, owner_type, owner_id, kid, public_key_pem, status, activated_at, rotated_at, revoked_at';
const KEY_FULL_COLS = `${KEY_PUBLIC_COLS}, private_key_ciphertext, private_key_iv, private_key_tag`;

export const createCryptoKeysModel = () => ({
  insertKey: async (
    client,
    { id, ownerType, ownerId, kid, publicKeyPem, ciphertextB64, ivB64, tagB64 }
  ) => {
    const r = await client.query(
      `INSERT INTO signing_keys
        (id, owner_type, owner_id, kid, public_key_pem,
         private_key_ciphertext, private_key_iv, private_key_tag)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${KEY_PUBLIC_COLS}`,
      [id, ownerType, ownerId ?? null, kid, publicKeyPem, ciphertextB64, ivB64, tagB64]
    );
    return r.rows[0];
  },

  getActiveByKid: async (client, kid) => {
    const r = await client.query(
      `SELECT ${KEY_FULL_COLS} FROM signing_keys WHERE kid = $1 AND status = 'active' LIMIT 1`,
      [kid]
    );
    return r.rows[0] || null;
  },

  getByKid: async (client, kid) => {
    const r = await client.query(
      `SELECT ${KEY_FULL_COLS} FROM signing_keys WHERE kid = $1 LIMIT 1`,
      [kid]
    );
    return r.rows[0] || null;
  },

  listActive: async (client, { ownerType, ownerId }) => {
    if (ownerId === null || ownerId === undefined) {
      const r = await client.query(
        `SELECT ${KEY_PUBLIC_COLS} FROM signing_keys
          WHERE owner_type = $1 AND owner_id IS NULL AND status = 'active'
          ORDER BY activated_at DESC`,
        [ownerType]
      );
      return r.rows;
    }
    const r = await client.query(
      `SELECT ${KEY_PUBLIC_COLS} FROM signing_keys
        WHERE owner_type = $1 AND owner_id = $2 AND status = 'active'
        ORDER BY activated_at DESC`,
      [ownerType, ownerId]
    );
    return r.rows;
  },

  markActiveAsRotated: async (client, { ownerType, ownerId }) => {
    if (ownerId === null || ownerId === undefined) {
      await client.query(
        `UPDATE signing_keys SET status = 'rotated', rotated_at = now()
          WHERE owner_type = $1 AND owner_id IS NULL AND status = 'active'`,
        [ownerType]
      );
      return;
    }
    await client.query(
      `UPDATE signing_keys SET status = 'rotated', rotated_at = now()
        WHERE owner_type = $1 AND owner_id = $2 AND status = 'active'`,
      [ownerType, ownerId]
    );
  },

  revokeByKid: async (client, kid) => {
    const r = await client.query(
      `UPDATE signing_keys SET status = 'revoked', revoked_at = now()
        WHERE kid = $1 AND status <> 'revoked'
        RETURNING ${KEY_PUBLIC_COLS}`,
      [kid]
    );
    return r.rows[0] || null;
  }
});
