(() => {
  const version = "20260314c";
  const known = [
    "/stock/chat",
    "/stock/overview",
    "/stock/channels",
    "/stock/instances",
    "/stock/sessions",
    "/stock/usage",
    "/stock/cron",
    "/stock/skills",
    "/stock/nodes",
    "/stock/agents",
    "/stock/config",
    "/stock/debug",
    "/stock/logs",
    "/stock",
    "/chat",
    "/overview",
    "/channels",
    "/instances",
    "/sessions",
    "/usage",
    "/cron",
    "/skills",
    "/nodes",
    "/agents",
    "/config",
    "/debug",
    "/logs",
    "/index.html",
  ];
  const inferBasePath = (pathname) => {
    for (const suffix of known) {
      if (pathname === suffix) {
        return "";
      }
      if (pathname.endsWith(suffix)) {
        return pathname.slice(0, -suffix.length);
      }
    }
    return "";
  };
  const basePath = inferBasePath(window.location.pathname || "");
  const withBase = (suffix) => (basePath ? `${basePath}${suffix}` : suffix);
  const isStockRoute = /\/stock(?:\/|$)/i.test(window.location.pathname);
  if (!isStockRoute) {
    const favicon = document.createElement("link");
    favicon.rel = "icon";
    favicon.type = "image/svg+xml";
    favicon.href = withBase("/favicon.svg");
    document.head.appendChild(favicon);

    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = `${withBase("/dashboard.css")}?v=${version}`;
    document.head.appendChild(stylesheet);
  }
  const script = document.createElement("script");
  script.type = "module";
  script.src = `${withBase("/dashboard.js")}?v=${version}`;
  document.body.appendChild(script);
})();
