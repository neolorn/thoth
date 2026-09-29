/**
 * What a consumer's built server answers, asked on the Node this process runs on.
 *
 * The consumer stage runs this as a process of its own, on the Node its row names, and reads the
 * answers from the file it writes. It is a process of its own because the server bundle installs
 * Angular's `attachNodeGlobalErrorHandlers`, and with those listeners in place an error nobody
 * handled is printed and the process exits 0. The stage's own failures have to keep ending it
 * non-zero, so the bundle is never imported there.
 *
 * Reads the requests from stdin as JSON, `[{ origin, path, headers }]`, and writes one answer per
 * request, `[{ status, headers, body }]`, in the same order, as JSON to the file its second argument
 * names. A file rather than stdout, because the application may write to stdout while it renders. A
 * request reaches the build its origin is served from, as it would behind a real deployment's
 * routing.
 *
 * A third argument names one build's output directory instead, for an application in the seat that
 * is not the one the address table describes. Every request then reaches that build over loopback.
 *
 * `--output <name>` in its place names another set of builds of the application the table
 * describes, such as its pseudo build. They are served as the table says, by origin, because a
 * build under a policy that puts each locale on an origin of its own refuses any other host.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { listenForBrowsers } from './browser-reachable-port.mjs';
import {
  readConsumerAddresses,
  readConsumerBuilds,
} from './consumer-addresses.mjs';

const [consumerRoot, answersFile, ...named] = process.argv.slice(2);
const output = named[0] === '--output' ? named[1] : undefined;
const buildRoot = named[0] === '--output' ? undefined : named[0];
if (consumerRoot === undefined || answersFile === undefined) {
  throw new Error(
    'Name the consumer whose server to ask, and the file its answers go to.',
  );
}
const requests = JSON.parse(readFileSync(0, 'utf8'));

const addresses =
  buildRoot === undefined
    ? await readConsumerAddresses(consumerRoot)
    : { localeInOrigin: false };

const deployments = new Map();
if (buildRoot === undefined) {
  const builds = await readConsumerBuilds(consumerRoot);
  for (const origin of new Set(requests.map((request) => request.origin))) {
    const bundle = resolve(
      consumerRoot,
      builds.output(origin, output),
      'server/server.mjs',
    );
    deployments.set(
      new URL(origin).host,
      (await import(pathToFileURL(bundle).href)).reqHandler,
    );
  }
} else {
  const bundle = resolve(buildRoot, 'server/server.mjs');
  deployments.set(
    'loopback',
    (await import(pathToFileURL(bundle).href)).reqHandler,
  );
}

// Registered after the bundle's own listeners, so an escaped error still ends this process
// non-zero once Angular's have printed it.
const failEscaped = (error) => {
  process.stderr.write(
    `The consumer's server failed outside any request.\n${error?.stack ?? String(error)}\n`,
  );
  process.exit(1);
};
process.on('uncaughtException', failEscaped);
process.on('unhandledRejection', failEscaped);

// Under a policy whose locales share one origin the server admits loopback and nothing else, so
// every request is sent as loopback and reaches the one build. Under a policy that puts each locale
// on an origin of its own the Host is that origin, which the server admits and routes by.
const server = createServer((request, response) => {
  const handler = addresses.localeInOrigin
    ? deployments.get(request.headers.host)
    : [...deployments.values()][0];
  const next = (error) => {
    if (response.writableEnded) return;
    response.statusCode = error === undefined ? 404 : 500;
    response.end(error === undefined ? '' : String(error?.stack ?? error));
  };
  if (handler === undefined) {
    response.statusCode = 421;
    response.end(`No build answers at ${request.headers.host}.`);
    return;
  }
  try {
    Promise.resolve(handler(request, response, next)).catch(next);
  } catch (error) {
    next(error);
  }
});
const loopback = `127.0.0.1:${await listenForBrowsers(server, '127.0.0.1')}`;

const ask = ({ origin, path, headers = {} }) =>
  new Promise((answered, failed) => {
    const asked = httpRequest(
      `http://${loopback}${path}`,
      {
        headers: {
          ...headers,
          host: addresses.localeInOrigin ? new URL(origin).host : loopback,
        },
      },
      (answer) => {
        const chunks = [];
        answer.on('data', (chunk) => chunks.push(chunk));
        answer.on('error', failed);
        answer.on('end', () =>
          answered({
            status: answer.statusCode,
            headers: answer.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    asked.on('error', failed);
    asked.end();
  });

const answers = [];
for (const request of requests) answers.push(await ask(request));
writeFileSync(answersFile, JSON.stringify(answers));
process.exit(0);
