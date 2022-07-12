# api-starter

Starter to develop and deploy APIs via Google Cloud Functions

## Get started

```bash
npm install
npm run watch
```

Go to `http://localhost:8080/` to interact with your API. Your code lives in `index.js`. The site will be reloaded whenever `*.js` files change (specified in `package.json` under `watch`).

## Deploy (via Google Cloud Functions)

**Note:** This repo contains a single API called `myAPI` (defined in `index.js`). To change its name, edit the name of the exported function in `index.js` and the `--target` parameter in the npm script `start`.

Make sure to connect to the appropriate project:

```bash
gcloud config set project <PROJECT-ID>
```

Enable cloud functions for the current project:

```bash
gcloud services enable cloudfunctions.googleapis.com
```

Set the region to "Frankfurt":

```bash
gcloud config set functions/region europe-west3
```

Deploy:

You will need to specify the runtime you are using. Available run times are listed at: https://cloud.google.com/sdk/gcloud/reference/functions/deploy#--runtime. To find the current node version you're running, type `node --version` in a terminal.

```bash
gcloud functions deploy myAPI --runtime=nodejs16 --trigger-http --allow-unauthenticated
```
