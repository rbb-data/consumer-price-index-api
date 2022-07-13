# Consumer price index API (Germany)

Exposes consumer price indices from [Genesis (Destatis)](https://www-genesis.destatis.de/genesis//online?operation=table&code=61111-0006&bypass=true&levelindex=0&levelid=1657617156882#abreadcrumb)

Live at: https://europe-west3-rbb-data-inflation.cloudfunctions.net/consumer-price-index-api

## Documentation

- `mode=most-recent-entry`: yields the most recent entry, as indicated by columns `year` and `month`
  - `item_id=<ITEM_ID>`: yields the most recent entry for an item with `<ITEM_ID>`, e.g. `?mode=most-recent-entry&item_id=CC13-0111101100`

## Development

### Run locally

> **Note**
>
> To run the app locally, download and install the `cloud_sql_proxy` by [following the instructions](https://cloud.google.com/sql/docs/mysql/sql-proxy#install).

> **Note**
>
> Add the necessary credentials by downloading the key file that belongs to the service account `rbb-data-inflation@appspot.gserviceaccount.com` and storing the downloaded file as `rbb-data-inflation-fc4113adea34.json`.

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

### Deploy

```bash
npm run deploy
```
