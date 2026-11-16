import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const name = '@tencent-connect/dsh-qqbot-workbench-history';

// Stage the unpublished companion tarball for the normal single-package
// install. All other dependencies still come from their public registry.
export async function stageHistoryPackage(path, version) {
  const content = await readFile(path);
  const integrity = 'sha512-' + createHash('sha512').update(content).digest('base64');
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, origin).pathname;
    if (pathname === '/history.tgz') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(content);
    } else if (decodeURIComponent(pathname) === '/' + name) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        name, 'dist-tags': { latest: version },
        versions: { [version]: { name, version, dist: { tarball: origin + '/history.tgz', integrity } } },
      }));
    } else {
      response.writeHead(302, { location: 'https://registry.npmjs.org' + pathname });
      response.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  return {
    origin,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
