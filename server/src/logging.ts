interface RequestForLog {
  method: string;
  url: string;
  headers?: Record<string, string | string[] | undefined>;
  host: string;
  ip: string;
  socket?: { remotePort?: number };
}

export function serializeRequestForLog(req: RequestForLog) {
  const queryIndex = req.url.indexOf("?");
  const version = req.headers?.["accept-version"];
  return {
    method: req.method,
    url: queryIndex === -1 ? req.url : req.url.slice(0, queryIndex),
    version: Array.isArray(version) ? version[0] : version,
    host: req.host,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}
