# Consumer price index API (Germany)

Exposes consumer price indices from [Genesis (Destatis)](https://www-genesis.destatis.de/genesis//online?operation=table&code=61111-0006&bypass=true&levelindex=0&levelid=1657617156882#abreadcrumb) and stores data from a user survey that asked questions about the impact of the inflation on a user's supermarker visit

Live at: https://europe-west3-rbb-data-inflation.cloudfunctions.net/consumer-price-index-api

## Documentation

### GET

The database contains two tables, `consumer-price-index` and `survey`.

- `table=consumer-price-index`

  - `mode=most-recent-date`: yields the most recent date in database as `{ year: <YEAR>, month: <1...12> }`

    - `id=<ID>`: yields the most recent date for an item with `<ID>`, e.g. `?table=consumer-price-index&mode=most-recent-date&id=CC13-0111101100`

  - `mode=select`: yields a list of entries, constrained by the given query parameters (**careful!** the response might be large; the response is restricted to a length of 10 if no query parameters are specified)

    - `ids=<ID>,<ID>,...,<ID>`, e.g. `ids=CC13-0111101100,CC13-0111109100,CC13-0111201100`
    - `dates=YYYY-MM,YYYY-MM,...,YYYY-MM,most-recent`, e.g. `2022-01,2022-02,2022-03` (`most-recent` is a key that fetches data for the most recent date)

  - `mode=live`: yields a list of entries, from the given start date up until to most recent date
    - `ids=<ID>,<ID>,...,<ID>`, e.g. `ids=CC13-0111101100,CC13-0111109100,CC13-0111201100`
    - `start-date=YYYY-MM`, e.g. `2022-01`

- `table=survey`
  - `mode=select`: yields a list of records for the given product ids as `[ { id: <ID>, base_base: <INT>, base_premium: <INT>, base_none: <INT>, premium_base: <INT>, premium_premium: <INT>, premium_none: <INT> }, ... ]`,
    - `ids=<ID>,<ID>,...,<ID>`, e.g. `ids=ravioli,rouladen` (if not given, all products are returned)

### POST

You'll need to authenticate yourself using a Bearer token.

- `table=consumer-price-index`

  - body sent is either a single json object with fields `id` (category id, e.g. 'CC13-0111101100'), `name` (category name), `year` (e.g. 2022), `month` (1-12) and `value` (consumer price index) or a list of such objects

- `table=survey`
  - body sent is a json object such as `{ id: <ID>, before: <KEY_BEFORE>, after: <KEY_AFTER> }` where `<KEY_BEFORE>` is one of `{'base', 'premium'}` and `<KEY_AFTER>` is one of `{'base', 'premium', 'none'}`

## Development

### Run locally

> **Note**
>
> To run the app locally, download and install the `cloud_sql_proxy` by [following the instructions](https://cloud.google.com/sql/docs/mysql/sql-proxy#install).

> **Note**
>
> Add the necessary credentials by downloading the key file that belongs to the service account `rbb-data-inflation@appspot.gserviceaccount.com` and storing the downloaded file as `rbb-data-inflation-fc4113adea34.json`.
> Create a local environment file `.env.local` and add the following variables: DB_PASS, CLOUD_API_SECRET (you can find them in the cloud's secret manager).

Load environment variables from `.env` and `.env.local`:

```bash
export $(cat .env | xargs)
export $(cat .env.local | xargs)
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
