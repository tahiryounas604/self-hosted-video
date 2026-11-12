// Minimal multipart/form-data parser (no dependencies).
// Reads the whole request body into memory — v0.1 upload cap is 1 GiB
// (see MAX_BODY_BYTES). Returns { fields, files } where each file is
// { fieldName, filename, contentType, data: Buffer }.

export const MAX_BODY_BYTES = 1024 * 1024 * 1024;

export async function parseMultipart(req, maxBytes = MAX_BODY_BYTES) {
  const contentType = req.headers['content-type'] || '';
  const match = contentType.match(/multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) {
    const err = new Error('Expected multipart/form-data with a boundary');
    err.code = 'NOT_MULTIPART';
    throw err;
  }
  const boundary = Buffer.from(`--${match[1] || match[2]}`);

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const err = new Error(`Upload exceeds the ${maxBytes} byte limit`);
      err.code = 'TOO_LARGE';
      throw err;
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);

  const fields = {};
  const files = [];
  let start = 0;
  for (;;) {
    const boundaryIndex = body.indexOf(boundary, start);
    if (boundaryIndex === -1) break;
    let partStart = boundaryIndex + boundary.length;
    // Final boundary ends with "--".
    if (body.subarray(partStart, partStart + 2).toString() === '--') break;
    // Skip CRLF after the boundary.
    if (body[partStart] === 0x0d && body[partStart + 1] === 0x0a) partStart += 2;
    else if (body[partStart] === 0x0a) partStart += 1;

    const nextBoundary = body.indexOf(boundary, partStart);
    if (nextBoundary === -1) break;
    let partEnd = nextBoundary;
    // Strip the CRLF that precedes the next boundary.
    if (body[partEnd - 2] === 0x0d && body[partEnd - 1] === 0x0a) partEnd -= 2;
    else if (body[partEnd - 1] === 0x0a) partEnd -= 1;

    const headerEnd = body.indexOf('\r\n\r\n', partStart);
    if (headerEnd === -1 || headerEnd > partEnd) {
      start = nextBoundary;
      continue;
    }
    const headers = body.subarray(partStart, headerEnd).toString('utf8');
    const data = body.subarray(headerEnd + 4, partEnd);

    const disposition = headers.match(/content-disposition:\s*form-data;\s*(.*)/i)?.[1] ?? '';
    const name = disposition.match(/name="([^"]*)"/)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/)?.[1];
    const partContentType = headers.match(/content-type:\s*(.*)/i)?.[1]?.trim();
    if (!name) {
      start = nextBoundary;
      continue;
    }
    if (filename !== undefined) {
      files.push({ fieldName: name, filename, contentType: partContentType || 'application/octet-stream', data });
    } else {
      fields[name] = data.toString('utf8');
    }
    start = nextBoundary;
  }
  return { fields, files };
}
