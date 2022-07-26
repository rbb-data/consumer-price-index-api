const functions = require('@google-cloud/functions-framework');
const mysql = require('promise-mysql');

const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const client = new SecretManagerServiceClient();

const accessSecret = async (name) => {
  const [secret] = await client.accessSecretVersion({ name });
  return secret.payload.data.toString('utf8');
};

const createUnixSocketPool = async (config) => {
  const dbSocketPath = process.env.DB_SOCKET_PATH || '/cloudsql';

  // establish a connection to the database
  return mysql.createPool({
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    socketPath: `${dbSocketPath}/${process.env.INSTANCE_CONNECTION_NAME}`,
    ...config,
  });
};

const createPool = async () => {
  const config = {
    connectionLimit: 1,
    connectTimeout: 10000,
    acquireTimeout: 10000,
    waitForConnections: true,
    queueLimit: 0,
  };

  // access db password and store it in an environment variable
  process.env.DB_PASS = await accessSecret(
    process.env.CLOUD_SQL_CREDENTIALS_SECRET
  );

  return createUnixSocketPool(config);
};

// establish database connection
const poolPromise = createPool().catch(() => {
  res.status(500).send("Database connection can't be established").end();
});

/**
 * HTTP Cloud Function.
 *
 * @param {Object} req Cloud Function request context.
 *                     More info: https://expressjs.com/en/api.html#req
 * @param {Object} res Cloud Function response context.
 *                     More info: https://expressjs.com/en/api.html#res
 */
