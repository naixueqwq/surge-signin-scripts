const NAME = "PingMe签到";
const CK_KEY = "pingme_capture_v3";
const SECRET = "0fOiukQq7jXZV2GRi9LGlO";
const MAX_VIDEO = 5;
const VIDEO_DELAY = 8000;
const ICON = "https://raw.githubusercontent.com/fmz200/wool_scripts/main/icons/apps/PingMe.png";

function notify(subtitle, body) {
  $notification.post(NAME, subtitle || "", body || "", { "media-url": ICON });
}

function finish(value) {
  try { $done(value || {}); } catch (e) {}
}

function readStore(key) {
  return $persistentStore.read(key);
}

function writeStore(key, value) {
  return $persistentStore.write(value, key);
}

function requestGet(url, headers) {
  return new Promise((resolve, reject) => {
    $httpClient.get({ url, headers, timeout: 30 }, (error, response, data) => {
      if (error) {
        reject(error);
      } else {
        response = response || {};
        response.body = data || "";
        response.statusCode = response.status || response.statusCode || 0;
        resolve(response);
      }
    });
  });
}

function parseRawQuery(url) {
  const query = String(url || "").split("?")[1]?.split("#")[0] || "";
  const rawMap = {};
  query.split("&").forEach(pair => {
    if (!pair) return;
    const idx = pair.indexOf("=");
    if (idx < 0) return;
    rawMap[pair.slice(0, idx)] = pair.slice(idx + 1);
  });
  return rawMap;
}

function cloneHeaders(headers) {
  const out = {};
  Object.keys(headers || {}).forEach(k => {
    const v = headers[k];
    if (v !== undefined && v !== null) out[k] = v;
  });
  return out;
}

function captureHeaders(headers) {
  const out = cloneHeaders(headers);
  delete out["Content-Length"];
  delete out["content-length"];
  delete out[":authority"];
  delete out[":method"];
  delete out[":path"];
  delete out[":scheme"];
  out.Host = "api.pingmeapp.net";
  out.Accept = out.Accept || out.accept || "application/json";
  return out;
}

function buildHeaders(capture) {
  const headers = captureHeaders(capture.headers || {});
  headers.Host = "api.pingmeapp.net";
  headers.Accept = headers.Accept || headers.accept || "application/json";
  return headers;
}

function getUTCSignDate() {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
}

function buildSignedParamsRaw(capture) {
  const params = {};
  Object.keys(capture.paramsRaw || {}).forEach(k => {
    if (k !== "sign" && k !== "signDate") params[k] = capture.paramsRaw[k];
  });
  params.signDate = getUTCSignDate();
  const signBase = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&");
  params.sign = MD5(signBase + SECRET);
  return params;
}

function buildUrl(path, capture) {
  const params = buildSignedParamsRaw(capture);
  const qs = Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join("&");
  return `https://api.pingmeapp.net/app/${path}?${qs}`;
}

