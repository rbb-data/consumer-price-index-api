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
  res.status(500).send("Database connection can't be established");
});

async function getMostRecentDate(pool, id = '') {
  const sql = [
    'SELECT year, month, created FROM consumer_price_index',
    'ORDER BY year DESC, month DESC LIMIT 1',
  ];
  if (id) sql.splice(1, 0, 'WHERE id = ?');
  const entries = await pool.query(sql.join(' '), id);
  return entries.length > 0 ? entries[0] : undefined;
}

async function getCPISelect(pool, ids, dates) {
  let condition = '';
  let inserts = [];
  if (ids && ids.length > 0) {
    condition += 'WHERE id IN (?)';
    inserts.push(ids);
  }
  if (dates && dates.length > 0) {
    if (ids && ids.length) {
      condition += ' AND (';
    } else {
      condition += 'WHERE (';
    }

    for (let i = 0; i < dates.length; i++) {
      const match = dates[i].match(/(\d{4})-(\d{2})/);
      if (match !== null) {
        const [, year, month] = match;
        if (i > 0) condition += ' OR ';
        condition += 'year = ? AND month = ?';
        inserts.push(+year, +month);
      }
    }

    condition += ')';
  }

  let sql = 'SELECT * FROM consumer_price_index ' + condition;

  // safety net in case no conditions are enforced
  if (!condition) {
    sql += 'LIMIT 10';
  }

  const entries = await pool.query(sql, inserts);
  return entries;
}

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
    res.set('Access-Control-Allow-Methods', ['GET', 'POST']);
    res.set('Access-Control-Allow-Headers', ['Content-Type', 'Authorization']);
    res.set('Access-Control-Max-Age', '3600');
    res.status(204).send('');
    return;
  }

  // cache alle responses for an hour
  res.set('Cache-Control', 'public, max-age=3600');

  const pool = await poolPromise;

  async function handleGET(req, res) {
    const { table, mode } = req.query;

    const handleMostRecentDate = async (req, res) => {
      const { id = '' } = req.query;
      const mostRecentDate = await getMostRecentDate(pool, id);
      res.status(200).json(mostRecentDate || '');
    };

    const handleCPISelect = async (req, res) => {
      const { ids: queryIds, dates: queryDates } = req.query;

      const ids = queryIds && decodeURIComponent(queryIds).split(',');
      const dates = queryDates && decodeURIComponent(queryDates).split(',');

      if (dates.includes('most-recent')) {
        const mostRecentDate = await getMostRecentDate(pool, 'CC13-0111101100');
        for (let i = 0; i < dates.length; i++) {
          if (dates[i] === 'most-recent') {
            const month = mostRecentDate.month.toString().padStart(2, '0');
            dates[i] = `${mostRecentDate.year}-${month}`;
          }
        }
      }

      const CPIs = await getCPISelect(pool, ids, dates);
      res.status(200).json(CPIs);
    };

    const handleLive = async (req, res) => {
      const queryStartDate = req.query['start-date'];

      const { ids: queryIds } = req.query;
      const ids = queryIds && decodeURIComponent(queryIds).split(',');

      if (!queryStartDate) {
        res.status(400).send('Query parameter start-date is required');
        return;
      }

      const match = queryStartDate.match(/(\d{4})-(\d{2})/);
      if (!match) {
        res.status(400).send('Query parameter start-date is not a valid date');
        return;
      }

      const startDate = { year: +match[1], month: +match[2] };

      if (
        startDate.year == undefined ||
        startDate.year < 2018 ||
        startDate.month == undefined ||
        startDate.month < 1 ||
        startDate.month > 12
      ) {
        res.status(400).send('Query parameter start-date is not a valid date');
        return;
      }

      const mostRecentDate = await getMostRecentDate(pool, 'CC13-0111101100');

      const getNextMonth = (date) => {
        if (date.getMonth() == 11) {
          return new Date(date.getFullYear() + 1, 0, 1);
        } else {
          return new Date(date.getFullYear(), date.getMonth() + 1, 1);
        }
      };

      const nativeStartDate = new Date(startDate.year, startDate.month - 1, 1);
      const nativeEndDate = new Date(
        mostRecentDate.year,
        mostRecentDate.month - 1,
        1
      );

      if (nativeEndDate.getTime() < nativeStartDate.getTime()) {
        res.status(400).send('Query parameter start-date lies in the future');
        return;
      }

      let dates = [];
      let currDate = new Date(
        nativeStartDate.getFullYear(),
        nativeStartDate.getMonth(),
        1
      );
      while (currDate.getTime() <= nativeEndDate.getTime()) {
        const month = (currDate.getMonth() + 1).toString().padStart(2, '0');
        dates.push(`${currDate.getFullYear()}-${month}`);
        currDate = getNextMonth(currDate);
      }

      const CPIs = await getCPISelect(pool, ids, dates);
      res.status(200).json(CPIs);
    };

    const handleProductSelect = async (req, res) => {
      const { ids: queryIds } = req.query;
      const ids = queryIds && decodeURIComponent(queryIds).split(',');

      if (!ids || ids.length === 0) {
        res.status(400).send('Missing query parameter <i>ids</i>');
        return;
      }

      let sql = 'SELECT * FROM products WHERE id IN (?)';
      const entries = await pool.query(sql, [ids]);

      const fetchedIds = entries.map((entry) => entry.id);
      const missingIds = ids.filter((id) => !fetchedIds.includes(id));

      // add zero counts for products not in the database
      for (let i = 0; i < missingIds.length; i++) {
        entries.push({ id: missingIds[i], added: 0, removed: 0 });
      }

      res.status(200).json(entries);
    };

    const handleMostOftenRemoved = async (req, res) => {
      let { ids: queryIds, limit = 3 } = req.query;

      const ids = queryIds && decodeURIComponent(queryIds).split(',');
      limit = +limit;

      let sql = 'SELECT * FROM products';
      if (ids && ids.length > 0) sql += ' WHERE id IN (?)';
      sql += ' ORDER BY removed DESC LIMIT ?';

      const inserts = ids && ids.length > 0 ? [ids, limit] : [limit];

      const entries = await pool.query(sql, inserts);

      res.status(200).json(entries);
    };

    async function handleConsumerPriceIndex(req, res) {
      if (mode === 'most-recent-date') await handleMostRecentDate(req, res);
      else if (mode === 'select') await handleCPISelect(req, res);
      else if (mode === 'live') await handleLive(req, res);
      else
        res
          .status(400)
          .send(
            [
              'Mode is invalid.',
              'Valid modes for table <i>consumer-price-index</i>:',
              '<i>most-recent-date</i>, <i>select</i>, <i>live</i>',
            ].join(' ')
          );
    }

    async function handleProducts(req, res) {
      if (mode === 'select') await handleProductSelect(req, res);
      else if (mode === 'most-often-removed')
        await handleMostOftenRemoved(req, res);
      else
        res
          .status(200)
          .send(
            [
              'Mode is invalid.',
              'Valid modes for table <i>products</i>:',
              '<i>most-often-removed</i>, <i>select</i>',
            ].join(' ')
          );
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
      if (!isValid) {
        res.status(400).send(dataMsg);
        return;
      }

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
        res.status(500).send('Unable to insert data into table');
        return;
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
      if (!isValid) {
        res.status(400).send(dataMsg);
        return;
      }

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
    if (!isAuthorized) {
      res.status(401).send(authMsg);
      return;
    }

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
