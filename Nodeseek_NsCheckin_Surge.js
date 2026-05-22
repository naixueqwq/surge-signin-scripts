/*
@Name: NS论坛签到 Surge5版
@Author: 怎么肥事
@Adapted: Surge 5

使用方法：
1. Surge 开启 MitM，并信任证书
2. 启用模块
3. 登录 nodeseek.com
4. 点击个人头像进入信息页面，触发 Header 获取
5. 之后由 cron 每天 00:01 自动签到
*/

const NS_HEADER_KEY = "NS_NodeseekHeaders";

const isGetHeader = typeof $request !== "undefined";

const NEED_KEYS = [
  "Connection",
  "Accept-Encoding",
  "Priority",
  "Content-Type",
  "Origin",
  "refract-sign",
  "User-Agent",
  "refract-key",
  "Sec-Fetch-Mode",
  "Cookie",
  "Host",
  "Referer",
  "Accept-Language",
  "Accept",
];

function notify(title, subtitle, body) {
  $notification.post(title || "", subtitle || "", body || "");
}

function log(msg) {
  console.log(`[NS] ${msg}`);
}

function pickNeedHeaders(src = {}) {
  const dst = {};

  const get = (name) => {
    return (
      src[name] ??
      src[name.toLowerCase()] ??
      src[name.toUpperCase()]
    );
  };

  for (const k of NEED_KEYS) {
    const v = get(k);
    if (v !== undefined) {
      dst[k] = v;
    }
  }

  return dst;
}

if (isGetHeader) {
  const allHeaders = $request.headers || {};
  const picked = pickNeedHeaders(allHeaders);

  if (!picked || Object.keys(picked).length === 0) {
    log(`picked headers empty: ${JSON.stringify(allHeaders)}`);
    notify("NS Headers 获取失败", "", "未获取到指定请求头，请重新再试一次。");
    $done({});
  } else {
    const ok = $persistentStore.write(JSON.stringify(picked), NS_HEADER_KEY);

    log(`saved picked headers: ${JSON.stringify(picked)}`);

    if (ok) {
      notify("NS Headers 获取成功", "", "指定请求头已持久化保存。");
    } else {
      notify("NS Headers 保存失败", "", "写入 Surge 持久化存储失败，请检查配置。");
    }

    $done({});
  }
} else {
  const raw = $persistentStore.read(NS_HEADER_KEY);

  if (!raw) {
    notify(
      "NS签到结果",
      "无法签到",
      "本地没有已保存的请求头，请先抓包访问一次个人页面。"
    );
    $done();
  } else {
    let savedHeaders = {};

    try {
      savedHeaders = JSON.parse(raw) || {};
    } catch (e) {
      log(`parse saved headers failed: ${e}`);
      notify(
        "NS签到结果",
        "无法签到",
        "本地保存的请求头数据损坏，请重新访问一次个人页面。"
      );
      $done();
    }

    const url = "https://www.nodeseek.com/api/attendance?random=true";

    const headers = {
      Connection: savedHeaders["Connection"] || "keep-alive",
      "Accept-Encoding":
        savedHeaders["Accept-Encoding"] || "gzip, deflate, br",
      Priority: savedHeaders["Priority"] || "u=3, i",
      "Content-Type":
        savedHeaders["Content-Type"] || "text/plain;charset=UTF-8",
      Origin: savedHeaders["Origin"] || "https://www.nodeseek.com",
      "refract-sign": savedHeaders["refract-sign"] || "",
      "User-Agent":
        savedHeaders["User-Agent"] ||
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7.2 Mobile/15E148 Safari/604.1",
      "refract-key": savedHeaders["refract-key"] || "",
      "Sec-Fetch-Mode": savedHeaders["Sec-Fetch-Mode"] || "cors",
      Cookie: savedHeaders["Cookie"] || "",
      Host: savedHeaders["Host"] || "www.nodeseek.com",
      Referer:
        savedHeaders["Referer"] ||
        "https://www.nodeseek.com/sw.js?v=0.3.33",
      "Accept-Language":
        savedHeaders["Accept-Language"] || "zh-CN,zh-Hans;q=0.9",
      Accept: savedHeaders["Accept"] || "*/*",
    };

    const request = {
      url,
      headers,
      body: "",
    };

    $httpClient.post(request, function (error, response, data) {
      if (error) {
        const err = String(error);
        log(`request error: ${err}`);
        notify("NS签到结果", "请求错误", err);
        $done();
        return;
      }

      const status =
        response && (response.status || response.statusCode)
          ? response.status || response.statusCode
          : 0;

      const body = data || "";

      let msg = "";

      try {
        const obj = JSON.parse(body);
        msg = obj && obj.message ? String(obj.message) : "";
        log(`parsed message: ${msg || "(empty)"}`);
      } catch (e) {
        log(`JSON parse failed: ${e}`);
      }

      if (status === 403) {
        const content = `暂时被风控，稍后再试
${
          msg ? `内容：${msg}` : `响应体：${body}`
        }`;
        log(`notify 403: ${content}`);
        notify("NS签到结果", "403 风控", content);
      } else if (status === 500) {
        const content = msg || body || "服务器错误 500，无返回内容";
        log(`notify 500: ${content}`);
        notify("NS签到结果", "500 服务器错误", content);
      } else if (status >= 200 && status < 300) {
        const content = msg || "NS签到成功，但未返回 message";
        log(`notify success: ${content}`);
        notify("NS签到结果", "签到成功", content);
      } else {
        const content = msg || body || `请求失败，status=${status}`;
        log(`notify other: ${content}`);
        notify("NS签到结果", `请求异常 ${status}`, content);
      }

      $done();
    });
  }
}