function parseJson(text) {
  try { return JSON.parse(text || "{}"); } catch (e) { return null; }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTask() {
  const raw = readStore(CK_KEY);
  if (!raw) {
    notify("请先获取参数", "打开 PingMe App，触发一次 queryBalanceAndBonus 请求后再运行签到。");
    return;
  }

  let capture;
  try {
    capture = JSON.parse(raw);
  } catch (e) {
    notify("参数损坏", "请重新打开 PingMe App 抓取参数。");
    return;
  }

  const headers = buildHeaders(capture);
  const msgs = [];

  async function fetchApi(path) {
    const url = buildUrl(path, capture);
    return await requestGet(url, headers);
  }

  try {
    let res = await fetchApi("queryBalanceAndBonus");
    let data = parseJson(res.body);
    if (data && data.retcode === 0) {
      msgs.push(`💰 余额：${data.result?.balance ?? "?"} Coins`);
    } else {
      msgs.push(`⚠️ 查询：${data?.retmsg || `HTTP ${res.statusCode}`}`);
    }

    res = await fetchApi("checkIn");
    data = parseJson(res.body);
    if (data && data.retcode === 0) {
      msgs.push(`✅ 签到：${String(data.result?.bonusHint || data.retmsg || "成功").replace(/\n/g, " ")}`);
    } else {
      msgs.push(`⚠️ 签到：${data?.retmsg || `HTTP ${res.statusCode}`}`);
    }

    for (let i = 1; i <= MAX_VIDEO; i++) {
      await sleep(i === 1 ? 1500 : VIDEO_DELAY);
      try {
        res = await fetchApi("videoBonus");
        data = parseJson(res.body);
        if (data && data.retcode === 0) {
          msgs.push(`🎬 视频${i}：+${data.result?.bonus ?? "?"} Coins`);
        } else {
          msgs.push(`⏸ 视频${i}：${data?.retmsg || `HTTP ${res.statusCode}`}`);
          break;
        }
      } catch (e) {
        msgs.push(`❌ 视频${i}：${String(e) || "请求失败"}`);
        break;
      }
    }

    res = await fetchApi("queryBalanceAndBonus");
    data = parseJson(res.body);
    if (data && data.retcode === 0) {
      msgs.push(`💰 最新余额：${data.result?.balance ?? "?"} Coins`);
    }

    notify("🎉 任务完成", msgs.join("\n"));
  } catch (e) {
    notify("❌ 任务失败", `${msgs.join("\n")}\n${String(e && e.message ? e.message : e)}`.trim());
  }
}

function captureRequest() {
  const url = $request.url || "";
  const paramsRaw = parseRawQuery(url);
  const headers = captureHeaders($request.headers || {});

  if (!paramsRaw || Object.keys(paramsRaw).length === 0) {
    notify("参数获取失败", "未读取到 URL 参数，请重新打开 PingMe 后再试。");
    return;
  }

  const ok = writeStore(CK_KEY, JSON.stringify({
    url,
    paramsRaw,
    headers,
    capturedAt: new Date().toISOString()
  }));

  if (ok) {
    notify("参数获取成功", "PingMe 签到参数已保存。可手动运行一次脚本测试。");
  } else {
    notify("参数保存失败", "Surge 持久化存储写入失败。请检查脚本权限。");
  }
}

function MD5(string) {
  function RotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); }
  function AddUnsigned(lX, lY) {
    const lX4 = lX & 0x40000000, lY4 = lY & 0x40000000, lX8 = lX & 0x80000000, lY8 = lY & 0x80000000;
    const lResult = (lX & 0x3fffffff) + (lY & 0x3fffffff);
    if (lX4 & lY4) return lResult ^ 0x80000000 ^ lX8 ^ lY8;
    if (lX4 | lY4) return (lResult & 0x40000000) ? (lResult ^ 0xc0000000 ^ lX8 ^ lY8) : (lResult ^ 0x40000000 ^ lX8 ^ lY8);
    return lResult ^ lX8 ^ lY8;
  }
  function F(x, y, z) { return (x & y) | ((~x) & z); }
  function G(x, y, z) { return (x & z) | (y & (~z)); }
  function H(x, y, z) { return x ^ y ^ z; }
  function I(x, y, z) { return y ^ (x | (~z)); }
  function FF(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
  function GG(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
  function HH(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
  function II(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
  function ConvertToWordArray(str) {
    const lMessageLength = str.length;
    const lNumberOfWords = (((lMessageLength + 8) - ((lMessageLength + 8) % 64)) / 64 + 1) * 16;
    const lWordArray = Array(lNumberOfWords).fill(0);
    let lByteCount = 0;
    while (lByteCount < lMessageLength) {
      const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
      const lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordCount] |= str.charCodeAt(lByteCount) << lBytePosition;
      lByteCount++;
    }
    const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
    const lBytePosition = (lByteCount % 4) * 8;
    lWordArray[lWordCount] |= 0x80 << lBytePosition;
    lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
    lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
    return lWordArray;
  }
  function WordToHex(lValue) {
    let out = "";
    for (let i = 0; i <= 3; i++) {
      const lByte = (lValue >>> (i * 8)) & 255;
      out += ("0" + lByte.toString(16)).slice(-2);
    }
    return out;
  }
  const x = ConvertToWordArray(string);
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  const S11 = 7, S12 = 12, S13 = 17, S14 = 22, S21 = 5, S22 = 9, S23 = 14, S24 = 20;
  const S31 = 4, S32 = 11, S33 = 16, S34 = 23, S41 = 6, S42 = 10, S43 = 15, S44 = 21;
  for (let k = 0; k < x.length; k += 16) {
    const AA = a, BB = b, CC = c, DD = d;
    a = FF(a,b,c,d,x[k+0],S11,0xd76aa478); d = FF(d,a,b,c,x[k+1],S12,0xe8c7b756); c = FF(c,d,a,b,x[k+2],S13,0x242070db); b = FF(b,c,d,a,x[k+3],S14,0xc1bdceee);
    a = FF(a,b,c,d,x[k+4],S11,0xf57c0faf); d = FF(d,a,b,c,x[k+5],S12,0x4787c62a); c = FF(c,d,a,b,x[k+6],S13,0xa8304613); b = FF(b,c,d,a,x[k+7],S14,0xfd469501);
    a = FF(a,b,c,d,x[k+8],S11,0x698098d8); d = FF(d,a,b,c,x[k+9],S12,0x8b44f7af); c = FF(c,d,a,b,x[k+10],S13,0xffff5bb1); b = FF(b,c,d,a,x[k+11],S14,0x895cd7be);
    a = FF(a,b,c,d,x[k+12],S11,0x6b901122); d = FF(d,a,b,c,x[k+13],S12,0xfd987193); c = FF(c,d,a,b,x[k+14],S13,0xa679438e); b = FF(b,c,d,a,x[k+15],S14,0x49b40821);
    a = GG(a,b,c,d,x[k+1],S21,0xf61e2562); d = GG(d,a,b,c,x[k+6],S22,0xc040b340); c = GG(c,d,a,b,x[k+11],S23,0x265e5a51); b = GG(b,c,d,a,x[k+0],S24,0xe9b6c7aa);
    a = GG(a,b,c,d,x[k+5],S21,0xd62f105d); d = GG(d,a,b,c,x[k+10],S22,0x02441453); c = GG(c,d,a,b,x[k+15],S23,0xd8a1e681); b = GG(b,c,d,a,x[k+4],S24,0xe7d3fbc8);
    a = GG(a,b,c,d,x[k+9],S21,0x21e1cde6); d = GG(d,a,b,c,x[k+14],S22,0xc33707d6); c = GG(c,d,a,b,x[k+3],S23,0xf4d50d87); b = GG(b,c,d,a,x[k+8],S24,0x455a14ed);
    a = GG(a,b,c,d,x[k+13],S21,0xa9e3e905); d = GG(d,a,b,c,x[k+2],S22,0xfcefa3f8); c = GG(c,d,a,b,x[k+7],S23,0x676f02d9); b = GG(b,c,d,a,x[k+12],S24,0x8d2a4c8a);
    a = HH(a,b,c,d,x[k+5],S31,0xfffa3942); d = HH(d,a,b,c,x[k+8],S32,0x8771f681); c = HH(c,d,a,b,x[k+11],S33,0x6d9d6122); b = HH(b,c,d,a,x[k+14],S34,0xfde5380c);
    a = HH(a,b,c,d,x[k+1],S31,0xa4beea44); d = HH(d,a,b,c,x[k+4],S32,0x4bdecfa9); c = HH(c,d,a,b,x[k+7],S33,0xf6bb4b60); b = HH(b,c,d,a,x[k+10],S34,0xbebfbc70);
    a = HH(a,b,c,d,x[k+13],S31,0x289b7ec6); d = HH(d,a,b,c,x[k+0],S32,0xeaa127fa); c = HH(c,d,a,b,x[k+3],S33,0xd4ef3085); b = HH(b,c,d,a,x[k+6],S34,0x04881d05);
    a = HH(a,b,c,d,x[k+9],S31,0xd9d4d039); d = HH(d,a,b,c,x[k+12],S32,0xe6db99e5); c = HH(c,d,a,b,x[k+15],S33,0x1fa27cf8); b = HH(b,c,d,a,x[k+2],S34,0xc4ac5665);
    a = HH(a,b,c,d,x[k+1],S31,0xa4beea44); d = HH(d,a,b,c,x[k+4],S32,0x4bdecfa9); c = HH(c,d,a,b,x[k+7],S33,0xf6bb4b60); b = HH(b,c,d,a,x[k+10],S34,0xbebfbc70);
    a = HH(a,b,c,d,x[k+13],S31,0x289b7ec6); d = HH(d,a,b,c,x[k+0],S32,0xeaa127fa); c = HH(c,d,a,b,x[k+3],S33,0xd4ef3085); b = HH(b,c,d,a,x[k+6],S34,0x04881d05);
    a = HH(a,b,c,d,x[k+9],S31,0xd9d4d039); d = HH(d,a,b,c,x[k+12],S32,0xe6db99e5); c = HH(c,d,a,b,x[k+15],S33,0x1fa27cf8); b = HH(b,c,d,a,x[k+2],S34,0xc4ac5665);
    a = II(a,b,c,d,x[k+0],S41,0xf4292244); d = II(d,a,b,c,x[k+7],S42,0x432aff97); c = II(c,d,a,b,x[k+14],S43,0xab9423a7); b = II(b,c,d,a,x[k+5],S44,0xfc93a039);
    a = II(a,b,c,d,x[k+12],S41,0x655b59c3); d = II(d,a,b,c,x[k+3],S42,0x8f0ccc92); c = II(c,d,a,b,x[k+10],S43,0xffeff47d); b = II(b,c,d,a,x[k+1],S44,0x85845dd1);
    a = II(a,b,c,d,x[k+8],S41,0x6fa87e4f); d = II(d,a,b,c,x[k+15],S42,0xfe2ce6e0); c = II(c,d,a,b,x[k+6],S43,0xa3014314); b = II(b,c,d,a,x[k+13],S44,0x4e0811a1);
    a = II(a,b,c,d,x[k+4],S41,0xf7537e82); d = II(d,a,b,c,x[k+11],S42,0xbd3af235); c = II(c,d,a,b,x[k+2],S43,0x2ad7d2bb); b = II(b,c,d,a,x[k+9],S44,0xeb86d391);
    a = AddUnsigned(a,AA); b = AddUnsigned(b,BB); c = AddUnsigned(c,CC); d = AddUnsigned(d,DD);
  }
  return (WordToHex(a) + WordToHex(b) + WordToHex(c) + WordToHex(d)).toLowerCase();
}

(async () => {
  try {
    if (typeof $request !== "undefined") {
      captureRequest();
    } else {
      await runTask();
    }
  } catch (e) {
    notify("脚本异常", String(e && e.message ? e.message : e));
  } finally {
    finish({});
  }
})();