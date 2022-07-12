const mysql = require('promise-mysql');

const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const client = new SecretManagerServiceClient();

/**
 * HTTP Cloud Function.
 *
 * @param {Object} req Cloud Function request context.
 *                     More info: https://expressjs.com/en/api.html#req
 * @param {Object} res Cloud Function response context.
 *                     More info: https://expressjs.com/en/api.html#res
 */
exports.consumerPriceIndexAPI = async (req, res) => {
  // handle CORS
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    res.status(204).send('').end();
  }

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

  async function handleGET(req, res) {
    // establish database connection
    const pool = await createPool().catch(() => {
      res.status(500).send("Database connection can't be established").end();
    });

    // example
    const sql = 'SELECT * FROM consumer_price_index LIMIT ?';
    const entries = await pool.query(sql, [5]);

    res.status(200).json(entries).end();
  }

  async function handlePOST(req, res) {
    const authorize = async (req) => {
      const { authorization } = req.headers;

      if (!authorization || !authorization.startsWith('Bearer')) {
        return { ok: false, msg: 'No bearer token provided' };
      }

      const token = authorization.replace('Bearer', '').trim();
      const secret = await accessSecret(process.env.CLOUD_API_SECRET);

      if (token !== secret) return { ok: false, msg: 'Token invalid' };

      return { ok: true };
    };

    const checkData = (data, columns) => {
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

    // check if request is authorized
    const { ok: isAuthorized, msg: authMsg } = await authorize(req);
    if (!isAuthorized) res.status(401).send(authMsg).end();

    // check if the provided data is valid
    const columns = ['item_id', 'item_name', 'year', 'month', 'value'];
    const { body: data } = req;
    const { ok: isValid, msg: dataMsg } = checkData(data, columns);
    if (!isValid) res.status(400).send(dataMsg).end();

    // establish connection
    const pool = await createPool().catch(() => {
      res.status(500).send("Database connection can't be established").end();
    });

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
  }

  if (req.method === 'GET') await handleGET(req, res);
  else if (req.method === 'POST') await handlePOST(req, res);
};
