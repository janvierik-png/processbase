function buildUrl(config, path) {
  const base = config.engineName
    ? `${config.baseUrl.replace(/\/$/, "")}/engine/${encodeURIComponent(config.engineName)}`
    : config.baseUrl.replace(/\/$/, "");
  return `${base}${path}`;
}

function authHeaders(config) {
  if (!config.username || !config.password) return {};
  const token = Buffer.from(`${config.username}:${config.password}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

async function parseCamundaResponse(response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body?.message || body?.type || `Camunda 7 request failed with ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export function createCamunda7Service(config) {
  return {
    config: {
      baseUrl: config.baseUrl,
      engineName: config.engineName,
      deploymentSource: config.deploymentSource,
      authMode: config.username ? "basic" : "none"
    },

    async health() {
      const response = await fetch(buildUrl(config, "/engine"), {
        headers: authHeaders(config)
      });
      return parseCamundaResponse(response);
    },

    async listDeployments() {
      const response = await fetch(buildUrl(config, "/deployment?sortBy=deploymentTime&sortOrder=desc&maxResults=20"), {
        headers: authHeaders(config)
      });
      return parseCamundaResponse(response);
    },

    async deployBpmn({ deploymentName, resourceName, bpmnXml, deployChangedOnly = true, tenantId = "" }) {
      const formData = new FormData();
      formData.set("deployment-name", deploymentName);
      formData.set("deployment-source", config.deploymentSource);
      formData.set("deploy-changed-only", String(deployChangedOnly));
      formData.set("enable-duplicate-filtering", "true");
      if (tenantId) formData.set("tenant-id", tenantId);
      formData.set("data", new Blob([bpmnXml], { type: "application/xml" }), resourceName);

      const response = await fetch(buildUrl(config, "/deployment/create"), {
        method: "POST",
        headers: authHeaders(config),
        body: formData
      });
      return parseCamundaResponse(response);
    },

    async startProcessDefinition({ key, variables = {}, businessKey = "" }) {
      const payload = {
        variables: Object.fromEntries(Object.entries(variables).map(([name, value]) => [
          name,
          { value, type: typeof value === "number" ? "Double" : typeof value === "boolean" ? "Boolean" : "String" }
        ]))
      };
      if (businessKey) payload.businessKey = businessKey;

      const response = await fetch(buildUrl(config, `/process-definition/key/${encodeURIComponent(key)}/start`), {
        method: "POST",
        headers: {
          ...authHeaders(config),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      return parseCamundaResponse(response);
    }
  };
}
