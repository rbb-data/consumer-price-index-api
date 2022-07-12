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
  // Handle CORS
  res.set('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    // Send response to OPTIONS requests
    res.set('Access-Control-Allow-Methods', 'GET');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    res.status(204).send('');
  } else {
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

      // access secret and store it in a environment variable
      const [secret] = await client.accessSecretVersion({
        name: process.env.CLOUD_SQL_CREDENTIALS_SECRET,
      });
      process.env.DB_PASS = secret.payload.data.toString('utf8');

      return createUnixSocketPool(config);
    };

    const pool = await createPool().catch((err) => {
      throw err;
    });

    // example
    const entry = await pool.query(
      'SELECT * FROM consumer_price_index LIMIT 1'
    );

    res.status(200).json(entry[0]);
  }
};