functions.http('consumer-price-index-api', async (req, res) => {
  // handle CORS
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    res.status(204).send('').end();
  }

  const pool = await poolPromise;

  async function handleGET(req, res) {
    const { table, mode } = req.query;

    const handleMostRecentDate = async (req, res) => {
      const { id = '' } = req.query;
      const sql = [
        'SELECT year, month FROM consumer_price_index',
        'ORDER BY year DESC, month DESC LIMIT 1',
      ];
      if (id) sql.splice(1, 0, 'WHERE id = ?');
      const entries = await pool.query(sql.join(' '), id);
      if (entries.length > 0) res.status(200).json(entries[0]).end();
      else res.status(200).json('').end();
    };

    const handleCPISelect = async (req, res) => {
      const { ids: queryIds, year, month } = req.query;

      const ids = queryIds && decodeURIComponent(queryIds).split(',');

      let conditions = [],
        inserts = [];
      if (ids && ids.length > 0) {
        conditions.push('id IN (?)');
        inserts.push(ids);
      }
      if (year) {
        conditions.push('year = ?');
        inserts.push(year);
      }
      if (month) {
        conditions.push('month = ?');
        inserts.push(month);
      }

      for (let i = 0; i < conditions.length; i++) {
        if (i === 0) conditions[i] = 'WHERE ' + conditions[i];
        else conditions[i] = 'AND ' + conditions[i];
      }
      let sql = 'SELECT * FROM consumer_price_index ' + conditions.join(' ');

      // safety net in case no conditions are enforced
      if (conditions.length === 0) {
        sql += 'LIMIT 10';
      }

      const entries = await pool.query(sql, inserts);

      res.status(200).json(entries).end();
    };

    const handleProductSelect = async (req, res) => {
      const { ids: queryIds } = req.query;
      const ids = queryIds && decodeURIComponent(queryIds).split(',');

      if (!ids || ids.length === 0) {
        res.status(400).send('Missing query parameter <i>ids</i>').end();
      }

      let sql = 'SELECT * FROM products WHERE id IN (?)';
      const entries = await pool.query(sql, [ids]);

      res.status(200).json(entries).end();
    };

    const handleMostOftenRemoved = async (req, res) => {
      let { limit = 3 } = req.query;
      limit = +limit;

      const sql = 'SELECT * FROM products ORDER BY removed DESC LIMIT ?';
      console.log(mysql.format(sql, [limit]));
      const entries = await pool.query(sql, [limit]);
      res.status(200).json(entries).end();
    };

    async function handleConsumerPriceIndex(req, res) {
      if (mode === 'most-recent-date') await handleMostRecentDate(req, res);
      else if (mode === 'select') await handleCPISelect(req, res);
      else
        res
          .status(400)
          .send(
            [
              'Mode is invalid.',
              'Valid modes for table <i>consumer-price-index</i>:',
              '<i>most-recent-date</i>, <i>select</i>',
            ].join(' ')
          )
          .end();
    }

    async function handleProducts(req, res) {
      if (mode === 'select') await handleProductSelect(req, res);
      else if (mode === 'most-often-removed')
        await handleMostOftenRemoved(req, res);
      else res.status(200).send('Products table').end();
    }

    if (table === 'consumer-price-index') {
      await handleConsumerPriceIndex(req, res);
    } else if (table === 'products') {
      await handleProducts(req, res);
    } else {
      res
        .status(400)
        .send(
          'Table is invalid. Valid tables: <i>consumer-price-index</i>, <i>products</i>'
        );
    }
  }

  async function handlePOST(req, res) {
    const { table } = req.query;

    const authorize = async (req) => {
      const { authorization } = req.headers;

      if (!authorization || !authorization.startsWith('Bearer')) {
        return { ok: false, msg: 'No bearer token provided' };
      }

      const [, token] = authorization.match(/Bearer (.*)/);
      const secret = await accessSecret(process.env.CLOUD_API_SECRET);

      if (token !== secret) return { ok: false, msg: 'Token invalid' };

      return { ok: true };
    };

    const checkCpiData = (data, columns) => {
      if (!data) return { ok: false, msg: 'No data provided' };

      const isValid = (d) => columns.every((col) => d[col] !== undefined);

      if (
        (!Array.isArray(data) && typeof data !== 'object') ||
        (Array.isArray(data) && !data.every(isValid)) ||
        (!Array.isArray(data) && typeof data === 'object' && !isValid(data))
      ) {
        return { ok: false, msg: 'Invalid data format' };
      }

      return { ok: true };
    };

    const updateConsumerPriceIndex = async (req, res) => {
      // check if the provided data is valid
      const columns = ['id', 'name', 'year', 'month', 'value'];
      const { body: data } = req;
      const { ok: isValid, msg: dataMsg } = checkCpiData(data, columns);
      if (!isValid) res.status(400).send(dataMsg).end();

      // insert data into database
      try {
        if (Array.isArray(data)) {
          const sql = `INSERT INTO consumer_price_index (${columns}) VALUES ? ON DUPLICATE KEY UPDATE value = VALUES(value)`;
          const values = data.map((d) => columns.map((col) => d[col]));
          await pool.query(sql, [values]);
        } else if (typeof data === 'object') {
          const sql =
            'INSERT INTO consumer_price_index SET ? ON DUPLICATE KEY UPDATE value = ?';
          await pool.query(sql, [data, data.value]);
        }
      } catch (err) {
        return res.status(500).send('Unable to insert data into table').end();
      }

      res.status(200).send('');
    };

    const checkProductData = (data) => {
      if (!data) return { ok: false, msg: 'No data provided' };

      if (!data.added || !data.removed)
        return { ok: false, msg: 'Invalid data format' };

      if (!Array.isArray(data.added) || !Array.isArray(data.removed)) {
        return { ok: false, msg: 'Invalid data format' };
      }

      return { ok: true };
    };

    const updateProducts = async (req, res) => {
      const { body: data } = req;

      // check if the provided data is valid
      const { ok: isValid, msg: dataMsg } = checkProductData(data);
      if (!isValid) res.status(400).send(dataMsg).end();

      const ids = new Set();

      const nAdded = new Map();
      for (let i = 0; i < data.added.length; i++) {
        const id = data.added[i];
        ids.add(id);
        if (!nAdded.has(id)) nAdded.set(id, 0);
        nAdded.set(id, nAdded.get(id) + 1);
      }

      const nRemoved = new Map();
      for (let i = 0; i < data.removed.length; i++) {
        const id = data.removed[i];
        ids.add(id);
        if (!nRemoved.has(id)) nRemoved.set(id, 0);
        nRemoved.set(id, nRemoved.get(id) + 1);
      }

      const entries = Array.from(ids).map((id) => [
        id,
        nAdded.has(id) ? nAdded.get(id) : 0,
        nRemoved.has(id) ? nRemoved.get(id) : 0,
      ]);

      const sql = [
        'INSERT INTO products (id, added, removed) VALUES ?',
        'ON DUPLICATE KEY UPDATE',
        'added = VALUES(added) + added,',
        'removed = VALUES(removed) + removed',
      ].join(' ');
      await pool.query(sql, [entries]);

      res.status(200).send('');
    };

    // check if request is authorized
    const { ok: isAuthorized, msg: authMsg } = await authorize(req);
    if (!isAuthorized) res.status(401).send(authMsg).end();

    if (table === 'consumer-price-index') {
      await updateConsumerPriceIndex(req, res);
    } else if (table === 'products') {
      await updateProducts(req, res);
    } else {
      res
        .status(400)
        .send('Table is invalid. Valid tables: consumer-price-index, products');
    }
  }

  if (req.method === 'GET') await handleGET(req, res);
  else if (req.method === 'POST') await handlePOST(req, res);
});
