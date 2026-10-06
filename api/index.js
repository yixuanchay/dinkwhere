const requestHandler = require("../server");

// vercel.json rewrites every path to this function as /api?__path=<path>,
// and Vercel hands the function that rewritten URL. Put the visitor's
// original path back before routing.
function restoreOriginalUrl(requestUrl) {
  const url = new URL(requestUrl, "http://localhost");
  if (!url.searchParams.has("__path")) return requestUrl;
  const originalPath = url.searchParams.get("__path");
  url.searchParams.delete("__path");
  const query = url.searchParams.toString();
  return `/${originalPath.replace(/^\/+/, "")}${query ? `?${query}` : ""}`;
}

function handler(request, response) {
  request.url = restoreOriginalUrl(request.url);
  return requestHandler(request, response);
}

module.exports = handler;
module.exports.restoreOriginalUrl = restoreOriginalUrl;
