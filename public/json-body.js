const MAX_JSON_BODY_BYTES = 64 * 1024;

function isBodyTooLarge(error) {
  return error && error.code === 'BODY_TOO_LARGE';
}

function bodyTooLargeError() {
  const error = new Error('JSON 請求內容不得超過 64 KiB');
  error.code = 'BODY_TOO_LARGE';
  return error;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(req.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
      req.resume();
      reject(bodyTooLargeError());
      return;
    }

    const chunks = [];
    let byteLength = 0;
    let settled = false;

    function finish(error, value) {
      if (settled) return;
      settled = true;
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      if (error) reject(error);
      else resolve(value);
    }

    function onData(chunk) {
      byteLength += chunk.length;
      if (byteLength > MAX_JSON_BODY_BYTES) {
        finish(bodyTooLargeError());
        req.resume();
        return;
      }
      chunks.push(chunk);
    }

    function onEnd() {
      try {
        const body = Buffer.concat(chunks, byteLength).toString('utf8');
        finish(null, body ? JSON.parse(body) : {});
      } catch (error) {
        finish(error);
      }
    }

    function onError(error) {
      finish(error);
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

module.exports = { MAX_JSON_BODY_BYTES, isBodyTooLarge, parseJsonBody };
