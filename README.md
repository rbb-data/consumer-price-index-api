# Consumer price index API (Germany)

Exposes consumer price indices from [Genesis (Destatis)](https://www-genesis.destatis.de/genesis//online?operation=table&code=61111-0006&bypass=true&levelindex=0&levelid=1657617156882#abreadcrumb)

Live at: https://europe-west3-rbb-data-inflation.cloudfunctions.net/consumer-price-index-api

## Documentation

### GET

The database contains two tables, `consumer-price-index` and `products`. `consumer-price-indices` stores CPI values for a list of groceries since 2015.`products` counts the number of times a product has been added and removed from a basket.

- `table=consumer-price-index`

  - `mode=most-recent-date`: yields the most recent date in database as `{ year: <YEAR>, month: <1...12> }`

    - `id=<ID>`: yields the most recent date for an item with `<ID>`, e.g. `?table=consumer-price-index&mode=most-recent-date&id=CC13-0111101100`

  - `mode=select`: yields a list of entries, constrained by the given query parameters (**careful!** the response might be large; the response is restricted to a length of 10 if no query parameters are specified)
    - `ids=<ID>,<ID>,...,<ID>`, e.g. `ids=CC13-0111101100,CC13-0111109100,CC13-0111201100`
    - `year=<YEAR>`, e.g. `year=2022`
    - `month=<MONTH>`, where `<MONTH>` is in `1,...,12`, e.g. `month=5` (May)

- `table=products`
  - `mode=select`: yields a list of records for the given product ids as `[ { id: <ID>, added: <INT>, removed: <INT> }, ... ]`, where `added` is the number of times a product has been added to the cart and `removed` is the number of times a product has been removed
    - `ids=<ID>,<ID>,...,<ID>`, e.g. `ids=ravioli,rouladen`
  - `mode=most-often-removed`: yields a list of products that have been removed the most (measured by the absolute count)
    - `limit=<INT>`: number of products to return (default: 3)

### POST

You'll need to authenticate yourself using a Bearer token.

- `table=consumer-price-index`

  - body sent is either a single json object with fields `id` (category id, e.g. 'CC13-0111101100'), `name` (category name), `year` (e.g. 2022), `month` (1-12) and `value` (consumer price index) or a list of such objects

- `table=products`
  - body sent is a json object such as `{ added: [<ID>, ...], removed: [<ID>, ...] }`

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
