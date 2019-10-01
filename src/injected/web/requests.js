import {
  includes, push, shift, encodeBody, jsonLoad, Uint8Array, Blob, warn,
  stringSlice, stringMatch, stringCharCodeAt,
} from '../utils/helpers';
import bridge from './bridge';

const map = {};
const queue = [];

const NS_HTML = 'http://www.w3.org/1999/xhtml';

// rarely used so we'll do an explicit .call() later to reduce init time now
const { createElementNS } = Document.prototype;
const { setAttribute } = Element.prototype;
const hrefGet = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'href').get;

export function onRequestCreate(details) {
  const req = {
    details,
    req: {
      abort: reqAbort,
    },
  };
  details.url = getFullUrl(details.url);
  push(queue, req);
  bridge.post({ cmd: 'GetRequestId' });
  return req.req;
}

export function onRequestStart(id) {
  const req = shift(queue);
  if (req) start(req, id);
}

export function onRequestCallback(res) {
  const req = map[res.id];
  if (req) callback(req, res);
}

function reqAbort() {
  bridge.post({ cmd: 'AbortRequest', data: this.id });
}

function parseData(req, details) {
  if (req.resType) {
    // blob or arraybuffer
    const { response } = req.data;
    if (response) {
      const matches = stringMatch(response, /^data:([^;,]*);base64,/);
      if (!matches) {
        // invalid
        req.data.response = null;
      } else {
        const raw = atob(stringSlice(response, matches[0].length));
        const arr = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) arr[i] = stringCharCodeAt(raw, i);
        if (details.responseType === 'blob') {
          // blob
          return new Blob([arr], { type: matches[1] });
        }
        // arraybuffer
        return arr.buffer;
      }
    }
  } else if (details.responseType === 'json') {
    // json
    return jsonLoad(req.data.response);
  } else {
    // text
    return req.data.response;
  }
}

// request object functions
function callback(req, res) {
  const cb = req.details[`on${res.type}`];
  if (cb) {
    if (res.data.response) {
      if (!req.data) req.data = [parseData(res, req.details)];
      [res.data.response] = req.data;
    }
    res.data.context = req.details.context;
    cb(res.data);
  }
  if (res.type === 'loadend') delete map[req.id];
}

function start(req, id) {
  const { details } = req;
  const payload = {
    id,
    anonymous: details.anonymous,
    method: details.method,
    url: details.url,
    user: details.user,
    password: details.password,
    headers: details.headers,
    timeout: details.timeout,
    overrideMimeType: details.overrideMimeType,
  };
  req.id = id;
  map[id] = req;
  const { responseType } = details;
  if (responseType) {
    if (includes(['arraybuffer', 'blob'], responseType)) {
      payload.responseType = 'arraybuffer';
    } else if (!includes(['json', 'text'], responseType)) {
      warn(`[Violentmonkey] Unknown responseType "${responseType}", see https://violentmonkey.github.io/api/gm/#gm_xmlhttprequest for more detail.`);
    }
  }
  encodeBody(details.data)
  .then((body) => {
    payload.data = body;
    bridge.post({
      cmd: 'HttpRequest',
      data: payload,
    });
  });
}

function getFullUrl(url) {
  const a = createElementNS.call(document, NS_HTML, 'a');
  setAttribute.call(a, 'href', url);
  return hrefGet.call(a);
}
