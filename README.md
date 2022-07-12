# consumer-price-index

Exposes consumer price indices from [Genesis (Destatis)](https://www-genesis.destatis.de/genesis//online?operation=table&code=61111-0006&bypass=true&levelindex=0&levelid=1657617156882#abreadcrumb)

## Run locally

> **Note**
>
> First, you'll need to set up the necessary credentials. Download the key file that belongs to the service account `rbb-data-inflation@appspot.gserviceaccount.com` and store it under `rbb-data-inflation-fc4113adea34.json`.

To run the app locally, download and install the `cloud_sql_proxy` by [following the instructions](https://cloud.google.com/sql/docs/mysql/sql-proxy#install).

Load environment variables from `.env`:

```bash
export $(cat .env | xargs)
```

Create a directory for the Unix socket and give write access to the user running the proxy:

```bash
mkdir socket
chown -R $USER socket
```

Run the proxy:

```bash
./cloud_sql_proxy -dir=$DB_SOCKET_PATH --instances=$INSTANCE_CONNECTION_NAME --credential_file=$GOOGLE_APPLICATION_CREDENTIALS &
```

Finally, install and run the app in watch mode:

```bash
npm install
npm run watch
```

Go to `http://localhost:8080/` to interact with your API. Your code lives in `index.js`.

These instructions follow advice given in https://github.com/GoogleCloudPlatform/nodejs-docs-samples/tree/3259904684ebaf199faef4a6e3518c911b80cc2b/cloud-sql/mysql/mysql

## Deploy

```bash
npm run deploy
```
